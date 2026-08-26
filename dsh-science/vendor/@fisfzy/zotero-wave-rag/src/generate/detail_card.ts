/**
 * Detail-card generation.
 *
 * Two modes:
 *   - extractive (default, no API key): metadata + evidence + related papers
 *     + excerpt-based method/contribution fields. Honest and dependency-free.
 *   - LLM (`config.llm === 'api'`): evidence chunks + abstract are sent to a
 *     chat model which synthesizes method / contribution / experiments as a
 *     grounded detail card.
 *
 * The card's `evidence` field always lists the concrete quotes/paragraphs the
 * summary is grounded in — the "show your work" surface the eval harness uses
 * for faithfulness checks.
 */

import type { ApiProvider } from '../core/config.ts'
import type { DetailCard, LibraryIndex, Paper } from '../core/types.ts'
import { chunkPaper } from '../ingest/chunker.ts'
import { guardField } from './claim_check.ts'

export interface DetailCardOptions {
  /** Top-N related papers via graph edges. */
  relatedTopN?: number
  /** Max evidence items to include. */
  maxEvidence?: number
  /** Chunk snippet length in chars. */
  snippetChars?: number
}

const DEFAULT_OPTS: Required<DetailCardOptions> = {
  relatedTopN: 5,
  maxEvidence: 4,
  snippetChars: 320,
}

function graphNeighbors(index: LibraryIndex, key: string): { key: string; title: string; weight: number; kind: string }[] {
  const out: { key: string; title: string; weight: number; kind: string }[] = []
  const titles = new Map(index.papers.map((p) => [p.key, p.title]))
  for (const e of index.edges) {
    let other: string | undefined
    if (e.a === key) other = e.b
    else if (e.b === key) other = e.a
    if (other === undefined) continue
    out.push({ key: other, title: titles.get(other) ?? other, weight: e.weight, kind: e.kind })
  }
  out.sort((a, b) => b.weight - a.weight)
  return out
}

/** Evidence: annotations first (they are the user's own emphasis), then top chunks. */
function collectEvidence(
  paper: Paper,
  chunkTexts: { text: string; section?: string; pageStart?: number }[],
  maxEvidence: number,
  snippetChars: number,
): string[] {
  const evidence: string[] = []
  for (const a of paper.annotations) {
    const quote = a.quote?.trim()
    if (quote) evidence.push(`批注: ${quote.slice(0, snippetChars)}${a.note ? ` — ${a.note.slice(0, 120)}` : ''}`)
    if (evidence.length >= maxEvidence) return evidence
  }
  for (const c of chunkTexts) {
    if (evidence.length >= maxEvidence) break
    const page = c.pageStart !== undefined ? `[p.${c.pageStart}] ` : ''
    const label = c.section ? `[${c.section}] ` : ''
    evidence.push(`${page}${label}${c.text.slice(0, snippetChars)}`)
  }
  return evidence
}

/** Extractive (no-LLM) card body. */
function extractiveBody(
  paper: Paper,
  chunks: { text: string; section?: string }[],
  opts: Required<DetailCardOptions>,
): Pick<DetailCard, 'method' | 'contribution' | 'experiments'> {
  const body = chunks.find((c) => /method|approach|framework/i.test(c.section ?? ''))?.text
  const intro = chunks.find((c) => /introduction|abstract/i.test(c.section ?? ''))?.text
  const results = chunks.find((c) => /result|experiment|evaluation/i.test(c.section ?? ''))?.text
  return {
    method: (body ?? intro ?? paper.abstract ?? '').slice(0, opts.snippetChars) || undefined,
    contribution: (intro ?? paper.abstract ?? body ?? '').slice(0, opts.snippetChars) || undefined,
    experiments: (results ?? '').slice(0, opts.snippetChars) || undefined,
  }
}

/** LLM-synthesized card body (OpenAI-compatible chat API). */
async function llmBody(
  paper: Paper,
  evidence: string[],
  provider: ApiProvider,
): Promise<Pick<DetailCard, 'method' | 'contribution' | 'experiments'>> {
  // baseURL already includes the API prefix; append the path verbatim.
  const url = `${provider.baseURL.replace(/\/+$/, '')}/chat/completions`
  const system =
    'You summarize academic papers. Return ONLY a JSON object with three string fields: method, contribution, experiments. ' +
    'Ground every sentence in the provided evidence; do not invent details. If evidence is missing for a field, use an empty string.'
  const user = [
    `Paper: ${paper.title}`,
    `Authors: ${paper.creators.map((c) => `${c.firstName ?? ''} ${c.lastName}`.trim()).join(', ')}`,
    paper.abstract ? `Abstract: ${paper.abstract}` : '',
    `Evidence:\n${evidence.map((e, i) => `[${i + 1}] ${e}`).join('\n')}`,
  ].filter(Boolean).join('\n\n')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] }
  const content = data.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(content) as Partial<Record<'method' | 'contribution' | 'experiments', string>>
  return {
    method: parsed.method || undefined,
    contribution: parsed.contribution || undefined,
    experiments: parsed.experiments || undefined,
  }
}

export async function generateDetailCard(
  paper: Paper,
  index: LibraryIndex,
  opts: DetailCardOptions & { llm?: ApiProvider } = {},
): Promise<DetailCard> {
  const o: Required<DetailCardOptions> = { ...DEFAULT_OPTS, ...opts }
  let paperChunks = index.chunks.filter((c) => c.paperKey === paper.key)
  // Two-tier indexes carry only abstract-level chunks; for detail cards,
  // chunk the paper's own extracted full text on the fly (no embedding
  // needed — cards consume text, not vectors).
  if (paper.fullText && paperChunks.every((c) => c.section === 'abstract')) {
    paperChunks = chunkPaper(paper)
  }
  const chunkTexts = paperChunks.map((c) => ({ text: c.text, section: c.section, pageStart: c.pageStart }))
  const evidence = collectEvidence(paper, chunkTexts, o.maxEvidence, o.snippetChars)

  let body: Pick<DetailCard, 'method' | 'contribution' | 'experiments'>
  if (opts.llm && evidence.length > 0) {
    try {
      body = await llmBody(paper, evidence, opts.llm)
      // faithfulness guard: mark any sentence the evidence does not support
      body = {
        method: guardField(body.method, evidence),
        contribution: guardField(body.contribution, evidence),
        experiments: guardField(body.experiments, evidence),
      }
    } catch (error) {
      body = { ...extractiveBody(paper, chunkTexts, o), contribution: `(LLM 失败，回退抽取式) ${extractiveBody(paper, chunkTexts, o).contribution ?? ''}` }
    }
  } else {
    body = extractiveBody(paper, chunkTexts, o)
  }

  return {
    paperKey: paper.key,
    title: paper.title,
    metadata: {
      creators: paper.creators,
      year: paper.year,
      tags: paper.tags,
      collections: paper.collections,
      url: paper.url,
      doi: paper.doi,
      methodType: paper.methodType,
    },
    ...body,
    relatedPapers: graphNeighbors(index, paper.key)
      .slice(0, o.relatedTopN)
      .map((n) => `${n.title} (${n.kind})`),
    evidence,
  }
}
