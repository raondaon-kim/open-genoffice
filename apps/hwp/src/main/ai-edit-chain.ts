import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiEditResult, EditJournalEntry, RhwpResult } from '../shared/ai-contract'
import { sha256Hex } from './ai-snapshots'
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
}

export function describeRhwpFailure(result: RhwpResult): string {
  switch (result.exitCode) {
    case 2:
      return `Tool argument error (do not retry): ${result.stderr.trim().slice(0, 400)}`
    case 3:
      return `rhwp reported a negative result: ${JSON.stringify(result.envelope ?? {}).slice(0, 800)}`
    default:
      return `rhwp edit failed: ${(result.stderr.trim() || JSON.stringify(result.envelope ?? {})).slice(0, 800)}`
  }
}

function pagesOf(envelope: RhwpResult['envelope']): number[] {
  const pages = envelope?.changedPages
  return Array.isArray(pages) ? pages.filter((p): p is number => typeof p === 'number') : []
}

export async function runEditChain(params: EditChainParams): Promise<AiEditResult> {
  const run = params.run ?? runRhwp
  const compiled = compileEditOps(params.ops)
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

  const cleanup = () => Promise.all(temps.map((path) => rm(path, { force: true })))
  const fail = async (
    step: CompiledStep,
    error: string,
    result?: RhwpResult,
  ): Promise<AiEditResult> => {
    await cleanup()
    return { ok: false, failedOp: step.opIndex, error, ...(result ? { result } : {}), journal }
  }

  for (let i = 0; i < compiled.steps.length; i++) {
    const step = compiled.steps[i]
    const output = join(params.workDir, `edit-${stamp}-${i}.hwpx`)
    temps.push(output)
    const last = i === compiled.steps.length - 1
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
    const base = {
      opIndex: step.opIndex,
      op: (params.ops as Array<{ op: EditJournalEntry['op'] }>)[step.opIndex].op,
      command: step.command,
      envelope: result.envelope,
    }
    if (result.exitCode !== 0) {
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
    journal,
  }
}
