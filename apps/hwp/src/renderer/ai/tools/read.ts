import type { AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import type { HwpAiContext, ToolModule } from '../context'
import { intArg, record, requireEditor, strArg, ToolError, toExecution } from '../errors'
import { newNonce, wrapText } from '../provenance'
import { runQuery } from '../query'

export const READ_PAGES_MAX = 10
export const READ_CHARS_CAP = 24_000
export const TABLE_CELLS_CAP = 400
export const FIND_DEFAULT_LIMIT = 20
export const FORM_MAP_PARAGRAPHS_CAP = 150
export const FORM_MAP_CHARS_CAP = READ_CHARS_CAP

type Rec = Record<string, unknown>
const arr = (value: unknown): Rec[] => (Array.isArray(value) ? (value as Rec[]) : [])
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' ? value : fallback)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const tools: AgentToolDef[] = [
  {
    name: 'get_document_overview',
    description:
      'Describe the open Hangul document: format, page/paragraph counts, every table (index, rows, cols, merged cells), form-field/footnote counts, the heading outline with paragraph coordinates, and what the engine suggests doing with it. Call this once first; table indices and outline paragraphs are edit coordinates.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_pages',
    description:
      'Read the text of a page range (1-based, at most 10 pages, 24,000 characters). Page text carries no coordinates — use find to locate a passage before editing it.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'integer', description: 'First page (1-based)' },
        end: { type: 'integer', description: 'Last page inclusive; defaults to start' },
      },
      required: ['start'],
    },
  },
  {
    name: 'find',
    description:
      'Search the document text. Each match gives the ONLY valid edit coordinates: section, paragraph, charOffset, length (code points), the whole paragraph text and its paragraphLength, and the 1-based page. Matches inside table cells are marked inTable with the table index — those are edited with edit_table.set_cell, not edit_text.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Exact text to look for (case-sensitive)' },
        limit: { type: 'integer', description: 'Maximum matches (default 20, max 100)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_table',
    description:
      'Read one table as a grid: rows, cols, and every cell with row/col, rowSpan/colSpan and text (at most 400 cells). Table indices come from get_document_overview. Use the row/col here for edit_table.',
    inputSchema: {
      type: 'object',
      properties: { index: { type: 'integer', description: 'Table index (0-based)' } },
      required: ['index'],
    },
  },
  {
    name: 'list_fields',
    description:
      'List the fillable form fields (누름틀): exact name, guide text, current value, type and paragraph. Call before fill_fields.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_document_state',
    description:
      'Current live state: format (hwp/hwpx), page count, unsaved-changes flag, change counter.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'form_map',
    description:
      'Map a form in ONE call: every form field (누름틀: name, guide, value, empty?), every table with each cell (row, col, text, empty?) and every body paragraph (section, paragraph, a short preview, full length, empty?, hasTable). Use it first when filling a form or a document with blanks, instead of calling find/read_table per cell. Paragraph previews are cut by the engine — use find or read_pages for the full text. The result stays within 24,000 characters: long documents return up to 150 paragraphs per call (continue with paragraphsFrom — later parts return only paragraphs), and large tables are cut at 400 cells in total (each table gives cellCount and truncated; read the rest with read_table).',
    inputSchema: {
      type: 'object',
      properties: {
        paragraphsFrom: {
          type: 'integer',
          description: 'Index in the paragraph list to continue from',
        },
      },
    },
  },
]

