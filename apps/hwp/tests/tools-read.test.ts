import { describe, expect, it } from 'vitest'
import {
  fetchExploreChips,
  FORM_MAP_CHARS_CAP,
  FORM_MAP_PARAGRAPHS_CAP,
  READ_CHARS_CAP,
  readTools,
  TABLE_CELLS_CAP,
} from '../src/renderer/ai/tools/read'
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
    expect(out.fields[0]).toMatchObject({ section: 0, paragraph: 7 })
    // a field's name and guide are authored in the document too: data, fenced
    expect(unwrap(out.fields[0].name)).toBe('회사명')
    expect(out.fields[0].name).toMatch(/^⟦문서 내용:[0-9a-f]{16}⟧회사명⟦\/문서 내용:[0-9a-f]{16}⟧$/)
    expect(out.fields[0].guide).toMatch(/^⟦문서 내용:/)
    expect(unwrap(out.fields[0].guide)).toBe('여기에 입력')
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

describe('form_map', () => {
  const fields = env({
    fields: [
      {
        name: '발신기관명',
        guide: '',
        value: '서울대공원',
        location: { section: 0, paragraph: 1 },
      },
      { name: '수신', guide: '수신처', value: '', location: { section: 0, paragraph: 2 } },
    ],
    untrustedFields: ['fields[].name', 'fields[].value', 'fields[].guide'],
  })
  const tables = env({
    tables: [
      {
        index: 0,
        section: 0,
        paragraph: 4,
        control: 0,
        rows: 2,
        cols: 2,
        cells: [
          { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: '항목' },
          { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: '' },
          { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: '금액' },
          { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: ' ' },
        ],
      },
    ],
  })
  const paragraphs = env({
    paragraphs: [
      {
        section: 0,
        paragraph: 0,
        preview: '보고서 제목',
        length: 6,
        empty: false,
        hasTable: false,
      },
      { section: 0, paragraph: 1, preview: '', length: 0, empty: true, hasTable: true },
    ],
  })

  it('maps fields, table cells and body paragraphs in one call, fenced, with a summary', async () => {
    const api = fakeApi({ fields, export_tables: tables, paragraphs })
    const result = await readTools.execute(ctxWith(api), call('form_map'))
    expect(result.isError).toBeUndefined()
    const out = JSON.parse(result.output)
    expect(out.summary).toMatch(/2 form field\(s\) \(1 empty\)/)
    expect(out.summary).toMatch(/1 table\(s\) \(2 empty cell\(s\) among those listed\)/)
    expect(out.summary).toMatch(/2 body paragraph\(s\) \(1 empty\)/)
    expect(unwrap(out.fields[0].name)).toBe('발신기관명')
    expect(out.fields[1]).toMatchObject({ empty: true })
    expect(out.tables[0].cells[1]).toMatchObject({ row: 0, col: 1, empty: true })
    expect(unwrap(out.tables[0].cells[0].text)).toBe('항목')
    expect(out.paragraphs[0]).toMatchObject({ section: 0, paragraph: 0, length: 6 })
    expect(unwrap(out.paragraphs[0].preview)).toBe('보고서 제목')
    expect(out.tables[0].cells[0].text).toMatch(FENCE)
    expect(out.paragraphs[0].preview).toMatch(FENCE)
    expect(out).not.toHaveProperty('unavailable')
  })

  it('reports the parts it could not read and returns the rest', async () => {
    const api = fakeApi({ fields, export_tables: tables, paragraphs: { error: 'dump failed' } })
    const out = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
    expect(out.unavailable).toEqual(['paragraphs'])
    expect(out.fields).toHaveLength(2)
  })

  const manyParagraphs = (count: number) =>
    env({
      paragraphs: Array.from({ length: count }, (_, i) => ({
        section: 0,
        paragraph: i,
        preview: `문단 ${i} — 보고서 본문 문장이 여기에 들어갑니다`,
        length: 40,
        empty: false,
        hasTable: false,
      })),
    })
  const bigTables = (count: number, cellsEach: number) =>
    env({
      tables: Array.from({ length: count }, (_, index) => ({
        index,
        rows: cellsEach,
        cols: 1,
        cells: Array.from({ length: cellsEach }, (_, row) => ({
          row,
          col: 0,
          rowSpan: 1,
          colSpan: 1,
          text: `칸 ${index}-${row} 안내 문구`,
        })),
      })),
    })

  it('pages the paragraph list; a continuation returns only paragraphs', async () => {
    const api = fakeApi({
      fields,
      export_tables: tables,
      paragraphs: [manyParagraphs(450), manyParagraphs(450)],
    })
    const first = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
    expect(first.paragraphs.length).toBeGreaterThan(0)
    expect(first.paragraphs.length).toBeLessThanOrEqual(FORM_MAP_PARAGRAPHS_CAP)
    expect(first.nextParagraphsFrom).toBe(first.paragraphs.length)
    const from = first.nextParagraphsFrom as number
    const second = JSON.parse(
      (await readTools.execute(ctxWith(api), call('form_map', { paragraphsFrom: from }))).output,
    )
    expect(second.paragraphs[0].paragraph).toBe(from)
    expect(second).not.toHaveProperty('fields')
    expect(second).not.toHaveProperty('tables')
    expect(api.queries.filter((q) => q.tool === 'fields')).toHaveLength(1)
  })

  it('keeps the whole result within the character budget and says it was cut', async () => {
    const api = fakeApi({
      fields,
      export_tables: bigTables(40, 10),
      paragraphs: manyParagraphs(300),
    })
    const result = await readTools.execute(ctxWith(api), call('form_map'))
    expect(result.output.length).toBeLessThanOrEqual(FORM_MAP_CHARS_CAP)
    const out = JSON.parse(result.output)
    expect(out.truncated).toBe(true)
    expect(out.hint).toMatch(/paragraphsFrom|read_table/)
  })

  it('marks each cut table with its full cell count and says how to read the rest', async () => {
    const api = fakeApi({ fields, export_tables: bigTables(2, 300), paragraphs })
    const out = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
    const [a, b] = out.tables
    expect(a.cellCount).toBe(300)
    expect(b.cellCount).toBe(300)
    expect(a.cells.length + b.cells.length).toBeLessThanOrEqual(TABLE_CELLS_CAP)
    expect(b.truncated).toBe(true)
    expect(out.hint).toMatch(/read_table/)
  })

  it('treats a dump with no paragraphs as unavailable, not as an empty body', async () => {
    const api = fakeApi({ fields, export_tables: tables, paragraphs: env({ paragraphs: [] }) })
    const out = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
    expect(out.unavailable).toEqual(['paragraphs'])
  })

  it('gives field coordinates and type, and cell spans', async () => {
    const merged = env({
      tables: [
        {
          index: 0,
          rows: 1,
          cols: 2,
          cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2, text: '' }],
        },
      ],
    })
    const typed = env({
      fields: [
        {
          name: '수신',
          guide: '',
          value: '',
          fieldType: 'clickhere',
          location: { section: 0, paragraph: 2 },
        },
      ],
    })
    const api = fakeApi({ fields: typed, export_tables: merged, paragraphs })
    const out = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
    expect(out.fields[0]).toMatchObject({ section: 0, paragraph: 2, fieldType: 'clickhere' })
    expect(out.tables[0].cells[0]).toMatchObject({ rowSpan: 1, colSpan: 2 })
  })

  const sized = env({
    paragraphs: [
      {
        section: 0,
        paragraph: 0,
        preview: '',
        length: 0,
        empty: true,
        hasTable: false,
        fontSize: 12,
      },
      {
        section: 0,
        paragraph: 1,
        preview: '1. 본문',
        length: 5,
        empty: false,
        hasTable: false,
        fontSize: 13,
      },
      {
        section: 0,
        paragraph: 2,
        preview: '',
        length: 0,
        empty: true,
        hasTable: false,
        fontSize: 6,
      },
      {
        section: 0,
        paragraph: 3,
        preview: '2. 본문',
        length: 5,
        empty: false,
        hasTable: false,
        fontSize: 13,
      },
      {
        section: 0,
        paragraph: 4,
        preview: '',
        length: 0,
        empty: true,
        hasTable: false,
        fontSize: 7,
      },
      {
        section: 0,
        paragraph: 5,
        preview: '3. 본문',
        length: 5,
        empty: false,
        hasTable: false,
        fontSize: 13,
      },
      {
        section: 0,
        paragraph: 6,
        preview: '큰 제목',
        length: 4,
        empty: false,
        hasTable: false,
        fontSize: 28,
      },
    ],
  })

  it('reports each paragraph size, the body size, and flags thin blank spacer lines', async () => {
    const api = fakeApi({ fields, export_tables: tables, paragraphs: sized })
    const out = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
    expect(out.bodyFontSize).toBe(13)
    expect(out.paragraphs[1]).toMatchObject({ fontSize: 13 })
    expect(out.paragraphs[1]).not.toHaveProperty('spacer')
    expect(out.paragraphs[2]).toMatchObject({ fontSize: 6, empty: true, spacer: true })
    expect(out.paragraphs[4]).toMatchObject({ fontSize: 7, spacer: true })
    // an empty 12 pt line near the body size and a big title are not spacers
    expect(out.paragraphs[0]).not.toHaveProperty('spacer')
    expect(out.paragraphs[6]).not.toHaveProperty('spacer')
    expect(out.hint ?? '').toBe('')
    expect(out.summary).toMatch(/2 spacer line\(s\)/)
  })

  it('a continuation page also carries the body size and spacer flags', async () => {
    const api = fakeApi({ fields, export_tables: tables, paragraphs: [sized, sized] })
    await readTools.execute(ctxWith(api), call('form_map'))
    const out = JSON.parse(
      (await readTools.execute(ctxWith(api), call('form_map', { paragraphsFrom: 2 }))).output,
    )
    expect(out.bodyFontSize).toBe(13)
    expect(out.paragraphs[0]).toMatchObject({ paragraph: 2, spacer: true })
  })

  describe('roles', () => {
    const para = (paragraph: number, preview: string, over: Record<string, unknown> = {}) => ({
      section: 0,
      paragraph,
      preview,
      length: preview.length,
      empty: preview === '',
      hasTable: false,
      ...over,
    })
    const rolesDoc = env({
      paragraphs: [
        para(0, '1. 관련', { lead: 0, fontSize: 13, bold: false, indent: 660 }),
        para(1, '가. 근거', { lead: 2, fontSize: 13, bold: false, indent: 660 }),
        para(2, '나. 규정', { lead: 2, fontSize: 13, bold: false, indent: 700 }),
        para(3, '', { fontSize: 6 }),
        para(4, '붙임 1. 표', { lead: 0, fontSize: 13, bold: false, indent: 0 }),
      ],
    })

    it('lists at most 40 roles, the most used ones, in their original order', async () => {
      const many = env({
        paragraphs: Array.from({ length: 60 }, (_, i) =>
          para(i, `○ 항목 ${i}`, { lead: 0, fontSize: 10 + i / 10, bold: false, indent: 0 }),
        ),
      })
      const api = fakeApi({ fields, export_tables: tables, paragraphs: many })
      const out = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
      expect(out.roles.length).toBeLessThanOrEqual(40)
      const ids = out.roles.map((r: { id: number }) => r.id)
      expect(ids).toEqual([...ids].sort((x: number, y: number) => x - y))
    })

    it('lists the document roles and tags each text paragraph with its role', async () => {
      const api = fakeApi({ fields, export_tables: tables, paragraphs: rolesDoc })
      const out = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
      expect(out.roles).toHaveLength(3)
      expect(out.roles[1]).toMatchObject({
        id: 1,
        marker: '가.',
        lead: 2,
        size: 13,
        count: 2,
        example: { section: 0, paragraph: 1 },
        indentRange: [660, 700],
      })
      expect(out.paragraphs[2]).toMatchObject({ paragraph: 2, role: 1 })
      expect(out.paragraphs[3]).not.toHaveProperty('role')
    })

    it('keeps the role table when the paragraph list continues on a later page', async () => {
      const api = fakeApi({ fields, export_tables: tables, paragraphs: [rolesDoc, rolesDoc] })
      await readTools.execute(ctxWith(api), call('form_map'))
      const out = JSON.parse(
        (await readTools.execute(ctxWith(api), call('form_map', { paragraphsFrom: 2 }))).output,
      )
      expect(out.roles).toHaveLength(3)
      expect(out.paragraphs[0]).toMatchObject({ paragraph: 2, role: 1 })
    })
  })
})
