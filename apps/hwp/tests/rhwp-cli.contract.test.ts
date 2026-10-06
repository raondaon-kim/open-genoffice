/** @vitest-environment node */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { judgeLayoutTolerance, summaryOf } from '../src/main/layout-tolerance'
import { resolveNativeBinary } from '../src/main/native-binary-path'
import { runRhwp } from '../src/main/rhwp-cli'
import { parseDumpParagraphs } from '../src/main/rhwp-paragraphs'
import type { RhwpEnvelope } from '../src/shared/ai-contract'

/**
 * Pins the rhwp CLI behaviour the AI tools rely on (spec §14) against the real
 * bundled binary. Skipped when the binary has not been fetched.
 */

const REPO_ROOT = resolve(__dirname, '../../..')
const BIN = resolveNativeBinary('rhwp', {
  isPackaged: false,
  resourcesPath: '',
  repoRoot: REPO_ROOT,
  platform: process.platform,
  arch: process.arch,
})
const HAVE_BIN = existsSync(BIN)
const SPEC = join(__dirname, 'fixtures', 'scaffold-basic.json')

let dir = ''
let doc = ''
const at = (name: string) => join(dir, name)
const rhwp = (...args: string[]) => runRhwp(BIN, args)
const envelope = async (...args: string[]): Promise<RhwpEnvelope> => {
  const result = await rhwp(...args)
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.envelope).not.toBeNull()
  return result.envelope!
}
const edit = (input: string, output: string, sub: string, ...flags: string[]) =>
  rhwp('edit', sub, input, ...flags, '-o', output, '--json')

interface Match {
  section: number
  paragraph: number
  charOffset: number
  length: number
  page: number
  text: string
  cell?: { cell: number; control: number; paragraph: number }
}
const search = async (file: string, query: string): Promise<Match[]> =>
  (await envelope('search', file, '--json', '--', query)).matches as Match[]