async function overview(ctx: HwpAiContext): Promise<ToolExecution> {
  const nonce = newNonce()
  const [explain, structure, explore] = await Promise.all([
    runQuery(ctx, 'explain'),
    runQuery(ctx, 'export_structure'),
    runQuery(ctx, 'explore'),
  ])
  const e = explain.envelope
  const roots = arr((structure.envelope.structure as Rec | undefined)?.roots)
  const tables = arr(e.tables)
  const out = {
    format: e.format,
    pageCount: e.pageCount,
    paragraphCount: e.paragraphCount,
    encrypted: e.encrypted === true,
    tables: tables.map((t) => ({
      index: t.index,
      rows: t.rows,
      cols: t.cols,
      hasMergedCells: t.hasMergedCells === true,
    })),
    fieldCount: arr(e.fields).length,
    footnoteCount: num(e.footnoteCount),
    endnoteCount: num(e.endnoteCount),
    outline: roots.slice(0, 40).map((r) => ({
      level: r.level,
      section: r.section,
      paragraph: r.paragraph,
      heading: wrapText(str(r.heading), nonce),
    })),
    suggestedActions: arr(explore.envelope.menu)
      .slice(0, 5)
      .map((m) => wrapText(str(m.why), nonce)),
    coordinates:
      'section/paragraph/table/row/col are 0-based engine coordinates; pages are 1-based. Use find for charOffset/length before editing text.',
  }
  return {
    output: JSON.stringify(out),
    summary: `${str(e.format) || 'document'}, ${num(e.pageCount)} page(s), ${tables.length} table(s)`,
  }
}

async function readPages(ctx: HwpAiContext, input: Rec): Promise<ToolExecution> {
  const state = await requireEditor(ctx).getDocumentState()
  const start = intArg(input, 'start', { min: 1 })
  if (start > state.pageCount) {
    throw new ToolError(
      `The document has ${state.pageCount} page(s); start must not exceed that.`,
      'page out of range',
    )
  }
  const end = Math.min(
    state.pageCount,
    start + READ_PAGES_MAX - 1,
    Math.max(start, intArg(input, 'end', { min: 1, fallback: start })),
  )
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i)
  const outcomes = await Promise.all(
    pages.map((page) => runQuery(ctx, 'export_text', { page: page - 1 })),
  )
  const nonce = newNonce()
  const parts: string[] = []
  let remaining = READ_CHARS_CAP
  let truncated = false
  for (let i = 0; i < pages.length; i++) {
    if (remaining <= 0) {
      truncated = true
      break
    }
    const text = str(arr(outcomes[i].envelope.pages)[0]?.text)
    const slice = text.length > remaining ? text.slice(0, remaining) : text
    if (slice.length < text.length) truncated = true
    remaining -= slice.length
    parts.push(`[Page ${pages[i]}]\n${wrapText(slice, nonce)}`)
  }
  return {
    output: parts.join('\n\n') + (truncated ? '\n[truncated — read fewer pages at a time]' : ''),
    summary: `pages ${start}-${end} read`,
  }
}

async function find(ctx: HwpAiContext, input: Rec): Promise<ToolExecution> {
  const query = strArg(input, 'query')
  const limit = intArg(input, 'limit', { min: 1, max: 100, fallback: FIND_DEFAULT_LIMIT })
  const { envelope } = await runQuery(ctx, 'search', { query, maxMatches: limit })
  const matches = arr(envelope.matches)
  let tableByAnchor: Map<string, number> | null = null
  if (matches.some((m) => m.cell)) {
    const tables = arr((await runQuery(ctx, 'export_tables')).envelope.tables)
    tableByAnchor = new Map(
      tables.map((t) => [`${num(t.section)}/${num(t.paragraph)}/${num(t.control)}`, num(t.index)]),
    )
  }
  const nonce = newNonce()
  const out = matches.map((m) => {
    const text = str(m.text)
    const base = {
      section: m.section,
      paragraph: m.paragraph,
      charOffset: m.charOffset,
      length: m.length,
      page: num(m.page) + 1,
      paragraphLength: [...text].length,
      text: wrapText(text, nonce),
    }
    if (!m.cell) return base
    const cell = m.cell as Rec
    const table = tableByAnchor?.get(`${num(m.section)}/${num(m.paragraph)}/${num(cell.control)}`)
    return {
      ...base,
      inTable: true,
      table: table ?? null,
      hint: 'This text is inside a table cell — read_table shows the grid; change it with edit_table.set_cell. edit_text cannot reach cell text.',
    }
  })
  return {
    output: JSON.stringify({
      query,
      totalMatchCount: envelope.totalMatchCount,
      truncated: envelope.truncated === true,
      matches: out,
    }),
    summary: `${matches.length} match(es)`,
  }
}

