import { describe, expect, it } from 'vitest'
import { fetchExploreChips, READ_CHARS_CAP, readTools } from '../src/renderer/ai/tools/read'
import { call, ctxWith, env, fakeApi, fakeEditor, SHA } from './helpers/ai-fakes'

const FENCE = /⟦문서 내용:[0-9a-f]{16}⟧/
const unwrap = (s: string) => s.replace(/⟦\/?문서 내용:[0-9a-f]{16}⟧/g, '')

const explain = env({
  format: 'HWPX',
  pageCount: 3,
  paragraphCount: 7,
  encrypted: false,
  footnoteCount: 1,
  endnoteCount: 0,
  fields: ['회사명'],
  tables: [{ index: 0, rows: 3, cols: 2, hasMergedCells: false }],
  summary: '요약',
  untrustedContent: true,
  untrustedFields: ['summary'],
})
const structure = env({
  structure: { roots: [{ heading: '1. 개요', level: 1, section: 0, paragraph: 1 }] },
  untrustedFields: ['structure.roots[].heading'],
})
const explore = env({
  menu: [
    { why: '표 1개 — 격자 추출', command: 'x' },
    { why: '요약', command: 'y' },
    { why: '검색', command: 'z' },
    { why: '넷째', command: 'w' },
  ],
})

describe('get_document_overview', () => {
  it('merges explain/export_structure/explore, fences document text, and uploads the snapshot once', async () => {
    const api = fakeApi({ explain, export_structure: structure, explore })
    const ctx = ctxWith(api)
    const result = await readTools.execute(ctx, call('get_document_overview'))
    expect(result.isError).toBeUndefined()
    const out = JSON.parse(result.output)
    expect(out).toMatchObject({
      format: 'HWPX',
      pageCount: 3,
      paragraphCount: 7,
      fieldCount: 1,
      footnoteCount: 1,
      tables: [{ index: 0, rows: 3, cols: 2, hasMergedCells: false }],
    })
    expect(out.outline[0]).toMatchObject({ level: 1, section: 0, paragraph: 1 })
    expect(out.outline[0].heading).toMatch(FENCE)
    expect(unwrap(out.outline[0].heading)).toBe('1. 개요')
    expect(out.suggestedActions).toHaveLength(4)
    expect(out.suggestedActions[0]).toMatch(FENCE)
    expect(api.snapshots).toEqual([SHA])
    expect(api.queries.map((q) => q.tool).sort()).toEqual([
      'explain',
      'explore',
      'export_structure',
    ])
    expect(result.summary).toMatch(/HWPX.*3 page/)
  })
})

