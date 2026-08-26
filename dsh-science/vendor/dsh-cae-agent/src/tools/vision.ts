/**
 * tools/vision.ts — multimodal screenshot analysis for dsh-cae-agent.
 *
 * `abaqus_analyze_viewport` captures the current Abaqus viewport, persists it as
 * a DSH attachment, and injects the screenshot (plus an analysis prompt) into the
 * model's context via `exec.deferContext(createUserMessage(...))`. The multimodal
 * agent (default deepseek-v4-flash-vision-exp) then sees the image in the loop and
 * reasons about it. The tool returns a structured envelope so the agent records a
 * judgment and decides whether more user input is needed.
 *
 * Design principle (per project): multimodal output is a *reference*, not
 * authoritative. If the model (or agent) is unsure, it should set `needs_user=true`
 * and leave the decision to the user rather than auto-modifying the model.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Buffer } from 'node:buffer'
import type { BridgeHandle } from '../core.js'
import { runKernelCode } from '../core.js'

type JsonRecord = Record<string, JsonValue>

/** Vision config subset consumed by analyze_viewport. */
export interface VisionConfig {
  host: string
  port: number
  timeoutMs: number
  visionProvider: string
  visionModel: string
}

/** Capture the current/requested Abaqus viewport into base64 PNG (kernel side). */
async function captureViewportB64(
  br: BridgeHandle,
  viewportName: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ viewport: string; image_base64: string; size_bytes: number } | null> {
  const v = JSON.stringify(viewportName || '')
  try {
    const res = await runKernelCode(
      br,
      `import os,tempfile,base64
from abaqus import session
import abaqusConstants as ABQ
vp=${v}
if not vp or vp not in session.viewports.keys():
    vp=session.currentViewportName
vpobj=session.viewports[vp]
h=tempfile.NamedTemporaryFile(suffix=".png",delete=False); p=h.name; h.close()
try:
    session.printToFile(fileName=p, format=ABQ.PNG, canvasObjects=(vpobj,))
    with open(p,"rb") as f: b64=base64.b64encode(f.read()).decode("ascii")
    result={"viewport":vp,"format":"png","image_base64":b64,"size_bytes":int(len(b64)*3/4)}
finally:
    try: os.unlink(p)
    except Exception: pass
result`,
      timeoutMs,
      signal,
    )
    const raw = (res.value ?? {}) as JsonRecord
    const imageB64 = typeof raw.image_base64 === 'string' ? raw.image_base64 : ''
    if (!imageB64) return null
    return {
      viewport: String(raw.viewport ?? ''),
      image_base64: imageB64,
      size_bytes: Number(raw.size_bytes ?? 0),
    }
  } catch {
    return null
  }
}

export function registerVision(ctx: Context, config: VisionConfig): void {
  const br: BridgeHandle = { host: config.host, port: config.port }

  ctx.tools.register(
    defineTool({
      name: 'abaqus_analyze_viewport',
      description:
        `Capture the current Abaqus viewport and make it available for multimodal analysis by the vision model (${config.visionModel}). ` +
        'The screenshot is injected into the conversation context so the agent can visually inspect geometry or results. ' +
        'Optionally ask the model a specific question about the screenshot. Use this to sanity-check a model/view/result or to decide whether a change is needed. ' +
        'Note: multimodal judgment is a reference — if unsure, prefer asking the user.',
      parameters: {
        viewportName: { type: 'string', description: 'Viewport name; empty = current viewport' },
        question: {
          type: 'string',
          description: 'Optional analysis question for the multimodal model, e.g. "Is the mesh reasonable?" or "Any obvious stress concentration?"',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = (value ?? {}) as JsonRecord
          return [
            { type: 'text', text: `Viewport captured: "${String(v.viewport ?? '')}". Model will analyze it visually (model=${String(v.model ?? '')}). Needs user? ${String(v.needs_user ?? false)}` },
          ]
        },
      },
      async execute(args, exec) {
        const captured = await captureViewportB64(br, String(args.viewportName ?? ''), config.timeoutMs, exec.signal)
        if (!captured) {
          return { error: 'viewport capture failed', needs_user: true } as JsonRecord
        }
        // Persist the image as an attachment so it has a durable ref.
        let ref: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number } | null = null
        try {
          const r = await ctx.attachments.saveImage({
            data: Buffer.from(captured.image_base64, 'base64'),
            mediaType: 'image/png',
          })
          ref = {
            attachmentId: r.attachmentId,
            mediaType: r.mediaType,
            bytes: r.bytes,
            width: r.width,
            height: r.height,
          }
        } catch {
          /* deferContext still works if saveImage fails? No — image block needs attachment ref; skip image then. */
        }

        if (ref) {
          const question = String(args.question ?? '')
          const content: unknown[] = [
            { type: 'image', attachment: ref },
            {
              type: 'text',
              text:
                `This is a screenshot of the current Abaqus/CAE viewport (viewport "${captured.viewport}"). ` +
                'Abaqus agent: visually inspect it. ' +
                (question ? `Analysis question: ${question}` : 'Briefly describe what you can see and note anything unusual.'),
            },
          ]
          try {
            exec.deferContext(
              createUserMessage({
                content: content as never[],
                source: { kind: 'plugin', plugin: 'dsh-cae-agent' },
              }),
            )
          } catch {
            /* best-effort: if context injection fails, still return the envelope */
          }
        }

        return {
          captured: { viewport: captured.viewport, size_bytes: captured.size_bytes, format: 'png' },
          model: config.visionModel,
          provider: config.visionProvider,
          question: String(args.question ?? ''),
          judgment: 'pending', // filled by the multimodal agent after seeing the injected image
          confidence: 'pending',
          needs_user: false, // agent/user should set true when unsure
          suggested_actions: [],
        } as JsonRecord
      },
      timeoutMs: config.timeoutMs + 30_000,
      isConcurrencySafe: () => true,
    }),
  )
}
