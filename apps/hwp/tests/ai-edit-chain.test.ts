/** @vitest-environment node */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeRhwpFailure, runEditChain } from '../src/main/ai-edit-chain'
import { sha256Hex } from '../src/main/ai-snapshots'
import type { RunRhwpFn } from '../src/main/rhwp-cli'
import type { RhwpResult } from '../src/shared/ai-contract'

let dir = ''
let snapshot = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-edit-chain-'))
  snapshot = join(dir, 'snap.hwpx')
  writeFileSync(snapshot, 'ORIGINAL')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** argv → {command, input, output, flags} for `rhwp edit …` and `rhwp ir-diff …` */
function parse(args: readonly string[]) {
  if (args[0] === 'ir-diff') return { command: 'ir-diff', a: args[1], b: args[2] }
  const output = args[args.indexOf('-o') + 1]
  return {
    command: args[1],
    input: args[2],
    output,
    flags: args.slice(3, args.indexOf('-o')),
    verify: args.includes('--verify'),
  }
}

const ok = (envelope: Record<string, unknown>): RhwpResult => ({
  exitCode: 0,
  envelope: { schemaVersion: '1.0', ...envelope },
  stderr: '',
})

/**
 * A CLI double: appends "+<command>" to the file for every edit step, reports
 * changedPages [n], and answers ir-diff with exit 3 when the files differ.
 * `script` can override a step by command name.
 */
function fakeRhwp(
  script: Record<string, (p: ReturnType<typeof parse>) => RhwpResult | 'nofile'> = {},
) {
  const calls: string[][] = []
  const run: RunRhwpFn = async (_bin, args) => {
    calls.push([...args])
    const p = parse(args)
    if (p.command === 'ir-diff') {
      const same = readFileSync(p.a!).equals(readFileSync(p.b!))
      return {
        exitCode: same ? 0 : 3,
        envelope: { schemaVersion: '1.0', identical: same, diffCount: same ? 0 : 3 },
        stderr: '',
      }
    }
    const custom = script[p.command!]?.(p)
    if (custom === 'nofile') return ok({ replacedCount: 0 })
    if (custom) {
      if (custom.exitCode === 0)
        writeFileSync(p.output!, `${readFileSync(p.input!, 'utf8')}+${p.command}`)
      return custom
    }
    writeFileSync(p.output!, `${readFileSync(p.input!, 'utf8')}+${p.command}`)
    return ok({
      changedPages: [calls.length - 1],
      ...(p.verify ? { verify: { identical: true, diffCount: 0 } } : {}),
    })
  }
  return { run, calls }
}

