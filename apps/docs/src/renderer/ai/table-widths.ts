/**
 * Column widths (percent of the table) for a table the AI writes, from its cell texts.
 *
 * An equal split stays when every column's longest line fits its equal share: short tables look
 * as they always did. Otherwise the widths follow the browser's automatic table layout, in em of
 * a 10 pt face on a 6.5 in text column (the grid generateTableModelXml writes):
 * - every column first gets its min-content, the longest word (a word never splits, so a task name
 *   does not stack one syllable per line);
 * - room left over goes to columns whose longest line is wider than that, in proportion to how
 *   much more they want;
 * - when even the min-contents overflow, the columns share the width in proportion to them.
 */

/** 9360 twips (6.5 in) at 10 pt = 200 twips per em */
const TABLE_EM = 46.8
/** Word's default cell margins (108 twips a side) */
const CELL_PAD_EM = 1.1
/** a single long token (a URL) cannot claim more than this share of the table */
const MAX_WORD_EM = TABLE_EM / 2

/** Hangul, CJK and full-width forms take a full em; everything else about half */
const WIDE =
  /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/

function textEm(text: string): number {
  let em = 0
  for (const ch of text) em += ch === ' ' ? 0.3 : WIDE.test(ch) ? 1 : 0.55
  return em
}

function lineEm(text: string): number {
  return textEm(text.replace(/\s+/g, ' ').trim())
}

function longestWordEm(text: string): number {
  let max = 0
  for (const word of text.split(/\s+/)) if (word) max = Math.max(max, textEm(word))
  return Math.min(max, MAX_WORD_EM)
}

export function contentColumnPcts(rows: string[][]): number[] {
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const equal = Array.from({ length: cols }, () => 100 / cols)
  const min = Array.from({ length: cols }, () => CELL_PAD_EM)
  const max = Array.from({ length: cols }, () => CELL_PAD_EM)
  for (const row of rows) {
    row.forEach((cell, c) => {
      for (const line of cell.split('\n')) {
        max[c] = Math.max(max[c], lineEm(line) + CELL_PAD_EM)
        min[c] = Math.max(min[c], longestWordEm(line) + CELL_PAD_EM)
      }
    })
  }
  const share = TABLE_EM / cols
  if (max.every((m) => m <= share)) return equal

  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const minSum = total(min)
  const maxSum = total(max)
  let em: number[]
  if (maxSum <= TABLE_EM) {
    em = max.map((m) => (m / maxSum) * TABLE_EM)
  } else if (minSum >= TABLE_EM) {
    em = min.map((m) => (m / minSum) * TABLE_EM)
  } else {
    const room = TABLE_EM - minSum
    const want = maxSum - minSum
    em = min.map((m, c) => m + ((max[c] - m) / want) * room)
  }
  const pct = em.map((w) => Math.round((w / TABLE_EM) * 10000) / 100)
  pct[cols - 1] = Math.round((100 - total(pct.slice(0, -1))) * 100) / 100
  return pct
}
