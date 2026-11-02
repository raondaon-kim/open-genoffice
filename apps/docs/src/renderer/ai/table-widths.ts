/**
 * Layout of a table the AI writes: column widths (percent of the table) and, for a table too
 * wide for the body size, a smaller text size. Estimated from the cell texts on a 6.5 in text
 * column (the grid generateTableModelXml writes) with Word's default cell margins.
 *
 * - An equal split stays when every column's longest line fits its equal share: short tables
 *   look as they always did.
 * - Otherwise the widths follow the browser's automatic table layout: every column first gets
 *   its min-content, the longest word (a word never splits, so a task name does not stack one
 *   syllable per line and "10월" does not break into "10 / 월"); room left over goes to columns
 *   whose longest line is wider, in proportion to how much more they want.
 * - When the min-contents do not fit at 11 pt (a blank Word document's body size), the table is
 *   written in 9 pt, as a wide schedule usually is in a report; the user chose this over a
 *   squeezed task column or broken month headers (2026-11-02).
 */

/** 6.5 in */
const TABLE_TWIPS = 9360
/** Word's default cell margins: 108 twips a side */
const CELL_PAD_TWIPS = 216
const BODY_HALF_POINTS = 22
const SMALL_HALF_POINTS = 18

/** Hangul, CJK and full-width forms; measured about 1.05 em in Malgun Gothic */
const WIDE = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿︰-﹏＀-｠￠-￦]/
/** bold glyphs are about a tenth wider (bold 11 pt "1월" measured 1.76 em) */
const BOLD_SCALE = 1.1

function textEm(text: string, bold: boolean): number {
  let em = 0
  for (const ch of text) em += ch === ' ' ? 0.3 : WIDE.test(ch) ? 1.05 : 0.55
  return bold ? em * BOLD_SCALE : em
}

export interface AiTableLayout {
  colWidthsPct: number[]
  /** text size for every cell, or null to keep the document's body size */
  sizeHalfPoints: number | null
}

interface ColumnNeeds {
  /** longest word, em */
  minEm: number[]
  /** longest line, em */
  maxEm: number[]
}

function columnNeeds(rows: string[][], cols: number, headerRow: boolean): ColumnNeeds {
  const minEm = Array.from({ length: cols }, () => 0)
  const maxEm = Array.from({ length: cols }, () => 0)
  rows.forEach((row, r) => {
    const bold = headerRow && r === 0
    row.forEach((cell, c) => {
      for (const raw of cell.split('\n')) {
        const line = raw.replace(/\s+/g, ' ').trim()
        maxEm[c] = Math.max(maxEm[c], textEm(line, bold))
        for (const word of line.split(' '))
          if (word) minEm[c] = Math.max(minEm[c], textEm(word, bold))
      }
    })
  })
  return { minEm, maxEm }
}

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** widths in twips at one text size, or null when even the longest words do not fit */
function widthsAt(needs: ColumnNeeds, halfPoints: number, force: boolean): number[] | null {
  const em = halfPoints * 10
  // a single long token (a URL) cannot claim more than half the table
  const min = needs.minEm.map((m) => Math.min(m * em, TABLE_TWIPS / 2) + CELL_PAD_TWIPS)
  const max = needs.maxEm.map((m, c) => Math.max(m * em + CELL_PAD_TWIPS, min[c]))
  const cols = min.length
  if (max.every((m) => m <= TABLE_TWIPS / cols))
    return Array.from({ length: cols }, () => TABLE_TWIPS / cols)
  const minSum = total(min)
  const maxSum = total(max)
  if (maxSum <= TABLE_TWIPS) return max.map((m) => (m / maxSum) * TABLE_TWIPS)
  if (minSum > TABLE_TWIPS) return force ? min.map((m) => (m / minSum) * TABLE_TWIPS) : null
  const room = TABLE_TWIPS - minSum
  const want = maxSum - minSum
  return min.map((m, c) => m + ((max[c] - m) / want) * room)
}

/** percent of the table, rounded up so no column falls a hair under its need; the widest pays */
function toPercent(twips: number[]): number[] {
  const pct = twips.map((w) => Math.ceil((w / TABLE_TWIPS) * 10000) / 100)
  const widest = pct.indexOf(Math.max(...pct))
  pct[widest] = Math.round((pct[widest] - (total(pct) - 100)) * 100) / 100
  return pct
}

export function aiTableLayout(rows: string[][], headerRow: boolean): AiTableLayout {
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const needs = columnNeeds(rows, cols, headerRow)
  const body = widthsAt(needs, BODY_HALF_POINTS, false)
  if (body) return { colWidthsPct: toPercent(body), sizeHalfPoints: null }
  return {
    colWidthsPct: toPercent(widthsAt(needs, SMALL_HALF_POINTS, true)!),
    sizeHalfPoints: SMALL_HALF_POINTS,
  }
}
