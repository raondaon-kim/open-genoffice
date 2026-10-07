/** @vitest-environment node */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DocStyle, StyleRole } from '../src/shared/doc-style'
import type { RunRhwpFn } from '../src/main/rhwp-cli'
import { buildStyledDocument, MAX_STYLED_BLOCKS } from '../src/main/styled-document'

const role = (id: string, over: Partial<StyleRole> = {}): StyleRole => ({
  id,
  label: id,
  marker: 'text',
  lead: 0,
  size: 13,
  bold: false,
  align: 'justify',
  marginLeft: 0,
  marginRight: 0,
  indent: 0,
  spacingBefore: 0,
  spacingAfter: 0,
  lineSpacing: 160,
  ...over,
})

const style: DocStyle = {
  id: 'test-gian',
  title: '시험 기안문',
  version: 1,
  evidence: { documents: 1, note: '합성' },
  page: {
    paper: 'A4 세로',
    marginMm: { left: 20, right: 15, top: 20, bottom: 15 },
    settable: false,
  },
  roles: [
    role('org-name', { size: 20, align: 'center', bold: true, lineSpacing: 150 }),
    role('item-1', { marker: 'N.', indent: 660, lineSpacing: 180 }),
    role('item-2', { marker: '가.', lead: 2, indent: 660, lineSpacing: 180 }),
    role('gap', { size: 6 }),
  ],
  skeleton: [
    { slot: 'org', role: 'org-name', required: true },
    { slot: 'body', roles: ['item-1', 'item-2'], repeat: true },
  ],
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'styled-doc-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** a CLI double: scaffold reports the block count (or a wrong one); edits append a mark to the file */
function fake(opts: { paragraphCount?: (blocks: number) => number } = {}) {
  const calls: string[][] = []
  const specs: Array<{ blocks: Array<{ type: string; text: string }>; title?: string }> = []
  const run: RunRhwpFn = async (_bin, args) => {
    calls.push([...args])
    if (args[0] === 'scaffold') {
      const spec = JSON.parse(readFileSync(args[1]!, 'utf8'))
      specs.push(spec)
      writeFileSync(args[args.indexOf('-o') + 1]!, 'SCAFFOLD')
      const count = opts.paragraphCount
        ? opts.paragraphCount(spec.blocks.length)
        : spec.blocks.length
      return {
        exitCode: 0,
        envelope: { schemaVersion: '1.0', paragraphCount: count, blockCount: spec.blocks.length },
        stderr: '',
      }
    }
    if (args[0] === 'ir-diff') {
      return {
        exitCode: 0,
        envelope: { schemaVersion: '1.0', identical: true, diffCount: 0 },
        stderr: '',
      }
    }
    const output = args[args.indexOf('-o') + 1]!
    writeFileSync(output, `${readFileSync(args[2]!, 'utf8')}+`)
    return {
      exitCode: 0,
      envelope: {
        schemaVersion: '1.0',
        changedPages: [0],
        ...(args.includes('--verify') ? { verify: { identical: true, diffCount: 0 } } : {}),
      },
      stderr: '',
    }
  }
  return { run, calls, specs }
}

const build = (blocks: Array<{ role: string; text: string }>, f = fake()) =>
  buildStyledDocument(style, blocks, { run: f.run, rhwpPath: '/bin/rhwp', workDir: dir })

describe('buildStyledDocument', () => {
  it('turns blocks into scaffold paragraphs (no title, role leading spaces, model spaces ignored)', async () => {
    const f = fake()
    const result = await build(
      [
        { role: 'org-name', text: '서울특별시 인재개발담당관' },
        { role: 'item-1', text: '1. 관련' },
        { role: 'item-2', text: '   가. 근거 문서' },
        { role: 'gap', text: '' },
      ],
      f,
    )
    expect(result.ok).toBe(true)
    expect(f.specs[0]).toEqual({
      version: '1',
      blocks: [
        { type: 'paragraph', text: '서울특별시 인재개발담당관' },
        { type: 'paragraph', text: '1. 관련' },
        { type: 'paragraph', text: '  가. 근거 문서' },
        // a truly empty paragraph cannot take a character format: a blank line is one space
        { type: 'paragraph', text: ' ' },
      ],
    })
  })

  it('styles every paragraph with its role: shape and character values, one op per block', async () => {
    const f = fake()
    const result = await build(
      [
        { role: 'org-name', text: '기관명' },
        { role: 'item-2', text: '가. 항목' },
      ],
      f,
    )
    expect(result.ok).toBe(true)
    const edits = f.calls.filter((c) => c[0] === 'edit')
    expect(edits.map((c) => c[1])).toEqual([
      'apply-para-format',
      'apply-char-format',
      'apply-para-format',
      'apply-char-format',
    ])
    expect(JSON.parse(edits[0]![edits[0]!.indexOf('--props') + 1]!)).toEqual({
      alignment: 'center',
      marginLeft: 0,
      marginRight: 0,
      indent: 0,
      spacingBefore: 0,
      spacingAfter: 0,
      lineSpacing: 150,
    })
    expect(JSON.parse(edits[1]![edits[1]!.indexOf('--props') + 1]!)).toEqual({
      fontSize: 2000,
      bold: true,
    })
    // paragraph indexes follow the block order
    expect(edits[0]![edits[0]!.indexOf('--para') + 1]).toBe('0')
    expect(edits[2]![edits[2]!.indexOf('--para') + 1]).toBe('1')
  })

  it('reports counts per role and no warning when the required parts are there', async () => {
    const result = await build([
      { role: 'org-name', text: 'a' },
      { role: 'item-1', text: 'b' },
      { role: 'item-1', text: 'c' },
    ])
    expect(result).toMatchObject({
      ok: true,
      paragraphs: 3,
      roleCounts: { 'org-name': 1, 'item-1': 2 },
      warnings: [],
    })
  })

  it('warns about a required skeleton part that is missing (and still builds)', async () => {
    const result = await build([{ role: 'item-1', text: '1. 본문만' }])
    expect(result).toMatchObject({ ok: true, warnings: [expect.stringMatching(/org/)] })
  })

  it('splits long documents into chunks of 20 ops and verifies each chunk', async () => {
    const f = fake()
    const blocks = Array.from({ length: 45 }, (_, i) => ({
      role: 'item-1',
      text: `${i + 1}. 항목`,
    }))
    const result = await build(blocks, f)
    expect(result.ok).toBe(true)
    const edits = f.calls.filter((c) => c[0] === 'edit')
    expect(edits).toHaveLength(90)
    expect(edits.filter((c) => c.includes('--verify'))).toHaveLength(3)
    // the last paragraph got its style
    expect(edits.at(-1)![edits.at(-1)!.indexOf('--para') + 1]).toBe('44')
    expect(readdirSync(dir)).toEqual([])
  })

  it.each([
    ['no blocks', []],
    ['an unknown role', [{ role: 'nope', text: 'x' }]],
    ['a newline in the text', [{ role: 'item-1', text: '가\n나' }]],
    ['a tab in the text', [{ role: 'item-1', text: '가\t나' }]],
    ['a text that is not a string', [{ role: 'item-1', text: 5 }]],
  ])('rejects %s without running anything', async (_label, blocks) => {
    const f = fake()
    const result = await build(blocks as never, f)
    expect(result).toMatchObject({ ok: false })
    expect(f.calls).toHaveLength(0)
  })

  it('rejects more than the maximum number of blocks', async () => {
    const blocks = Array.from({ length: MAX_STYLED_BLOCKS + 1 }, () => ({
      role: 'item-1',
      text: 'x',
    }))
    expect(await build(blocks)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/at most/),
    })
  })

  it('stops when scaffold makes a different number of paragraphs than blocks', async () => {
    const f = fake({ paragraphCount: (n) => n + 1 })
    const result = await build([{ role: 'item-1', text: 'x' }], f)
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/paragraph/) })
    expect(f.calls.filter((c) => c[0] === 'edit')).toHaveLength(0)
    expect(readdirSync(dir)).toEqual([])
  })

  it('numbers a failing block across chunks (the failure is in the second chunk)', async () => {
    const f = fake()
    const failing: RunRhwpFn = async (bin, args, o) =>
      args[0] === 'edit' &&
      args[1] === 'apply-char-format' &&
      args[args.indexOf('--para') + 1] === '22'
        ? { exitCode: 1, envelope: null, stderr: 'boom' }
        : f.run(bin, args, o)
    const blocks = Array.from({ length: 25 }, (_, i) => ({
      role: 'item-1',
      text: `${i + 1}. 항목`,
    }))
    const result = await buildStyledDocument(style, blocks, {
      run: failing,
      rhwpPath: '/bin/rhwp',
      workDir: dir,
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/block 23/) })
    expect(readdirSync(dir)).toEqual([])
  })

  it('reports a failing chunk with the block it belongs to', async () => {
    const f = fake()
    const failing: RunRhwpFn = async (bin, args, o) =>
      args[0] === 'edit' && args[1] === 'apply-char-format'
        ? { exitCode: 1, envelope: null, stderr: 'boom' }
        : f.run(bin, args, o)
    const result = await buildStyledDocument(style, [{ role: 'item-1', text: 'x' }], {
      run: failing,
      rhwpPath: '/bin/rhwp',
      workDir: dir,
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/block 1/) })
    expect(readdirSync(dir)).toEqual([])
  })
})
