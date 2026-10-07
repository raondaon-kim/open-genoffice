import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiEditResult, EditJournalEntry, RhwpResult } from '../shared/ai-contract'
import { sha256Hex } from './ai-snapshots'
import { judgeLayoutTolerance, summaryOf } from './layout-tolerance'
import { expandLikeStep, expandSetStep } from './like-shape'
import { compileEditOps } from './rhwp-edit-ops'
import type { CompiledStep } from './rhwp-edit-ops'
import { runRhwp } from './rhwp-cli'
import type { RunRhwpFn } from './rhwp-cli'

/**
 * Executes a compiled edit chain: every step reads the previous step's output
 * (starting from the snapshot, which is never modified) and writes a fresh
 * temp file. The last step gets `--verify` (the CLI re-reads its own output);
 * `ir-diff snapshot → final` yields the change count. A step that fails ends
 * the chain — nothing has reached the renderer, so the document is unchanged.
 * Temp files live next to the snapshot and are removed before returning.
 */

export interface EditChainParams {
  rhwpPath: string
  snapshotPath: string
  /** directory for temp files (the owner's snapshot directory) */
  workDir: string
  ops: unknown
  run?: RunRhwpFn
  now?: () => number
  /** main-side builders only: lets internal ops (style_paragraph) through; never set from the renderer */
  allowInternal?: boolean
}

export function describeRhwpFailure(result: RhwpResult): string {
  switch (result.exitCode) {
    case 2:
      return `Tool argument error (do not retry): ${result.stderr.trim().slice(0, 400)}`
    case 3:
      return `rhwp reported a negative result: ${JSON.stringify(result.envelope ?? {}).slice(0, 800)}`
    default: {
      const detail = (result.stderr.trim() || JSON.stringify(result.envelope ?? {})).slice(0, 800)
      const hint = /최소 1행/.test(result.stderr)
        ? " — this is the table's only row: remove the whole table with delete_table instead."
        : /마지막 문단은 삭제할 수 없/.test(result.stderr)
          ? ' — the last paragraph of a section cannot be removed: empty it with set_paragraph_text and an empty text instead.'
          : ''
      return `rhwp edit failed: ${detail}${hint}`
    }
  }
}

function pagesOf(envelope: RhwpResult['envelope']): number[] {
  const pages = envelope?.changedPages
  return Array.isArray(pages) ? pages.filter((p): p is number => typeof p === 'number') : []
}