describe('runEditChain', () => {
  it('runs each compiled step on the previous output, verifies the last step and returns the bytes', async () => {
    const fake = fakeRhwp()
    const result = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      run: fake.run,
      ops: [
        { op: 'replace_phrase', find: '사업', replace: '프로젝트' },
        { op: 'set_paragraph_text', section: 0, paragraph: 2, text: '새 본문' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Buffer.from(result.data).toString()).toBe(
      'ORIGINAL+replace-text+delete-text+insert-text',
    )
    expect(result.outputSha).toBe(sha256Hex(new Uint8Array(result.data)))
    expect(result.changedPages).toEqual([0, 1, 2])
    expect(result.diffCount).toBe(3)
    expect(result.journal.map((j) => [j.opIndex, j.command])).toEqual([
      [0, 'replace-text'],
      [1, 'delete-text'],
      [1, 'insert-text'],
    ])
    const edits = fake.calls.filter((c) => c[0] === 'edit')
    expect(edits[0][2]).toBe(snapshot) // first input is the snapshot
    expect(edits[1][2]).toBe(parse(edits[0]).output) // chained
    expect(edits.map((c) => c.includes('--verify'))).toEqual([false, false, true])
    expect(edits.every((c) => c.includes('--json'))).toBe(true)
    expect(fake.calls.at(-1)![0]).toBe('ir-diff')
    expect(readFileSync(snapshot, 'utf8')).toBe('ORIGINAL') // never touched
    expect(readdirSync(dir)).toEqual(['snap.hwpx']) // temp files cleaned up
  })

  it('treats a step without an output file (replace-text with 0 hits) as a no-op', async () => {
    const fake = fakeRhwp({ 'replace-text': () => 'nofile' })
    const result = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      run: fake.run,
      ops: [
        { op: 'replace_phrase', find: 'x', replace: 'y' },
        { op: 'delete_row', table: 0, row: 0 },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.journal[0]).toMatchObject({ noop: true, command: 'replace-text' })
    expect(Buffer.from(result.data).toString()).toBe('ORIGINAL+delete-row')
  })

  it('returns the snapshot itself when every step was a no-op', async () => {
    const fake = fakeRhwp({ 'replace-text': () => 'nofile' })
    const result = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      run: fake.run,
      ops: [{ op: 'replace_phrase', find: 'x', replace: 'y' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Buffer.from(result.data).toString()).toBe('ORIGINAL')
    expect(result.diffCount).toBe(0)
    expect(fake.calls.some((c) => c[0] === 'ir-diff')).toBe(false)
  })

  it('tolerates a tolerated step (header already exists) and continues on the same input', async () => {
    const fake = fakeRhwp({
      'insert-header-footer': () => ({
        exitCode: 1,
        envelope: null,
        stderr: '오류: 이미 머리말(양 쪽)이 존재합니다',
      }),
    })
    const result = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      run: fake.run,
      ops: [{ op: 'header_text', section: 0, text: '머리말' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.journal).toMatchObject([
      { command: 'insert-header-footer', tolerated: true },
      { command: 'insert-header-footer-text' },
    ])
    expect(Buffer.from(result.data).toString()).toBe('ORIGINAL+insert-header-footer-text')
  })

  it('stops at the first real failure, reports the op index, and leaves no files behind', async () => {
    const fake = fakeRhwp({
      'set-cell': () => ({
        exitCode: 2,
        envelope: null,
        stderr: '오류: 좌표가 격자를 벗어났습니다 — 표 0 는 3x2 입니다.',
      }),
    })
    const result = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      run: fake.run,
      ops: [
        { op: 'replace_phrase', find: 'a', replace: 'b' },
        { op: 'set_cell', table: 0, row: 9, col: 0, text: 'x' },
        { op: 'delete_row', table: 0, row: 0 },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failedOp).toBe(1)
    expect(result.error).toMatch(/argument error \(do not retry\).*격자/)
    expect(result.result?.exitCode).toBe(2)
    expect(result.journal).toHaveLength(1)
    expect(fake.calls.filter((c) => c[0] === 'edit')).toHaveLength(2) // delete_row never ran
    expect(readdirSync(dir)).toEqual(['snap.hwpx'])
  })

  it('maps exit 1 and exit 3 failures to distinct messages', async () => {
    const runtime = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      ops: [{ op: 'delete_row', table: 0, row: 0 }],
      run: fakeRhwp({
        'delete-row': () => ({ exitCode: 1, envelope: null, stderr: '오류: 렌더링 실패' }),
      }).run,
    })
    expect(runtime).toMatchObject({
      ok: false,
      error: expect.stringMatching(/rhwp edit failed: 오류: 렌더링 실패/),
    })
    const negative = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      ops: [{ op: 'delete_row', table: 0, row: 0 }],
      run: fakeRhwp({
        'delete-row': () => ({
          exitCode: 3,
          envelope: { schemaVersion: '1.0', verdict: 'fail' },
          stderr: '',
        }),
      }).run,
    })
    expect(negative).toMatchObject({
      ok: false,
      error: expect.stringMatching(/negative result.*"verdict":"fail"/),
    })
  })

  it('rejects invalid ops before running anything', async () => {
    const run = vi.fn<RunRhwpFn>()
    const result = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      run,
      ops: [{ op: 'nope' }],
    })
    expect(result).toMatchObject({
      ok: false,
      failedOp: 0,
      error: expect.stringMatching(/unknown op/),
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('surfaces a runner exception (missing binary, timeout) as a failure of that op', async () => {
    const run: RunRhwpFn = async () => {
      throw new Error('rhwp binary not found or not executable: /bin/rhwp (ENOENT)')
    }
    const result = await runEditChain({
      rhwpPath: '/bin/rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      run,
      ops: [{ op: 'delete_row', table: 0, row: 0 }],
    })
    expect(result).toMatchObject({ ok: false, failedOp: 0, error: expect.stringMatching(/ENOENT/) })
    expect(existsSync(snapshot)).toBe(true)
  })
})

describe('round-trip check failure on a form that always fails it', () => {
  const explainOf = (paragraphCount: number): RhwpResult => ({
    exitCode: 0,
    envelope: {
      schemaVersion: '1.0',
      fields: ['제목'],
      tables: [{ rows: 2, cols: 2 }],
      paragraphCount,
      pageCount: 1,
    },
    stderr: '',
  })
  function verifyFails(paragraphsAfter: number) {
    const calls: string[][] = []
    const run: RunRhwpFn = async (_bin, args) => {
      calls.push([...args])
      if (args[0] === 'explain') return explainOf(args[1] === snapshot ? 9 : paragraphsAfter)
      if (args[0] === 'ir-diff') {
        return { exitCode: 3, envelope: { schemaVersion: '1.0', diffCount: 22 }, stderr: '' }
      }
      const output = args[args.indexOf('-o') + 1]!
      writeFileSync(output, `${readFileSync(args[2]!, 'utf8')}+${args[1]}`)
      return {
        exitCode: 3,
        envelope: {
          schemaVersion: '1.0',
          changedPages: [0],
          verify: { diffCount: 22, identical: false },
        },
        stderr: '',
      }
    }
    return { run, calls }
  }

  it('accepts the edit when the document summary matches the edit kind, and records it', async () => {
    const { run } = verifyFails(9)
    const result = await runEditChain({
      rhwpPath: 'rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      ops: [{ op: 'replace_phrase', find: '붙임', replace: '첨부' }],
      run,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layoutTolerant).toEqual({ pagesBefore: 1, pagesAfter: 1 })
    expect(result.journal.at(-1)).toMatchObject({ verify: 'layout-tolerant' })
    expect(result.changedPages).toEqual([0])
    expect(Buffer.from(result.data).toString()).toBe('ORIGINAL+replace-text')
  })

  it('refuses when the summary changed in a way the edit kind cannot explain', async () => {
    const { run } = verifyFails(8)
    const result = await runEditChain({
      rhwpPath: 'rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      ops: [{ op: 'replace_phrase', find: '붙임', replace: '첨부' }],
      run,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/paragraph count changed/)
    expect(readdirSync(dir)).toEqual(['snap.hwpx'])
  })

  it('refuses when the summary cannot be read', async () => {
    const { run: inner } = verifyFails(9)
    const run: RunRhwpFn = async (bin, args) =>
      args[0] === 'explain' ? { exitCode: 1, envelope: null, stderr: 'boom' } : inner(bin, args)
    const result = await runEditChain({
      rhwpPath: 'rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      ops: [{ op: 'replace_phrase', find: '붙임', replace: '첨부' }],
      run,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/summary could not be read/)
  })
})

describe('describeRhwpFailure hints', () => {
  it('tells the model to delete the whole table when the only row is removed', () => {
    const text = describeRhwpFailure({
      exitCode: 1,
      envelope: null,
      stderr: '오류: 행 삭제 실패 - 렌더링 오류: 최소 1행은 유지해야 합니다',
    })
    expect(text).toMatch(/delete_table/)
  })

  it('tells the model to empty the text when the last paragraph of a section is removed', () => {
    const text = describeRhwpFailure({
      exitCode: 1,
      envelope: null,
      stderr: '오류: 문단 삭제 실패 - 렌더링 오류: 구역의 마지막 문단은 삭제할 수 없습니다',
    })
    expect(text).toMatch(/set_paragraph_text/)
  })
})
