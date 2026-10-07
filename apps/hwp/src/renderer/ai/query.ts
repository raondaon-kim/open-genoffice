import type { AiQueryName, RhwpEnvelope, RhwpResult } from '../../shared/ai-contract'
import type { HwpAiContext } from './context'
import { requireEditor, ToolError } from './errors'
import { ensureSnapshot } from './snapshots'

export interface QueryOutcome {
  envelope: RhwpEnvelope
  /** exit 3 — the CLI answered with data that says "no" (verify fail, ir-diff differs) */
  negative: boolean
}

/** exit-code contract → tool outcome (exit 2 is a bug in our argv, never a model retry) */
export function interpret(tool: string, result: RhwpResult): QueryOutcome {
  if (result.exitCode === 2) {
    throw new ToolError(
      `Tool argument error (do not retry): ${result.stderr.trim().slice(0, 400)}`,
      'argument error',
    )
  }
  if (result.exitCode === 1) {
    const detail = result.stderr.trim() || JSON.stringify(result.envelope ?? {})
    throw new ToolError(`rhwp ${tool} failed: ${detail.slice(0, 800)}`, 'engine error')
  }
  if (!result.envelope)
    throw new ToolError(`rhwp ${tool} returned no JSON envelope`, 'bad envelope')
  return { envelope: result.envelope, negative: result.exitCode === 3 }
}

/** snapshot of the current document → `rhwp <tool>` in main → envelope */
export async function runQuery(
  ctx: HwpAiContext,
  tool: AiQueryName,
  args: Record<string, unknown> = {},
): Promise<QueryOutcome> {
  const editor = requireEditor(ctx)
  const api = ctx.api()
  for (let attempt = 0; ; attempt++) {
    const snapshot = await ensureSnapshot(editor, ctx.stack, api)
    const response = await api.aiQuery({ sha: snapshot.sha, tool, args })
    if (response.ok) {
      ctx.stack.noteRead(snapshot.sha)
      return interpret(tool, response.result)
    }
    // main's per-view cache is small; if it dropped our snapshot, send it again once
    if (attempt === 0 && /snapshot missing/.test(response.error)) {
      ctx.stack.forgetSent(snapshot.sha)
      continue
    }
    throw new ToolError(response.error, 'query failed')
  }
}