export async function runEditChain(params: EditChainParams): Promise<AiEditResult> {
  const run = params.run ?? runRhwp
  const compiled = compileEditOps(params.ops, { allowInternal: params.allowInternal === true })
  if (!compiled.ok) {
    return {
      ok: false,
      failedOp: compiled.index < 0 ? null : compiled.index,
      error: compiled.error,
      journal: [],
    }
  }
  await mkdir(params.workDir, { recursive: true })
  const stamp = `${process.pid}-${(params.now ?? Date.now)()}`
  const temps: string[] = []
  const journal: EditJournalEntry[] = []
  const changed = new Set<number>()
  let current = params.snapshotPath
  let layoutTolerant: { pagesBefore: number; pagesAfter: number } | undefined

  const cleanup = () => Promise.all(temps.map((path) => rm(path, { force: true })))
  const fail = async (
    step: CompiledStep,
    error: string,
    result?: RhwpResult,
  ): Promise<AiEditResult> => {
    await cleanup()
    return { ok: false, failedOp: step.opIndex, error, ...(result ? { result } : {}), journal }
  }

  const queue: CompiledStep[] = [...compiled.steps]
  const derivedNotes = new Map<number, { lead: number; step: number }>()
  let stepNo = 0
  while (queue.length > 0) {
    const step = queue.shift()!
    if (step.dynamic || step.setText) {
      // a template step: read the document as it is right now and turn it into concrete steps
      const expanded = step.dynamic
        ? await expandLikeStep(run, params.rhwpPath, current, step)
        : await expandSetStep(run, params.rhwpPath, current, step)
      if (!expanded.ok) return fail(step, expanded.error)
      if (expanded.derived) derivedNotes.set(step.opIndex, expanded.derived)
      queue.unshift(...expanded.steps)
      continue
    }
    const output = join(params.workDir, `edit-${stamp}-${stepNo++}.hwpx`)
    temps.push(output)
    const last = queue.length === 0
    const args = [
      'edit',
      step.command,
      current,
      ...step.flags,
      '-o',
      output,
      '--json',
      ...(last ? ['--verify'] : []),
    ]
    let result: RhwpResult
    try {
      result = await run(params.rhwpPath, args)
    } catch (err) {
      return fail(step, err instanceof Error ? err.message : String(err))
    }
    const derived = derivedNotes.get(step.opIndex)
    derivedNotes.delete(step.opIndex)
    const base = {
      opIndex: step.opIndex,
      op: (params.ops as Array<{ op: EditJournalEntry['op'] }>)[step.opIndex].op,
      command: step.command,
      envelope: result.envelope,
      ...(derived ? { derived } : {}),
    }
    if (result.exitCode !== 0) {
      if (last && result.exitCode === 3 && existsSync(output)) {
        // the save round-trip check failed: judge by the document summary (spec §4.3)
        const verdict = await acceptRoundTripFailure(run, params, output)
        if (verdict.ok) {
          layoutTolerant = verdict.pages
          journal.push({ ...base, verify: 'layout-tolerant' })
          for (const page of pagesOf(result.envelope)) changed.add(page)
          current = output
          continue
        }
        return fail(step, `${describeRhwpFailure(result)} — ${verdict.reason}`, result)
      }
      if (step.tolerate && result.exitCode === 1 && step.tolerate.test(result.stderr)) {
        journal.push({ ...base, tolerated: true })
        continue
      }
      return fail(step, describeRhwpFailure(result), result)
    }
    if (!existsSync(output)) {
      // e.g. replace-text with zero hits: exit 0, no file — nothing changed
      journal.push({ ...base, noop: true })
      continue
    }
    journal.push(base)
    for (const page of pagesOf(result.envelope)) changed.add(page)
    current = output
  }

  const bytes = await readFile(current)
  let diffCount: number | null = 0
  if (current !== params.snapshotPath) {
    try {
      const diff = await run(params.rhwpPath, ['ir-diff', params.snapshotPath, current, '--json'])
      diffCount =
        diff.exitCode === 0 || diff.exitCode === 3
          ? ((diff.envelope?.diffCount as number | undefined) ?? null)
          : null
    } catch {
      diffCount = null
    }
  }
  await cleanup()
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return {
    ok: true,
    data,
    outputSha: sha256Hex(new Uint8Array(data)),
    changedPages: [...changed].sort((a, b) => a - b),
    diffCount,
    ...(layoutTolerant ? { layoutTolerant } : {}),
    journal,
  }
}

async function acceptRoundTripFailure(
  run: RunRhwpFn,
  params: EditChainParams,
  output: string,
): Promise<
  { ok: true; pages: { pagesBefore: number; pagesAfter: number } } | { ok: false; reason: string }
> {
  const unreadable = { ok: false as const, reason: 'the document summary could not be read' }
  try {
    const [before, after] = await Promise.all([
      run(params.rhwpPath, ['explain', params.snapshotPath, '--json']),
      run(params.rhwpPath, ['explain', output, '--json']),
    ])
    const a = before.exitCode === 0 ? summaryOf(before.envelope) : null
    const b = after.exitCode === 0 ? summaryOf(after.envelope) : null
    if (!a || !b) return unreadable
    const ops = (params.ops as Array<{ op: string }>).map((op) => op.op)
    const verdict = judgeLayoutTolerance(ops, a, b)
    return verdict.ok
      ? { ok: true, pages: { pagesBefore: a.pageCount, pagesAfter: b.pageCount } }
      : verdict
  } catch {
    return unreadable
  }
}