describe('read_pages', () => {
  const pageText = (n: number) =>
    env({ pages: [{ page: n, text: `쪽 ${n + 1} 본문` }], untrustedFields: ['pages[].text'] })

  it('reads 1-based pages as 0-based export-text calls, caps the range at the page count, and fences each page', async () => {
    const api = fakeApi({ export_text: (args) => pageText(args.page as number) })
    const result = await readTools.execute(ctxWith(api), call('read_pages', { start: 2, end: 9 }))
    expect(api.queries.map((q) => q.args.page)).toEqual([1, 2])
    expect(result.output).toMatch(/\[Page 2\]\n⟦문서 내용:[0-9a-f]{16}⟧쪽 2 본문⟦\/문서 내용/)
    expect(result.output).toContain('[Page 3]')
    expect(result.summary).toBe('pages 2-3 read')
  })

  it('rejects a start beyond the document and truncates over-long output', async () => {
    const api = fakeApi({
      export_text: (args) =>
        env({ pages: [{ page: args.page, text: 'x'.repeat(READ_CHARS_CAP) }] }),
    })
    const beyond = await readTools.execute(ctxWith(api), call('read_pages', { start: 4 }))
    expect(beyond.isError).toBe(true)
    expect(beyond.output).toMatch(/3 page/)
    const long = await readTools.execute(ctxWith(api), call('read_pages', { start: 1, end: 2 }))
    expect(long.output).toContain('[truncated')
    expect(
      unwrap(long.output)
        .replace(/\[Page \d\]\n?/g, '')
        .replace(/\n\[truncated.*$/s, '').length,
    ).toBeLessThanOrEqual(READ_CHARS_CAP)
  })
})

describe('find', () => {
  const search = env({
    query: '사업',
    totalMatchCount: 2,
    truncated: false,
    untrustedContent: true,
    untrustedFields: ['matches[].text', 'matches[].context'],
    matches: [
      {
        section: 0,
        paragraph: 48,
        charOffset: 9,
        length: 2,
        page: 2,
        text: '😀X 사업단',
        context: '…',
      },
      {
        section: 0,
        paragraph: 2,
        charOffset: 11,
        length: 2,
        page: 0,
        text: '표 안 사업',
        context: '…',
        cell: { cell: 0, control: 0, paragraph: 0 },
      },
    ],
  })
  const tables = env({
    tables: [{ index: 3, section: 0, paragraph: 2, control: 0, rows: 2, cols: 1, cells: [] }],
  })

  it('returns IR coordinates, 1-based pages, code-point paragraph lengths and resolves table hits', async () => {
    const api = fakeApi({ search, export_tables: tables })
    const result = await readTools.execute(ctxWith(api), call('find', { query: '사업' }))
    const out = JSON.parse(result.output)
    expect(api.queries[0]).toMatchObject({
      tool: 'search',
      args: { query: '사업', maxMatches: 20 },
    })
    expect(out.matches[0]).toMatchObject({
      section: 0,
      paragraph: 48,
      charOffset: 9,
      length: 2,
      page: 3,
      paragraphLength: 6,
    })
    expect(out.matches[0].text).toMatch(FENCE)
    expect(out.matches[0].inTable).toBeUndefined()
    expect(out.matches[1]).toMatchObject({ inTable: true, table: 3, page: 1 })
    expect(out.matches[1].hint).toMatch(/edit_table/)
    expect(result.summary).toBe('2 match(es)')
  })

  it('does not ask for tables when no match is inside one, and validates its input', async () => {
    const api = fakeApi({ search: env({ query: 'x', totalMatchCount: 0, matches: [] }) })
    await readTools.execute(ctxWith(api), call('find', { query: 'x', limit: 5 }))
    expect(api.queries.map((q) => q.tool)).toEqual(['search'])
    expect(api.queries[0].args.maxMatches).toBe(5)
    const bad = await readTools.execute(ctxWith(api), call('find', {}))
    expect(bad.isError).toBe(true)
    expect(bad.output).toMatch(/query/)
  })
})

describe('read_table / list_fields / get_document_state', () => {
  it('returns one table grid with fenced cell text and rejects unknown indices', async () => {
    const api = fakeApi({
      export_tables: env({
        tables: [
          {
            index: 0,
            section: 0,
            paragraph: 4,
            control: 0,
            rows: 3,
            cols: 2,
            cells: [
              { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: '항목' },
              { row: 0, col: 1, rowSpan: 1, colSpan: 2, text: '금액', nested: [{}] },
            ],
          },
        ],
      }),
    })
    const ok = await readTools.execute(ctxWith(api), call('read_table', { index: 0 }))
    const out = JSON.parse(ok.output)
    expect(out).toMatchObject({
      index: 0,
      rows: 3,
      cols: 2,
      section: 0,
      paragraph: 4,
      cellCount: 2,
      truncated: false,
    })
    expect(out.cells[1]).toMatchObject({ row: 0, col: 1, colSpan: 2, nestedTables: 1 })
    expect(unwrap(out.cells[0].text)).toBe('항목')
    const missing = await readTools.execute(ctxWith(api), call('read_table', { index: 5 }))
    expect(missing.isError).toBe(true)
    expect(missing.output).toMatch(/No table with index 5/)
  })

  it('lists fields with their paragraph coordinates', async () => {
    const api = fakeApi({
      fields: env({
        fieldCount: 1,
        fields: [
          {
            name: '회사명',
            guide: '여기에 입력',
            value: '유비온',
            fieldType: 'ClickHere',
            location: { section: 0, paragraph: 7, nested: [] },
          },
        ],
      }),
    })
    const result = await readTools.execute(ctxWith(api), call('list_fields'))
    const out = JSON.parse(result.output)
    expect(out.fields[0]).toMatchObject({
      name: '회사명',
      guide: '여기에 입력',
      section: 0,
      paragraph: 7,
    })
    expect(unwrap(out.fields[0].value)).toBe('유비온')
  })

  it('reports the live document state without touching the CLI', async () => {
    const api = fakeApi({})
    const result = await readTools.execute(ctxWith(api), call('get_document_state'))
    expect(JSON.parse(result.output)).toMatchObject({ format: 'hwpx', pageCount: 3, dirty: false })
    expect(api.queries).toEqual([])
  })
})

describe('failure mapping', () => {
  it('maps exit 2 to a do-not-retry error, exit 1 to an engine error, and IPC errors verbatim', async () => {
    const two = await readTools.execute(
      ctxWith(
        fakeApi({
          explain: { fail: { exitCode: 2, stderr: '알 수 없는 옵션' } },
          export_structure: structure,
          explore,
        }),
      ),
      call('get_document_overview'),
    )
    expect(two).toMatchObject({ isError: true, summary: 'argument error' })
    expect(two.output).toMatch(/do not retry.*알 수 없는 옵션/)
    const one = await readTools.execute(
      ctxWith(fakeApi({ fields: { fail: { exitCode: 1, stderr: '오류: 읽기 실패' } } })),
      call('list_fields'),
    )
    expect(one).toMatchObject({ isError: true, summary: 'engine error' })
    const ipc = await readTools.execute(
      ctxWith(fakeApi({ fields: { error: 'rhwp binary not found: C:/x/rhwp.exe' } })),
      call('list_fields'),
    )
    expect(ipc.output).toBe('rhwp binary not found: C:/x/rhwp.exe')
  })

  it('re-sends the snapshot once when main lost it', async () => {
    const api = fakeApi({
      fields: [
        { error: 'hwp: snapshot missing — send it again' },
        env({ fieldCount: 0, fields: [] }),
      ],
    })
    const result = await readTools.execute(ctxWith(api), call('list_fields'))
    expect(result.isError).toBeUndefined()
    expect(api.snapshots).toEqual([SHA, SHA])
  })

  it('fails cleanly without an editor', async () => {
    const result = await readTools.execute(ctxWith(fakeApi({}), null), call('list_fields'))
    expect(result).toMatchObject({ isError: true, output: 'The document is not open yet.' })
  })
})

describe('fetchExploreChips', () => {
  it('returns up to three explore reasons, or nothing when the query fails', async () => {
    expect(await fetchExploreChips(ctxWith(fakeApi({ explore })))).toEqual([
      '표 1개 — 격자 추출',
      '요약',
      '검색',
    ])
    expect(await fetchExploreChips(ctxWith(fakeApi({})))).toEqual([])
    expect(
      await fetchExploreChips(ctxWith(fakeApi({ explore }), fakeEditor({ pageCount: 0 }))),
    ).toHaveLength(3)
  })
})
