import type { DocxOutline } from './docx-outline'
import { normalizeHeading } from './signature'

/**
 * A line without leading bullets/numbering, whitespace and punctuation, for comparison: a run is
 * counted in letters and digits, so a shared list like "·인원·주요사업" is not a copied phrase.
 */
function normalize(line: string): string {
  return line
    .normalize('NFC')
    .replace(/^[\s\-–—•*·]*(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\d]+(?:[-.]\d+)*[.)]?|[가-하][.)])?\s*/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * Every candidate line that contains a run of `minLen` or more letters and digits found in any
 * source text. Callers pass only the source's content (body paragraphs, cover values, table body
 * cells), never its headings or labels. Runs that also occur in `allowed` (the form's own text:
 * headings, table header rows) are form, so they do not count even when a body sentence repeats
 * them.
 */
export function sourceWordsHits(
  sourceTexts: string[],
  candidateTexts: string[],
  minLen = 8,
  allowed: string[] = [],
): string[] {
  const gramsOf = (text: string): string[] => {
    const chars = Array.from(normalize(text))
    const out: string[] = []
    for (let i = 0; i + minLen <= chars.length; i++) out.push(chars.slice(i, i + minLen).join(''))
    return out
  }
  const grams = new Set(sourceTexts.flatMap(gramsOf))
  for (const text of allowed) for (const g of gramsOf(text)) grams.delete(g)
  if (grams.size === 0) return []
  return candidateTexts.filter((line) => gramsOf(line).some((g) => grams.has(g)))
}

/** the first offending line, or null */
export function sourceWordsHit(
  sourceTexts: string[],
  candidateTexts: string[],
  minLen = 8,
  allowed: string[] = [],
): string | null {
  return sourceWordsHits(sourceTexts, candidateTexts, minLen, allowed)[0] ?? null
}

/**
 * The source's content for the gate: body paragraphs, cover values and table body cells, minus
 * table-of-contents lines (a line that repeats a heading is form, not content).
 */
export function sourceContentTexts(outline: DocxOutline): string[] {
  const headings = new Set(outline.headings.map((h) => normalizeHeading(h.text)))
  return [
    ...outline.body.filter((line) => !headings.has(normalizeHeading(line))),
    // a table of contents can sit before the first heading, among the cover paragraphs
    ...outline.cover.filter((line) => !headings.has(normalizeHeading(line))),
    ...outline.tableCells,
  ]
}
