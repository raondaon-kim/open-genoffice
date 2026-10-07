/**
 * Forms keep thin blank "spacer" paragraphs (6-7 pt) between 13 pt body paragraphs.
 * Text written into one of them — or a paragraph inserted after it — inherits the
 * tiny size. These helpers find the body text size and spot just-written text that
 * came out far smaller.
 */

/** a blank paragraph below this share of the body text size is a spacer line */
export const SPACER_RATIO = 0.75

type Rec = Record<string, unknown>

/** the most common font size (points) among paragraphs that hold text; a tie goes to the larger */
export function bodyFontSizeOf(paragraphs: Rec[]): number | undefined {
  const count = new Map<number, number>()
  for (const p of paragraphs) {
    if (p.empty !== true && typeof p.fontSize === 'number') {
      count.set(p.fontSize, (count.get(p.fontSize) ?? 0) + 1)
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0]
}

export function isSpacerLine(p: Rec, bodyFontSize: number | undefined): boolean {
  return (
    bodyFontSize !== undefined &&
    p.empty === true &&
    typeof p.fontSize === 'number' &&
    p.fontSize < bodyFontSize * SPACER_RATIO
  )
}

export interface TinyWritten {
  section: number
  paragraph: number
  length: number
  fontSize: number
  bodyFontSize: number
}

const KEY_CHARS = 40

/** dump previews are cut at ~50 characters with "..."; compare the leading characters only */
const keyOf = (text: string): string => text.trim().slice(0, KEY_CHARS)

/**
 * Paragraphs whose text matches something this edit wrote and whose size is far below
 * the body text size. Small text the edit did not write (footers, notes) is not reported.
 */
export function findTinyWritten(paragraphs: Rec[], written: string[]): TinyWritten[] {
  const keys = written.map(keyOf).filter((k) => k.length > 0)
  if (keys.length === 0) return []
  const body = bodyFontSizeOf(paragraphs)
  if (body === undefined) return []
  const out: TinyWritten[] = []
  for (const p of paragraphs) {
    if (p.empty === true || typeof p.fontSize !== 'number') continue
    if (p.fontSize >= body * SPACER_RATIO) continue
    const preview = typeof p.preview === 'string' ? p.preview : ''
    const head = preview.replace(/\.\.\.$/, '').slice(0, KEY_CHARS)
    if (head.length === 0 || !keys.some((k) => k.startsWith(head) || head.startsWith(k))) continue
    out.push({
      section: Number(p.section),
      paragraph: Number(p.paragraph),
      length: Number(p.length),
      fontSize: p.fontSize,
      bodyFontSize: body,
    })
  }
  return out
}
