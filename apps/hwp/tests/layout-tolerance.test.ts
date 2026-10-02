import { describe, expect, it } from 'vitest'
import { judgeLayoutTolerance, summaryOf } from '../src/main/layout-tolerance'
import type { DocSummary } from '../src/main/layout-tolerance'

function base(): DocSummary {
  return {
    fields: ['발신기관명', '수신', '결재제목'],
    tables: [
      { rows: 6, cols: 3 },
      { rows: 1, cols: 1 },
    ],
    paragraphCount: 9,
    pageCount: 1,
  }
}
const doc = (over: Partial<DocSummary> = {}): DocSummary => ({ ...base(), ...over })

describe('summaryOf', () => {
  it('reads field names, table sizes and counts from an explain envelope', () => {
    expect(
      summaryOf({
        schemaVersion: '1.0',
        fields: ['a', 'b'],
        tables: [{ index: 0, rows: 2, cols: 3, hasMergedCells: false }],
        paragraphCount: 4,
        pageCount: 2,
      }),
    ).toEqual({
      fields: ['a', 'b'],
      tables: [{ rows: 2, cols: 3 }],
      paragraphCount: 4,
      pageCount: 2,
    })
  })

  it('returns null when a field it relies on is missing', () => {
    expect(summaryOf(null)).toBeNull()
    expect(summaryOf({ schemaVersion: '1.0', fields: [], tables: [] })).toBeNull()
    expect(
      summaryOf({
        schemaVersion: '1.0',
        fields: [],
        tables: [{ rows: 'x', cols: 1 }],
        paragraphCount: 1,
        pageCount: 1,
      }),
    ).toBeNull()
  })
})

describe('judgeLayoutTolerance', () => {
  it('accepts an in-place edit that leaves the summary unchanged (page count may move)', () => {
    expect(
      judgeLayoutTolerance(
        ['replace_phrase', 'set_cell', 'fill_fields'],
        doc(),
        doc({ pageCount: 2 }),
      ),
    ).toEqual({ ok: true })
  })

  it('refuses when field names change', () => {
    const r = judgeLayoutTolerance(['fill_fields'], doc(), doc({ fields: ['발신기관명', '수신'] }))
    expect(r).toMatchObject({ ok: false })
    expect((r as { reason: string }).reason).toMatch(/field/i)
  })

  it('refuses a table size change unless the batch changes table structure', () => {
    const grown = doc({
      tables: [
        { rows: 7, cols: 3 },
        { rows: 1, cols: 1 },
      ],
    })
    expect(judgeLayoutTolerance(['set_cell'], doc(), grown)).toMatchObject({ ok: false })
    expect(judgeLayoutTolerance(['insert_row'], doc(), grown)).toEqual({ ok: true })
  })

  it('checks the table count against inserted and deleted tables', () => {
    const fewer = doc({ tables: [{ rows: 6, cols: 3 }], paragraphCount: 8 })
    expect(judgeLayoutTolerance(['delete_table'], doc(), fewer)).toEqual({ ok: true })
    expect(judgeLayoutTolerance(['insert_row'], doc(), fewer)).toMatchObject({ ok: false })
  })

  it('refuses a paragraph count change unless the batch adds or removes paragraphs', () => {
    const shorter = doc({ paragraphCount: 8 })
    expect(judgeLayoutTolerance(['set_paragraph_text'], doc(), shorter)).toMatchObject({
      ok: false,
    })
    expect(judgeLayoutTolerance(['delete_paragraph'], doc(), shorter)).toEqual({ ok: true })
  })
})
