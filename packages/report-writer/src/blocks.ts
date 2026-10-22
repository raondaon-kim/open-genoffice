import type { ReportBlock } from './types'

const CLAIMS_TAG = '<<주장>>'
const GAPS_TAG = '<<부족>>'

const clean = (s: string): string =>
  s
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const isTableLine = (s: string): boolean => /^\s*\|.*\|\s*$/.test(s)
const isSeparator = (s: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(s) && s.includes('-')
const cells = (s: string): string[] =>
  s
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => clean(c))

/**
 * The model writes a chapter as Markdown: `##` chapter, `###` section, `####`+ sub-heading,
 * `-`/`*` bullets, `1.` numbered items, pipe tables, and paragraphs (soft-wrapped lines join).
 */
export function parseBlocks(markdown: string): ReportBlock[] {
  const out: ReportBlock[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let para: string[] = []
  const flush = () => {
    const text = clean(para.join(' '))
    if (text) out.push({ type: 'paragraph', text })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim()) {
      flush()
      continue
    }
    if (isTableLine(line)) {
      flush()
      const rows: string[][] = []
      while (i < lines.length && isTableLine(lines[i]!)) {
        if (!isSeparator(lines[i]!)) rows.push(cells(lines[i]!))
        i++
      }
      i--
      if (rows.length > 0) out.push({ type: 'table', rows })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1]!.length
      const type = level <= 2 ? 'chapter' : level === 3 ? 'section' : 'subsection'
      const text = clean(heading[2]!)
      if (text) out.push({ type, text })
      continue
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      const text = clean(bullet[1]!)
      if (text) out.push({ type: 'bullet', text })
      continue
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      flush()
      const text = clean(numbered[1]!)
      if (text) out.push({ type: 'numbered', text })
      continue
    }
    para.push(line)
  }
  flush()
  return out
}

const listItems = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => /^\s*[-*•]\s+(.*)$/.exec(l)?.[1]?.trim() ?? '')
    .filter((l) => l && !/^없음\.?$/.test(l))

/** a chapter answer: the body, then `<<주장>>` claims and `<<부족>>` gaps (either may be missing) */
export function parseChapterAnswer(text: string): {
  blocks: ReportBlock[]
  claims: string[]
  gaps: string[]
} {
  const claimsAt = text.indexOf(CLAIMS_TAG)
  const gapsAt = text.indexOf(GAPS_TAG)
  const ends = [claimsAt, gapsAt].filter((i) => i >= 0)
  const bodyEnd = ends.length ? Math.min(...ends) : text.length
  const section = (at: number, tag: string): string => {
    if (at < 0) return ''
    const start = at + tag.length
    const next = [claimsAt, gapsAt].filter((i) => i > at)
    return text.slice(start, next.length ? Math.min(...next) : text.length)
  }
  return {
    blocks: parseBlocks(text.slice(0, bodyEnd)),
    claims: listItems(section(claimsAt, CLAIMS_TAG)),
    gaps: listItems(section(gapsAt, GAPS_TAG)),
  }
}
