import { type Counts, maskText } from '../rules'
import { decodePart } from '../zip'

/** plain text (txt, md, csv, tsv, the hwpx text preview): the whole text, encoding and BOM kept */
export function maskPlainText(bytes: Uint8Array): { bytes: Uint8Array; counts: Counts } {
  const part = decodePart(bytes)
  const masked = maskText(part.text)
  return masked.text === part.text
    ? { bytes, counts: {} }
    : { bytes: part.encode(masked.text), counts: masked.counts }
}

const MARKUP_TAG = /<(?:!--[\s\S]*?--|(?:[^>"']|"[^"]*"|'[^']*')*)>/g
const MARKUP_ATTR = /(\s[^\s=/>]+\s*=\s*)("([^"]*)"|'([^']*)')/g

/**
 * HTML: text between tags and attribute values (href="mailto:…", "tel:…") are masked as written,
 * without decoding entities, so `&nbsp;` and friends stay exactly as they were. Tags and their
 * names are never touched.
 */
export function maskHtml(bytes: Uint8Array): { bytes: Uint8Array; counts: Counts } {
  const part = decodePart(bytes)
  const counts: Counts = {}
  const add = (c: Counts) => {
    for (const [rule, n] of Object.entries(c)) {
      counts[rule as keyof Counts] = (counts[rule as keyof Counts] ?? 0) + (n ?? 0)
    }
  }
  const maskRun = (s: string) => {
    const m = maskText(s)
    add(m.counts)
    return m.text
  }
  let out = ''
  let cursor = 0
  for (const m of part.text.matchAll(MARKUP_TAG)) {
    out += maskRun(part.text.slice(cursor, m.index))
    out += m[0].startsWith('<!--')
      ? maskRun(m[0])
      : m[0].replace(MARKUP_ATTR, (_all, lead: string, quoted: string) =>
          `${lead}${quoted[0]}${maskRun(quoted.slice(1, -1))}${quoted[0]}`,
        )
    cursor = (m.index ?? 0) + m[0].length
  }
  out += maskRun(part.text.slice(cursor))
  return out === part.text ? { bytes, counts: {} } : { bytes: part.encode(out), counts }
}
