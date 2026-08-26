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
import type { Context } from '@deepseek-ai/cordis';
/** Vision config subset consumed by analyze_viewport. */
export interface VisionConfig {
    host: string;
    port: number;
    timeoutMs: number;
    visionProvider: string;
    visionModel: string;
}
export declare function registerVision(ctx: Context, config: VisionConfig): void;
