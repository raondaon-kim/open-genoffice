import type { Attachment, AttachmentPart } from './types'

/** about how long one part is */
export const PART_CHARS = 4000
/** how much of a part the plan sees in the map, at most */
export const PREVIEW_CHARS = 300
/** below this many chars (all attachments together) the plan and the chapters get them whole */
export const WHOLE_ATTACHMENT_CHARS = 30000
/** parts the plan sees whole when the attachments are large */
export const MUST_SEE_CHARS = 20000
/** at most this many parts per run: a huge attachment gets larger parts instead */
export const MAX_PARTS = 200
/** the map the plan reads stays within this many chars */
export const MAP_CHARS = 20000
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

/** the part size for attachments of this total length, so there are at most MAX_PARTS parts */
export const partCharsFor = (totalChars: number): number =>
  Math.max(PART_CHARS, Math.ceil(totalChars / MAX_PARTS))

interface Piece {
  label: string
  text: string
}

/** cut a text longer than `size` at line breaks where it can, hard where it cannot */
function splitLong(text: string, size: number): string[] {
  if (text.length <= size) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size)
    if (cut < size / 2) cut = size
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n/, '')
  }
  if (rest) out.push(rest)
  return out
}

const numbered = (label: string, texts: string[]): Piece[] =>
  texts.map((text, i) => ({ label: i === 0 ? label : `${label} (${i + 1})`, text }))

function byHeadings(text: string, size: number): Piece[] | null {
  const lines = text.split('\n')
  const starts: number[] = []
  lines.forEach((l, i) => {
    if (/^#{1,6}\s+\S/.test(l)) starts.push(i)
  })
  if (starts.length === 0) return null
  const pieces: Piece[] = []
  const before = lines.slice(0, starts[0]).join('\n').trim()
  if (before) pieces.push(...numbered('part 1', splitLong(before, size)))
  starts.forEach((start, k) => {
    const end = starts[k + 1] ?? lines.length
    const body = lines.slice(start, end).join('\n').trim()
    const label = lines[start]!.replace(/^#{1,6}\s+/, '').trim()
    pieces.push(...numbered(label, splitLong(body, size)))
  })
  return pieces
}

function byPages(text: string, size: number): Piece[] | null {
  const found = [...text.matchAll(/^\[page (\d+)\]/gm)]
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
    pieces.push(...numbered(label, splitLong(group.map((p) => p.text).join('\n'), size)))
    group = []
  }
  for (const page of pages) {
    const total = group.reduce((n, p) => n + p.text.length + 1, 0)
    if (group.length > 0 && total + page.text.length > size) flush()
    group.push(page)
  }
  flush()
  return pieces
}

function byParagraphs(text: string, size: number): Piece[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const groups: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > size) {
      groups.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur) groups.push(cur)
  return groups
    .flatMap((g) => splitLong(g, size))
    .map((t, i) => ({ label: `part ${i + 1}`, text: t }))
}

/** too many pieces: merge neighbours, growing the size until at most MAX_PARTS remain */
function mergeSmall(pieces: Piece[], size: number): Piece[] {
  let out = pieces
  for (let s = size; out.length > MAX_PARTS; s = Math.ceil(s * 1.25)) out = mergeUpTo(pieces, s)
  return out
}

function mergeUpTo(pieces: Piece[], size: number): Piece[] {
  const out: Piece[] = []
  let cur: { first: string; last: string; text: string } | null = null
  for (const p of pieces) {
    if (cur && cur.text.length + p.text.length + 1 > size) {
      out.push({
        label: cur.first === cur.last ? cur.first : `${cur.first} … ${cur.last}`,
        text: cur.text,
      })
      cur = null
    }
    cur = cur
      ? { first: cur.first, last: p.label, text: `${cur.text}\n${p.text}` }
      : { first: p.label, last: p.label, text: p.text }
  }
  if (cur)
    out.push({
      label: cur.first === cur.last ? cur.first : `${cur.first} … ${cur.last}`,
      text: cur.text,
    })
  return out
}

/**
 * An attachment as parts the plan can assign to chapters: at its headings (Word, PowerPoint,
 * Excel text), else at `[page N]` markers grouped to about `partChars` (Hangul), else at
 * blank lines grouped the same way (PDF, plain text).
 */
export function mapAttachment(
  a: Attachment,
  index: number,
  partChars = PART_CHARS,
): AttachmentPart[] {
  const text = a.text.replace(/\r\n/g, '\n')
  const raw =
    byHeadings(text, partChars) ?? byPages(text, partChars) ?? byParagraphs(text, partChars)
  return mergeSmall(raw, partChars).map((p, n) => ({
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

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()
const LABEL_CHARS = 60

/** the map the plan reads: one line per part; previews shrink so the map stays within `cap` */
export function describeParts(parts: AttachmentPart[], cap = MAP_CHARS): string {
  if (parts.length === 0) return ''
  const preview = Math.max(0, Math.min(PREVIEW_CHARS, Math.floor(cap / parts.length) - 100))
  const lines = parts.map((p) => {
    const head = `${p.id} | ${oneLine(p.label).slice(0, LABEL_CHARS)} | ${p.text.length}자`
    return preview > 0
      ? `${head} | ${oneLine(p.text.slice(0, preview * 2)).slice(0, preview)}`
      : head
  })
  let out = lines.join('\n')
  if (out.length > cap) out = out.slice(0, out.lastIndexOf('\n', cap))
  return out
}
