import type { Attachment, AttachmentPart } from './types'

/** about how long one part is */
export const PART_CHARS = 4000
/** how much of a part the plan sees in the map */
export const PREVIEW_CHARS = 300
/** below this many chars (all attachments together) the plan and the chapters get them whole */
export const WHOLE_ATTACHMENT_CHARS = 30000
/** parts the plan sees whole when the attachments are large */
export const MUST_SEE_CHARS = 20000
/** wording of the parts an outline has to follow (table of contents, rules, evaluation) */
export const MUST_SEE_WORDS: readonly string[] = [
  '목차',
  '작성 요령',
  '작성 지침',
  '작성 방법',
  '평가 항목',
  '평가 기준',
  '배점',
  '제출',
  '요구사항',
  '과업 내용',
]

interface Piece {
  label: string
  text: string
}

/** cut a text longer than PART_CHARS at line breaks where it can, hard where it cannot */
function splitLong(text: string): string[] {
  if (text.length <= PART_CHARS) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > PART_CHARS) {
    let cut = rest.lastIndexOf('\n', PART_CHARS)
    if (cut < PART_CHARS / 2) cut = PART_CHARS
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n/, '')
  }
  if (rest) out.push(rest)
  return out
}

const numbered = (label: string, texts: string[]): Piece[] =>
  texts.map((text, i) => ({ label: i === 0 ? label : `${label} (${i + 1})`, text }))

function byHeadings(text: string): Piece[] | null {
  const lines = text.split('\n')
  const starts: number[] = []
  lines.forEach((l, i) => {
    if (/^#{1,6}\s+\S/.test(l)) starts.push(i)
  })
  if (starts.length === 0) return null
  const pieces: Piece[] = []
  const before = lines.slice(0, starts[0]).join('\n').trim()
  if (before) pieces.push(...numbered('part 1', splitLong(before)))
  starts.forEach((start, k) => {
    const end = starts[k + 1] ?? lines.length
    const body = lines.slice(start, end).join('\n').trim()
    const label = lines[start]!.replace(/^#{1,6}\s+/, '').trim()
    pieces.push(...numbered(label, splitLong(body)))
  })
  return pieces
}

function byPages(text: string): Piece[] | null {
  const marker = /^\[page (\d+)\]/gm
  const found = [...text.matchAll(marker)]
  if (found.length === 0) return null
  const pages = found.map((m, k) => ({
    no: Number(m[1]),
    text: text.slice(m.index, found[k + 1]?.index ?? text.length).trim(),
  }))
  const pieces: Piece[] = []
  let group: typeof pages = []
  const flush = () => {
    if (group.length === 0) return
    const first = group[0]!.no
    const last = group.at(-1)!.no
    const label = first === last ? `p.${first}` : `p.${first}–${last}`
    pieces.push(...numbered(label, splitLong(group.map((p) => p.text).join('\n'))))
    group = []
  }
  for (const page of pages) {
    const size = group.reduce((n, p) => n + p.text.length + 1, 0)
    if (group.length > 0 && size + page.text.length > PART_CHARS) flush()
    group.push(page)
  }
  flush()
  return pieces
}

function byParagraphs(text: string): Piece[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const groups: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > PART_CHARS) {
      groups.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur) groups.push(cur)
  return groups.flatMap((g) => splitLong(g)).map((t, i) => ({ label: `part ${i + 1}`, text: t }))
}

/**
 * An attachment as parts the plan can assign to chapters: at its headings (Word, PowerPoint,
 * Excel text), else at `[page N]` markers grouped to about PART_CHARS (PDF, Hangul), else at
 * blank lines grouped the same way.
 */
export function mapAttachment(a: Attachment, index: number): AttachmentPart[] {
  const text = a.text.replace(/\r\n/g, '\n')
  const pieces = byHeadings(text) ?? byPages(text) ?? byParagraphs(text)
  return pieces.map((p, n) => ({
    id: `A${index + 1}-${n + 1}`,
    attachment: a.name,
    label: p.label,
    text: p.text,
  }))
}

const hits = (p: AttachmentPart): number =>
  MUST_SEE_WORDS.filter((w) => p.label.includes(w) || p.text.includes(w)).length

/**
 * What the plan must see whole when the attachments are too large to give whole: each
 * attachment's first part (cover, table of contents), then the parts with table-of-contents,
 * rules or evaluation wording, most matches first, within `cap` chars.
 */
export function mustSeeParts(parts: AttachmentPart[], cap = MUST_SEE_CHARS): AttachmentPart[] {
  const firsts = parts.filter((p, i) => i === 0 || parts[i - 1]!.attachment !== p.attachment)
  const keyed = parts
    .filter((p) => !firsts.includes(p) && hits(p) > 0)
    .map((p, i) => ({ p, i, h: hits(p) }))
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map((x) => x.p)
  const out: AttachmentPart[] = []
  let left = cap
  for (const p of [...firsts, ...keyed]) {
    if (left <= 0) break
    out.push(p.text.length <= left ? p : { ...p, text: p.text.slice(0, left) })
    left -= Math.min(p.text.length, left)
  }
  return out
}

/** the map the plan reads: one line per part */
export function describeParts(parts: AttachmentPart[]): string {
  return parts
    .map(
      (p) =>
        `${p.id} | ${p.label} | ${p.text.length}자 | ${p.text.slice(0, PREVIEW_CHARS).replace(/\s+/g, ' ').trim()}`,
    )
    .join('\n')
}
