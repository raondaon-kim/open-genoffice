import type { DocxOutline } from './docx-outline'
import { normalizeHeading } from './signature'

/** a line without leading bullets/numbering and without whitespace, for comparison */
function normalize(line: string): string {
  return line
    .normalize('NFC')
    .replace(/^[\s\-–—•*·]*(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\d]+(?:[-.]\d+)*[.)]?|[가-하][.)])?\s*/u, '')
    .replace(/\s+/gu, '')
}

/**
 * The first candidate line that contains a run of `minLen` or more characters (whitespace and
 * leading numbering ignored) found in any source text, or null. Callers pass only the source's
 * content (body paragraphs, cover values, table body cells), never its headings or labels.
 * Runs that also occur in `allowed` (the form's own text: headings, table header rows) are
 * form, so they do not count even when a body sentence repeats them.
 */
export function sourceWordsHit(
  sourceTexts: string[],
  candidateTexts: string[],
  minLen = 8,
  allowed: string[] = [],
): string | null {
  const gramsOf = (text: string): string[] => {
    const chars = Array.from(normalize(text))
    const out: string[] = []
    for (let i = 0; i + minLen <= chars.length; i++) out.push(chars.slice(i, i + minLen).join(''))
    return out
  }
  const grams = new Set(sourceTexts.flatMap(gramsOf))
  for (const text of allowed) for (const g of gramsOf(text)) grams.delete(g)
  if (grams.size === 0) return null
  for (const line of candidateTexts) {
    const chars = Array.from(normalize(line))
    for (let i = 0; i + minLen <= chars.length; i++) {
      if (grams.has(chars.slice(i, i + minLen).join(''))) return line
    }
  }
  return null
}

/**
 * The source's content for the gate: body paragraphs, cover values and table body cells, minus
 * table-of-contents lines (a body line that repeats a heading is form, not content).
 */
export function sourceContentTexts(outline: DocxOutline): string[] {
  const headings = new Set(outline.headings.map((h) => normalizeHeading(h.text)))
  return [
    ...outline.body.filter((line) => !headings.has(normalizeHeading(line))),
    ...outline.cover,
    ...outline.tableCells,
  ]
}
