import { maskPieces } from './pieces'
import type { Counts } from './rules'

/**
 * Masking text inside XML parts without touching anything else.
 *
 * A family names the paragraph element and the elements that hold text. The XML is tokenised
 * once into tags and character data; a piece is a run of character data directly inside a text
 * element, and it belongs to the innermost open paragraph (a table cell paragraph nested inside
 * an outer paragraph keeps its own text). Each paragraph's pieces are masked together, so a
 * number split across runs is found; only changed pieces are rewritten.
 */
export interface XmlFamily {
  paragraph: string
  text: readonly string[]
  /** add xml:space="preserve" to a text element whose content changed */
  preserveSpace?: boolean
  /** elements that separate text inside a paragraph (tab, line break): numbers never join across them */
  breaks?: readonly string[]
}

export const XML_FAMILIES = {
  docx: {
    paragraph: 'w:p',
    text: ['w:t', 'w:delText', 'w:instrText'],
    preserveSpace: true,
    breaks: ['w:tab', 'w:br', 'w:cr', 'w:ptab'],
  },
  hwpx: { paragraph: 'hp:p', text: ['hp:t'], breaks: ['hp:tab', 'hp:lineBreak'] },
  drawing: { paragraph: 'a:p', text: ['a:t'], breaks: ['a:br'] },
  sheet: { paragraph: 'si', text: ['t'], preserveSpace: true },
} as const satisfies Record<string, XmlFamily>

interface Token {
  raw: string
  tag: boolean
}

const TAG = /<(?:!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|\?[\s\S]*?\?|(?:[^>"']|"[^"]*"|'[^']*')*)>/g

function tokenize(xml: string): Token[] {
  const out: Token[] = []
  let cursor = 0
  TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG.exec(xml)) !== null) {
    if (m.index > cursor) out.push({ raw: xml.slice(cursor, m.index), tag: false })
    out.push({ raw: m[0], tag: true })
    cursor = m.index + m[0].length
  }
  if (cursor < xml.length) out.push({ raw: xml.slice(cursor), tag: false })
  return out
}

type TagKind = { kind: 'open' | 'close' | 'self'; name: string } | null

function tagKind(raw: string): TagKind {
  if (raw.startsWith('<?') || raw.startsWith('<!')) return null
  const close = /^<\/\s*([^\s>]+)\s*>$/.exec(raw)
  if (close) return { kind: 'close', name: close[1] }
  const open = /^<([^\s/>]+)/.exec(raw)
  if (!open) return null
  return { kind: raw.endsWith('/>') ? 'self' : 'open', name: open[1] }
}

export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (all, ent: string) => {
    if (ent === 'amp') return '&'
    if (ent === 'lt') return '<'
    if (ent === 'gt') return '>'
    if (ent === 'quot') return '"'
    if (ent === 'apos') return "'"
    const code = ent.startsWith('#x') ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : all
  })
}

export function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface Piece {
  /** -1 for a separator that stands for a tab or break element and is never written back */
  token: number
  /** index of the opening tag of the text element holding this piece */
  openTag: number
  text: string
}

/** paragraphs (in the order they open), each with its pieces in document order */
function collect(tokens: Token[], family: XmlFamily): Piece[][] {
  const paragraphs: Piece[][] = []
  const paraStack: number[] = []
  const textStack: number[] = [] // token index of each open text element
  const textNames = new Set(family.text)
  const breakNames = new Set(family.breaks ?? [])
  let synthetic: number | null = null // a text element outside any paragraph is its own group

  tokens.forEach((tok, i) => {
    if (tok.tag) {
      const k = tagKind(tok.raw)
      if (!k) return
      if (breakNames.has(k.name) && k.kind !== 'close') {
        const group = paraStack.length > 0 ? paraStack[paraStack.length - 1] : synthetic
        if (group !== null) paragraphs[group].push({ token: -1, openTag: -1, text: '	' })
        return
      }
      if (k.name === family.paragraph) {
        if (k.kind === 'open') {
          paraStack.push(paragraphs.length)
          paragraphs.push([])
        } else if (k.kind === 'close') {
          paraStack.pop()
        }
      } else if (textNames.has(k.name)) {
        if (k.kind === 'open') {
          textStack.push(i)
          if (paraStack.length === 0) {
            synthetic = paragraphs.length
            paragraphs.push([])
          }
        } else if (k.kind === 'close') {
          textStack.pop()
          if (textStack.length === 0) synthetic = null
        }
      }
      return
    }
    if (textStack.length === 0) return
    const group = paraStack.length > 0 ? paraStack[paraStack.length - 1] : synthetic
    if (group === null) return
    paragraphs[group].push({
      token: i,
      openTag: textStack[textStack.length - 1],
      text: decodeXmlText(tok.raw),
    })
  })
  return paragraphs
}

export function xmlParagraphTexts(xml: string, family: XmlFamily): string[] {
  return collect(tokenize(xml), family).map((pieces) => pieces.map((p) => p.text).join(''))
}

export function maskXmlParagraphs(
  xml: string,
  family: XmlFamily,
): { xml: string; counts: Counts } {
  const tokens = tokenize(xml)
  const counts: Counts = {}
  let changed = false
  const preserve = new Set<number>()
  for (const pieces of collect(tokens, family)) {
    if (pieces.length === 0) continue
    const masked = maskPieces(pieces.map((p) => p.text))
    for (const [rule, n] of Object.entries(masked.counts)) {
      counts[rule as keyof Counts] = (counts[rule as keyof Counts] ?? 0) + (n ?? 0)
    }
    pieces.forEach((p, i) => {
      if (p.token < 0 || masked.pieces[i] === p.text) return
      tokens[p.token] = { raw: escapeXmlText(masked.pieces[i]), tag: false }
      preserve.add(p.openTag)
      changed = true
    })
  }
  if (!changed) return { xml, counts }
  if (family.preserveSpace) {
    for (const i of preserve) {
      const raw = tokens[i].raw
      if (!/\sxml:space\s*=/.test(raw)) {
        tokens[i] = { raw: raw.replace(/^(<[^\s/>]+)/, '$1 xml:space="preserve"'), tag: true }
      }
    }
  }
  return { xml: tokens.map((t) => t.raw).join(''), counts }
}