async function readTable(ctx: HwpAiContext, input: Rec): Promise<ToolExecution> {
  const index = intArg(input, 'index', { min: 0 })
  const tables = arr((await runQuery(ctx, 'export_tables')).envelope.tables)
  const table = tables.find((t) => t.index === index)
  if (!table) {
    throw new ToolError(
      `No table with index ${index} (the document has ${tables.length}). Indices come from get_document_overview.`,
      'table not found',
    )
  }
  const cells = arr(table.cells)
  const nonce = newNonce()
  const out = {
    index,
    rows: table.rows,
    cols: table.cols,
    section: table.section,
    paragraph: table.paragraph,
    cellCount: cells.length,
    truncated: cells.length > TABLE_CELLS_CAP,
    cells: cells.slice(0, TABLE_CELLS_CAP).map((c) => ({
      row: c.row,
      col: c.col,
      rowSpan: c.rowSpan,
      colSpan: c.colSpan,
      text: wrapText(str(c.text), nonce),
      ...(Array.isArray(c.nested) && c.nested.length > 0 ? { nestedTables: c.nested.length } : {}),
    })),
  }
  return { output: JSON.stringify(out), summary: `table ${index}: ${table.rows}×${table.cols}` }
}

async function listFields(ctx: HwpAiContext): Promise<ToolExecution> {
  const { envelope } = await runQuery(ctx, 'fields')
  const nonce = newNonce()
  const fields = arr(envelope.fields).map((f) => {
    const location = (f.location as Rec | undefined) ?? {}
    return {
      // name and guide are authored in the document as well: data, fenced
      // (fill_fields accepts a name copied back with its fence)
      name: wrapText(str(f.name), nonce),
      guide: wrapText(str(f.guide), nonce),
      value: wrapText(str(f.value), nonce),
      fieldType: f.fieldType,
      section: location.section,
      paragraph: location.paragraph,
    }
  })
  return {
    output: JSON.stringify({ fieldCount: fields.length, fields }),
    summary: `${fields.length} field(s)`,
  }
}

