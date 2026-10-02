// Subset of genspark-ai/genoffice@676bf4d5 packages/ai-provider/src/protocols/shared.ts (Apache-2.0):
// the stream callback contract and tool-call budgets the Codex bridge depends on.
import type { AgentToolCall } from '@genoffice/agent-core'

/**
 * Max chars buffered for one streamed tool call's arguments; a provider that keeps
 * streaming fragments without finishing would otherwise grow the buffer unbounded.
 */
export const MAX_TOOL_JSON_CHARS = 512_000

export function throwIfToolJsonOverBudget(jsonLength: number, provider: string): void {
  if (jsonLength > MAX_TOOL_JSON_CHARS) {
    throw new Error(
      `Tool call arguments exceeded the ${provider} buffer limit (${jsonLength} chars, cap ${MAX_TOOL_JSON_CHARS}); ` +
        'the provider kept streaming argument fragments without finishing. Ask for the output in several smaller parts.',
    )
  }
}

/** Max tool calls started per streamed turn. */
export const MAX_STREAM_TOOL_CALLS = 100

export function throwIfToolCountOverBudget(count: number, provider: string): void {
  if (count > MAX_STREAM_TOOL_CALLS) {
    throw new Error(
      `Too many streamed tool calls (${count}, cap ${MAX_STREAM_TOOL_CALLS}) for ${provider}; ` +
        'the provider kept starting tool calls without finishing the turn.',
    )
  }
}

export interface StreamCallbacks {
  onDelta: (text: string) => void
  onToolCall: (call: AgentToolCall) => void
  /** raw model reasoning deltas (reasoning_content); the same provider may need them back on later requests */
  onReasoningDelta?: (text: string) => void
  /** display-only reasoning summary deltas (Codex); never sent back */
  onReasoningSummaryDelta?: (text: string) => void
  /** normalized stop reason ('max_tokens' when the output was cut off by the token limit) */
  onStopReason?: (reason: string) => void
  /** bytes arrived on the wire (keepalive for the stream watchdog) */
  onActivity?: () => void
  /** Stable conversation id for providers with native sessions (Codex threads). */
  sessionId?: string
  signal: AbortSignal
}

/**
 * Models occasionally emit unescaped " inside string values (e.g. English quotes in Chinese copy).
 * Single-pass scan: a " inside a string whose next non-whitespace char is not structural gets escaped.
 */
function repairUnescapedQuotes(json: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < json.length; i++) {
    const c = json[i]!
    if (!inStr) {
      if (c === '"') inStr = true
      out += c
      continue
    }
    if (c === '\\') {
      out += c + (json[++i] ?? '')
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < json.length && ' \n\r\t'.includes(json[j]!)) j++
      const next = json[j]
      if (next === undefined || ',}]:'.includes(next)) {
        inStr = false
        out += c
      } else {
        out += '\\"'
      }
      continue
    }
    out += c
  }
  return out
}

export function parseToolInput(json: string): { input: Record<string, unknown>; error?: string } {
  if (!json.trim()) return { input: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    try {
      parsed = JSON.parse(repairUnescapedQuotes(json))
    } catch {
      const msg = e instanceof Error ? e.message : String(e)
      return { input: {}, error: `${msg}; raw: ${json.slice(0, 500)}` }
    }
  }
  if (!isPlainObject(parsed)) {
    return { input: {}, error: `tool input must be a JSON object; raw: ${json.slice(0, 500)}` }
  }
  return { input: parsed }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
