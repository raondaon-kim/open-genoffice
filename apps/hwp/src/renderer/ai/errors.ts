import type { ToolExecution } from '@genoffice/agent-core'
import type { EditorLike, HwpAiContext } from './context'

/** a tool failure with a short activity label; the message goes back to the model */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly summary = 'failed',
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

export function toExecution(err: unknown): ToolExecution {
  if (err instanceof ToolError) return { output: err.message, isError: true, summary: err.summary }
  return {
    output: err instanceof Error ? err.message : String(err),
    isError: true,
    summary: 'failed',
  }
}

export function requireEditor(ctx: HwpAiContext): EditorLike {
  const editor = ctx.editor()
  if (!editor) throw new ToolError('The document is not open yet.', 'no document')
  return editor
}

export type Input = Record<string, unknown>

export function record(value: unknown, label: string): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError(`${label} must be an object`, 'invalid argument')
  }
  return value as Input
}

export function intArg(
  input: Input,
  key: string,
  opts: { min?: number; max?: number; fallback?: number } = {},
): number {
  const value = input[key]
  if (value === undefined || value === null) {
    if (opts.fallback !== undefined) return opts.fallback
    throw new ToolError(`${key} is required`, 'invalid argument')
  }
  const min = opts.min ?? Number.MIN_SAFE_INTEGER
  const max = opts.max ?? Number.MAX_SAFE_INTEGER
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ToolError(`${key} must be an integer in [${min}, ${max}]`, 'invalid argument')
  }
  return value
}

export function strArg(input: Input, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolError(`${key} must be a non-empty string`, 'invalid argument')
  }
  return value
}

export function optStrArg(input: Input, key: string): string | undefined {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ToolError(`${key} must be a string`, 'invalid argument')
  return value
}
