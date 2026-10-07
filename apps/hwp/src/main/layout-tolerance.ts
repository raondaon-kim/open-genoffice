import type { RhwpEnvelope } from '../shared/ai-contract'

/**
 * `rhwp edit --verify` re-reads the saved file and compares it with the
 * in-memory document. Some Hancom-authored forms fail that round-trip check on
 * every edit, even a no-op one, because their stored line-layout values differ
 * from the engine's (spec §4.3). For those, compare the documents' explain
 * summaries instead: the edit must have changed only what its kind can change.
 */

export interface DocSummary {
  fields: string[]
  tables: Array<{ rows: number; cols: number }>
  paragraphCount: number
  pageCount: number
}

export type ToleranceVerdict = { ok: true } | { ok: false; reason: string }

const TABLE_SHAPE_OPS = new Set([
  'insert_row',
  'insert_col',
  'delete_row',
  'delete_col',
  'merge_cells',
  'split_cell',
  'insert_table',
  'delete_table',
])
const PARAGRAPH_COUNT_OPS = new Set([
  'insert_paragraph_after',
  'insert_paragraph_like',
  'delete_paragraph',
  'insert_table',
  'delete_table',
  'insert_page_break',
  'insert_column_break',
  'insert_footnote',
  'insert_endnote',
])

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

export function summaryOf(envelope: RhwpEnvelope | null): DocSummary | null {
  if (!envelope) return null
  const { fields, tables, paragraphCount, pageCount } = envelope
  if (!Array.isArray(fields) || !fields.every((f) => typeof f === 'string')) return null
  if (!Array.isArray(tables) || !isInt(paragraphCount) || !isInt(pageCount)) return null
  const shapes: Array<{ rows: number; cols: number }> = []
  for (const table of tables) {
    const t = table as { rows?: unknown; cols?: unknown }
    if (!isInt(t.rows) || !isInt(t.cols)) return null
    shapes.push({ rows: t.rows, cols: t.cols })
  }
  return { fields: fields as string[], tables: shapes, paragraphCount, pageCount }
}

export function judgeLayoutTolerance(
  ops: string[],
  before: DocSummary,
  after: DocSummary,
): ToleranceVerdict {
  if (before.fields.join('\u0000') !== after.fields.join('\u0000')) {
    return { ok: false, reason: 'the form field names changed' }
  }
  if (ops.some((op) => TABLE_SHAPE_OPS.has(op))) {
    const inserted = ops.filter((op) => op === 'insert_table').length
    const deleted = ops.filter((op) => op === 'delete_table').length
    if (after.tables.length !== before.tables.length + inserted - deleted) {
      return { ok: false, reason: 'the number of tables changed unexpectedly' }
    }
  } else {
    const shape = (s: DocSummary) => s.tables.map((t) => `${t.rows}x${t.cols}`).join(',')
    if (shape(before) !== shape(after)) {
      return { ok: false, reason: 'a table changed size although no table structure was edited' }
    }
  }
  if (
    !ops.some((op) => PARAGRAPH_COUNT_OPS.has(op)) &&
    before.paragraphCount !== after.paragraphCount
  ) {
    return {
      ok: false,
      reason: 'the paragraph count changed although no paragraph was added or removed',
    }
  }
  return { ok: true }
}