describe.skipIf(!HAVE_BIN)('rhwp CLI contract (real binary)', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rhwp-contract-'))
    doc = at('basic.hwpx')
    const made = await rhwp('scaffold', SPEC, '-o', doc, '--json')
    expect(made.exitCode, made.stderr).toBe(0)
  })
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('reports the version this suite was written against', async () => {
    const result = await rhwp('--version')
    expect(result.stderr + JSON.stringify(result.envelope)).toMatch(/0\.8\.6|null/)
  })

  it('explain/export-tables describe the fixture with IR coordinates', async () => {
    const explain = await envelope('explain', doc, '--json')
    expect(explain).toMatchObject({
      format: 'HWPX',
      pageCount: 1,
      paragraphCount: 7,
      encrypted: false,
      footnoteCount: 0,
      tables: [{ index: 0, rows: 3, cols: 2, hasMergedCells: false }],
    })
    expect(explain.untrustedFields).toContain('summary')
    const tables = await envelope('export-tables', doc, '--json')
    expect(tables.tables).toMatchObject([{ index: 0, section: 0, paragraph: 4, control: 0 }])
    expect((tables.tables as Array<{ cells: unknown[] }>)[0].cells).toHaveLength(6)
    expect(tables.untrustedFields).toContain('tables[].cells[].text')
  })

  it('search returns paragraph-level matches and marks document text untrusted', async () => {
    const result = await envelope('search', doc, '--json', '--', '문단')
    expect(result.untrustedContent).toBe(true)
    expect(result.untrustedFields).toEqual(
      expect.arrayContaining(['matches[].text', 'matches[].context']),
    )
    const matches = result.matches as Match[]
    expect(matches.map((m) => [m.paragraph, m.charOffset, m.length])).toEqual([
      [2, 2, 2],
      [3, 3, 2],
      [6, 4, 2],
    ])
    expect(matches[0].text).toBe('첫 문단입니다. 사업 계획을 설명합니다.')
    expect(matches[0].cell).toBeUndefined()
    // the table's cell text is searchable too and carries cell coordinates
    const cellHits = await search(doc, '인건비')
    expect(cellHits[0]).toMatchObject({ paragraph: 4, cell: { control: 0 } })
  })

  it('export-text -p is 0-based and wraps page text as untrusted', async () => {
    const result = await envelope('export-text', '--json', doc, '-p', '0')
    expect(result.pages).toMatchObject([{ page: 0 }])
    expect((result.pages as Array<{ text: string }>)[0].text).toContain('첫 문단입니다')
    expect(result.untrustedFields).toContain('pages[].text')
  })

  it('offsets are code points (an emoji counts as one)', async () => {
    const e1 = at('emoji1.hwpx')
    const e2 = at('emoji2.hwpx')
    const first = await edit(
      doc,
      e1,
      'insert-text',
      '--section',
      '0',
      '--para',
      '2',
      '--offset',
      '0',
      '--text',
      '😀',
    )
    expect(first.envelope).toMatchObject({ insertedChars: 1 })
    await edit(
      e1,
      e2,
      'insert-text',
      '--section',
      '0',
      '--para',
      '2',
      '--offset',
      '1',
      '--text',
      'X',
    )
    const hits = await search(e2, 'X')
    expect(hits[0]).toMatchObject({ paragraph: 2, charOffset: 1 })
    expect(hits[0].text.startsWith('😀X')).toBe(true)
  })

  it('insert-paragraph inserts BEFORE the given index; index == count appends; beyond is exit 2', async () => {
    const out = at('para.hwpx')
    await edit(doc, out, 'insert-paragraph', '--section', '0', '--para', '3')
    const shifted = await search(out, '둘째 문단')
    expect(shifted[0].paragraph).toBe(4)
    const append = await rhwp(
      'edit',
      'insert-paragraph',
      doc,
      '--section',
      '0',
      '--para',
      '7',
      '--dry-run',
      '--json',
    )
    expect(append.exitCode).toBe(0)
    const beyond = await rhwp(
      'edit',
      'insert-paragraph',
      doc,
      '--section',
      '0',
      '--para',
      '8',
      '--dry-run',
      '--json',
    )
    expect(beyond.exitCode).toBe(2)
    expect(beyond.stderr).toMatch(/범위/)
  })

  it('delete-text clamps an oversized --count to the paragraph end', async () => {
    const out = at('cleared.hwpx')
    const result = await edit(
      doc,
      out,
      'delete-text',
      '--section',
      '0',
      '--para',
      '2',
      '--offset',
      '0',
      '--count',
      '1000000',
    )
    expect(result.exitCode).toBe(0)
    expect(await search(out, '첫 문단')).toEqual([])
    const count = await envelope('word-count', '--json', out)
    expect(count.paragraphCount).toBe(7)
  })

  it('replace-text with zero hits exits 0 without writing an output file', async () => {
    const out = at('nohit.hwpx')
    const result = await edit(doc, out, 'replace-text', '--find', '없는문구', '--replace', 'x')
    expect(result.exitCode).toBe(0)
    expect(result.envelope).toMatchObject({ replacedCount: 0 })
    expect(existsSync(out)).toBe(false)
  })

  it('a chain with --verify on the last step round-trips and ir-diff reports the change (exit 3)', async () => {
    const t1 = at('chain1.hwpx')
    const t2 = at('chain2.hwpx')
    const first = await edit(doc, t1, 'replace-text', '--find', '사업', '--replace', '프로젝트')
    expect(first.envelope).toMatchObject({ replacedCount: 1, changedPages: [0] })
    const second = await rhwp(
      'edit',
      'set-cell',
      t1,
      '--table',
      '0',
      '--row',
      '1',
      '--col',
      '1',
      '--text',
      '900,000',
      '-o',
      t2,
      '--json',
      '--verify',
    )
    expect(second.exitCode).toBe(0)
    expect(second.envelope).toMatchObject({ verify: { identical: true }, overflow: [] })
    const diff = await rhwp('ir-diff', doc, t2, '--json')
    expect(diff.exitCode).toBe(3)
    expect((diff.envelope!.diffCount as number) > 0).toBe(true)
    const same = await rhwp('ir-diff', doc, doc, '--json')
    expect(same.exitCode).toBe(0)
    expect(same.envelope).toMatchObject({ identical: true, diffCount: 0 })
  })

  it('apply-char-format fontSize is in 1/100 pt (1300 = 13 pt), as the app converts it', async () => {
    const out = at('size13.hwpx')
    const result = await edit(
      doc,
      out,
      'apply-char-format',
      '--props',
      '{"fontSize":1300}',
      '--section',
      '0',
      '--para',
      '2',
    )
    expect(result.exitCode, result.stderr).toBe(0)
    const dumped = await runRhwp(BIN, ['dump', out], { keepStdout: true })
    const block = (dumped.stdout ?? '').split('--- 문단 ').find((b) => b.startsWith('0.2 ')) ?? ''
    expect(block).toMatch(/base=1300\b/)
  })

  it('apply-char-format/apply-para-format change the document only for known props', async () => {
    const diffCount = async (sub: string, props: string): Promise<number> => {
      const out = at(`fmt-${Math.random().toString(36).slice(2)}.hwpx`)
      const result = await edit(doc, out, sub, '--props', props, '--section', '0', '--para', '2')
      expect(result.exitCode, result.stderr).toBe(0)
      const diff = await rhwp('ir-diff', doc, out, '--json')
      return diff.envelope!.diffCount as number
    }
    expect(await diffCount('apply-char-format', '{"bold":true}')).toBeGreaterThan(0)
    expect(await diffCount('apply-char-format', '{"textColor":"#FF0000"}')).toBeGreaterThan(0)
    expect(await diffCount('apply-char-format', '{"fontSize":20}')).toBeGreaterThan(0)
    expect(await diffCount('apply-char-format', '{"zzz":1}')).toBe(0)
    expect(await diffCount('apply-para-format', '{"alignment":"center"}')).toBeGreaterThan(0)
    expect(await diffCount('apply-para-format', '{"lineSpacing":160}')).toBeGreaterThan(0)
  })

  it('header text needs an existing header; creating one twice is refused', async () => {
    const noHeader = await edit(
      doc,
      at('hf0.hwpx'),
      'insert-header-footer-text',
      '--header',
      '--section',
      '0',
      '--text',
      '머리말',
    )
    expect(noHeader.exitCode).toBe(1)
    expect(noHeader.stderr).toMatch(/존재하지 않/)
    const hf1 = at('hf1.hwpx')
    expect(
      (await edit(doc, hf1, 'insert-header-footer', '--header', '--section', '0')).exitCode,
    ).toBe(0)
    const again = await edit(
      hf1,
      at('hf1b.hwpx'),
      'insert-header-footer',
      '--header',
      '--section',
      '0',
    )
    expect(again.exitCode).toBe(1)
    expect(again.stderr).toMatch(/이미/)
    const withText = await edit(
      hf1,
      at('hf2.hwpx'),
      'insert-header-footer-text',
      '--header',
      '--section',
      '0',
      '--text',
      '머리말',
    )
    expect(withText.envelope).toMatchObject({ insertedChars: 3, isHeader: true })
  })

  it('footnote + footnote text land in the paragraph (ctrl 0 = first footnote)', async () => {
    const fn1 = at('fn1.hwpx')
    const fn2 = at('fn2.hwpx')
    await edit(doc, fn1, 'insert-footnote', '--section', '0', '--para', '2', '--offset', '5')
    const text = await edit(
      fn1,
      fn2,
      'insert-footnote-text',
      '--section',
      '0',
      '--para',
      '2',
      '--ctrl',
      '0',
      '--text',
      '각주 본문',
    )
    expect(text.exitCode, text.stderr).toBe(0)
    expect(await envelope('explain', fn2, '--json')).toMatchObject({ footnoteCount: 1 })
  })

  it('exit codes: 1 missing file, 2 unknown option / out-of-range, 3 negative verify', async () => {
    expect((await rhwp('explain', at('nope.hwpx'), '--json')).exitCode).toBe(1)
    const usage = await rhwp('edit', 'insert-text', doc, '--bogus', '1', '--json')
    expect(usage.exitCode).toBe(2)
    expect(usage.stderr).toMatch(/--bogus/)
    const grid = await rhwp(
      'edit',
      'set-cell',
      doc,
      '--table',
      '0',
      '--row',
      '99',
      '--col',
      '0',
      '--text',
      'v',
      '--dry-run',
      '--json',
    )
    expect(grid.exitCode).toBe(2)
    const verify = await rhwp('verify', doc, '--expect-pages', '99', '--json')
    expect(verify.exitCode).toBe(3)
    expect(verify.envelope).toMatchObject({ verdict: 'fail' })
  })

  it('fields/fill-fields envelopes (only with a form sample: HWP_FIELDS_SAMPLE=<path>)', async () => {
    const sample = process.env.HWP_FIELDS_SAMPLE
    if (!sample || !existsSync(sample)) return
    const fields = await envelope('fields', sample, '--json')
    expect((fields.fieldCount as number) > 0).toBe(true)
    expect(
      (fields.fields as Array<{ name: string; location: { paragraph: number } }>)[0],
    ).toMatchObject({
      location: { paragraph: expect.any(Number) },
    })
    const dry = await rhwp(
      'edit',
      'fill-fields',
      sample,
      '--data',
      '{"__없는필드__":"x"}',
      '--dry-run',
      '--json',
    )
    expect(dry.envelope).toMatchObject({ notFound: ['__없는필드__'], filledCount: 0 })
  })

  it('dump lists body paragraphs with the same coordinates search reports', async () => {
    const dumped = await runRhwp(BIN, ['dump', doc], { keepStdout: true })
    expect(dumped.exitCode, dumped.stderr).toBe(0)
    const paragraphs = parseDumpParagraphs(dumped.stdout ?? '')
    expect(paragraphs.length).toBeGreaterThan(3)
    const [hit] = await search(doc, '마지막 문단')
    const same = paragraphs.find(
      (p) => p.section === hit!.section && p.paragraph === hit!.paragraph,
    )
    expect(same?.preview).toContain('마지막 문단')
    expect(paragraphs.some((p) => p.hasTable)).toBe(true)
    expect(paragraphs.some((p) => p.empty)).toBe(true)
    // the first run's size is read in points (dump prints 1/100 pt): plausible text sizes
    const sizes = paragraphs.filter((p) => !p.empty).map((p) => p.fontSize)
    expect(sizes.every((s) => typeof s === 'number' && s >= 5 && s <= 100)).toBe(true)
  })

  it('delete-table removes a whole table and passes the round-trip check', async () => {
    const before = summaryOf(await envelope('explain', doc, '--json'))!
    const out = at('no-table.hwpx')
    const result = await rhwp(
      'edit',
      'delete-table',
      doc,
      '--table',
      '0',
      '-o',
      out,
      '--json',
      '--verify',
    )
    expect(result.exitCode, result.stderr).toBe(0)
    const after = summaryOf(await envelope('explain', out, '--json'))!
    expect(after.tables.length).toBe(before.tables.length - 1)
  })

  it('explain exposes the summary the round-trip tolerance relies on, and it moves with the edit kind', async () => {
    const before = summaryOf(await envelope('explain', doc, '--json'))
    expect(before).not.toBeNull()
    expect(before!.tables.length).toBeGreaterThan(0)
    const grown = at('summary-row.hwpx')
    expect((await edit(doc, grown, 'insert-row', '--table', '0', '--row', '0')).exitCode).toBe(0)
    const afterRow = summaryOf(await envelope('explain', grown, '--json'))!
    expect(afterRow.tables[0]!.rows).toBe(before!.tables[0]!.rows + 1)
    expect(afterRow.paragraphCount).toBe(before!.paragraphCount)
    expect(judgeLayoutTolerance(['insert_row'], before!, afterRow)).toEqual({ ok: true })
    const shorter = at('summary-para.hwpx')
    expect(
      (await edit(doc, shorter, 'delete-paragraph', '--section', '0', '--para', '1')).exitCode,
    ).toBe(0)
    const afterPara = summaryOf(await envelope('explain', shorter, '--json'))!
    expect(afterPara.paragraphCount).toBe(before!.paragraphCount - 1)
    expect(judgeLayoutTolerance(['delete_paragraph'], before!, afterPara)).toEqual({ ok: true })
    expect(judgeLayoutTolerance(['set_paragraph_text'], before!, afterPara)).toMatchObject({
      ok: false,
    })
  })
})
