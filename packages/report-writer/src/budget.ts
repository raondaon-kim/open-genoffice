import { continuePrompt } from './prompts'
import type { LlmPort } from './types'

/**
 * Reasoning models (deepseek-flash behind LiteLLM) spend hidden thinking inside max_tokens and
 * cannot switch it off, so a small budget comes back cut or empty. Budgets start large and
 * grow; the model's own cap is far above them.
 */
export const PLAN_BUDGETS = [16384, 32768, 65536]
export const CHAPTER_BUDGET = 32768
export const MAX_BUDGET = 65536
export const CONTINUATIONS = 2
/** a cut reply shorter than this was mostly reasoning: ask again larger instead of continuing */
export const NEAR_EMPTY_CHARS = 500

type Prompt = { system: string; user: string }

function jsonText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced) return fenced[1]!.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim()
}

/** a JSON answer: a cut, empty or unparsable reply is asked again with the next budget */
export async function askJson<T>(
  llm: LlmPort,
  prompt: Prompt,
  parse: (text: string) => T,
  signal?: AbortSignal,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let lastError = 'no answer'
  for (const maxTokens of PLAN_BUDGETS) {
    if (signal?.aborted) return { ok: false, error: 'cancelled' }
    const reply = await llm({ ...prompt, maxTokens, signal })
    if (signal?.aborted || reply.status === 'stopped') return { ok: false, error: 'cancelled' }
    if (reply.status === 'error') {
      lastError = reply.error ?? 'model error'
      continue
    }
    if (reply.status !== 'complete') {
      lastError = `the answer stopped at ${maxTokens} tokens`
      continue
    }
    try {
      return { ok: true, value: parse(jsonText(reply.text)) }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  return { ok: false, error: lastError }
}

/**
 * A chapter: a cut reply with almost no text is asked again with twice the budget (up to
 * MAX_BUDGET); a cut reply with real text is continued at most CONTINUATIONS times.
 */
export async function askChapter(
  llm: LlmPort,
  prompt: Prompt,
  signal?: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; error: string; stopped?: boolean }> {
  const stopped = { ok: false as const, error: 'cancelled', stopped: true }
  let budget = CHAPTER_BUDGET
  let reply = await llm({ ...prompt, maxTokens: budget, signal })
  while (
    (reply.status === 'empty' ||
      (reply.status === 'max_tokens' && reply.text.trim().length < NEAR_EMPTY_CHARS)) &&
    budget < MAX_BUDGET &&
    !signal?.aborted
  ) {
    budget *= 2
    reply = await llm({ ...prompt, maxTokens: budget, signal })
  }
  if (signal?.aborted || reply.status === 'stopped') return stopped
  if (reply.status === 'error') return { ok: false, error: reply.error ?? 'model error' }
  if (reply.status === 'empty') return { ok: false, error: reply.error ?? 'empty answer' }
  let text = reply.text
  for (let n = 0; reply.status === 'max_tokens' && n < CONTINUATIONS; n++) {
    reply = await llm({ ...continuePrompt(prompt, text), maxTokens: budget, signal })
    if (signal?.aborted || reply.status === 'stopped') return stopped
    if (reply.status === 'error') return { ok: false, error: reply.error ?? 'model error' }
    // an empty continuation leaves the chapter cut mid-sentence: never land that
    if (reply.status === 'empty') return { ok: false, error: 'the continuation came back empty' }
    text += reply.text
  }
  if (reply.status === 'max_tokens') {
    return { ok: false, error: `still cut at the token limit after ${CONTINUATIONS} continuations` }
  }
  return { ok: true, text }
}