async function formMap(ctx: HwpAiContext, input: Rec): Promise<ToolExecution> {
  const from = intArg(input, 'paragraphsFrom', { min: 0, fallback: 0 })
  const continuing = from > 0
  const unavailable: string[] = []
  const part = async (name: 'fields' | 'export_tables' | 'paragraphs', label: string) => {
    try {
      return (await runQuery(ctx, name)).envelope
    } catch {
      unavailable.push(label)
      return null
    }
  }
  // one after another: each runQuery may send the snapshot first; a continuation
  // (paragraphsFrom > 0) only needs the paragraphs again
  const fieldsEnv = continuing ? null : await part('fields', 'fields')
  const tablesEnv = continuing ? null : await part('export_tables', 'tables')
  const paragraphsEnv = await part('paragraphs', 'paragraphs')
  const allParagraphs = arr(paragraphsEnv?.paragraphs)
  // every body has at least one paragraph: an empty list means dump was not understood
  if (paragraphsEnv && allParagraphs.length === 0) unavailable.push('paragraphs')

  const nonce = newNonce()
  const blank = (text: string) => text.trim().length === 0
  const fields = arr(fieldsEnv?.fields).map((f) => {
    const location = (f.location as Rec | undefined) ?? {}
    return {
      name: wrapText(str(f.name), nonce),
      guide: wrapText(str(f.guide), nonce),
      value: wrapText(str(f.value), nonce),
      empty: blank(str(f.value)),
      fieldType: f.fieldType,
      section: location.section,
      paragraph: location.paragraph,
    }
  })
  const cellOf = (c: Rec) => ({
    row: c.row,
    col: c.col,
    rowSpan: c.rowSpan,
    colSpan: c.colSpan,
    text: wrapText(str(c.text), nonce),
    empty: blank(str(c.text)),
  })
  let cellBudget = TABLE_CELLS_CAP
  const tables = arr(tablesEnv?.tables).map((t) => {
    const source = arr(t.cells)
    const kept = source.slice(0, Math.max(0, cellBudget))
    cellBudget -= kept.length
    return {
      index: t.index,
      rows: t.rows,
      cols: t.cols,
      cellCount: source.length,
      truncated: kept.length < source.length,
      cells: kept.map(cellOf),
    }
  })
  const page = allParagraphs.slice(from, from + FORM_MAP_PARAGRAPHS_CAP).map((p) => ({
    section: p.section,
    paragraph: p.paragraph,
    preview: wrapText(str(p.preview), nonce),
    length: p.length,
    empty: p.empty === true,
    hasTable: p.hasTable === true,
  }))

  const emptyCells = tables.reduce((n, t) => n + t.cells.filter((c) => c.empty).length, 0)
  const summary = continuing
    ? `${allParagraphs.length} body paragraph(s); this part starts at ${from}`
    : [
        `${fields.length} form field(s) (${fields.filter((f) => f.empty).length} empty)`,
        `${tables.length} table(s) (${emptyCells} empty cell(s) among those listed)`,
        `${allParagraphs.length} body paragraph(s) (${allParagraphs.filter((p) => p.empty === true).length} empty)`,
      ].join(', ')
  const render = () => {
    const next = from + page.length
    const cutTables = tables.filter((t) => t.truncated).map((t) => t.index)
    const hints = [
      next < allParagraphs.length
        ? `call form_map {paragraphsFrom: ${next}} for more paragraphs`
        : '',
      cutTables.length ? `read_table {index} for the rest of table(s) ${cutTables.join(', ')}` : '',
    ].filter(Boolean)
    return JSON.stringify({
      summary,
      ...(continuing ? {} : { fields, tables }),
      paragraphs: page,
      ...(next < allParagraphs.length ? { nextParagraphsFrom: next } : {}),
      ...(hints.length ? { truncated: true, hint: hints.join('; ') } : {}),
      ...(unavailable.length ? { unavailable } : {}),
    })
  }
  // stay within the character budget: drop paragraphs from the end first, then
  // cells from the last listed tables (both are announced in `hint`)
  let output = render()
  while (output.length > FORM_MAP_CHARS_CAP) {
    if (page.length > 0) {
      page.splice(-Math.max(1, Math.ceil(page.length / 8)))
    } else {
      const table = [...tables].reverse().find((t) => t.cells.length > 0)
      if (!table) break
      table.cells.splice(-Math.max(1, Math.ceil(table.cells.length / 4)))
      table.truncated = true
    }
    output = render()
  }
  return {
    output,
    summary: continuing
      ? `form map: paragraphs from ${from}`
      : `form map: ${fields.length} field(s), ${tables.length} table(s), ${allParagraphs.length} paragraph(s)`,
  }
}

async function documentState(ctx: HwpAiContext): Promise<ToolExecution> {
  const state = await requireEditor(ctx).getDocumentState()
  return {
    output: JSON.stringify({
      format: state.format,
      pageCount: state.pageCount,
      dirty: state.dirty,
      changeSeq: state.changeSeq,
    }),
    summary: `${state.format}, ${state.pageCount} page(s)`,
  }
}

/** empty-state chips: what the engine thinks this document is for (display only, never sent to the model) */
export async function fetchExploreChips(ctx: HwpAiContext): Promise<string[]> {
  try {
    const { envelope } = await runQuery(ctx, 'explore')
    return arr(envelope.menu)
      .map((m) => str(m.why))
      .filter(Boolean)
      .slice(0, 3)
  } catch {
    return []
  }
}

export const readTools: ToolModule = {
  tools,
  async execute(ctx, call) {
    const input = record(call.input ?? {}, 'input')
    switch (call.name) {
      case 'get_document_overview':
        return overview(ctx)
      case 'read_pages':
        return readPages(ctx, input)
      case 'find':
        return find(ctx, input)
      case 'read_table':
        return readTable(ctx, input)
      case 'list_fields':
        return listFields(ctx)
      case 'get_document_state':
        return documentState(ctx)
      case 'form_map':
        return formMap(ctx, input)
      default:
        throw new ToolError(`Unknown read tool: ${call.name}`, 'unknown tool')
    }
  },
}

const raw = readTools.execute
readTools.execute = (ctx, call) => raw(ctx, call).catch(toExecution)
