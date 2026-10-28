import JSZip from 'jszip'

/** one top-level child of w:body: a paragraph or a table (sectPr and anything else is `raw`) */
export type BodyElement =
  | { kind: 'p'; xml: string; index: number }
  | { kind: 'tbl'; xml: string; index: number }
  | { kind: 'raw'; xml: string }

export interface DocxParts {
  zip: JSZip
  document: string
  /** offsets of the body's inner XML inside `document` */
  bodyStart: number
  bodyEnd: number
  elements: BodyElement[]
}

const unescape = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

export const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** the visible text of an XML fragment: every w:t joined (w:delText is deleted text, not shown) */
export function textOf(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>/g)) out += m[1] ?? ''
  return unescape(out)
}

/**
 * Splits the body into its top-level paragraphs and tables. Tables are matched with nesting
 * (a table inside a cell stays inside its parent element).
 */
/**
 * The end (exclusive) of the element named `tag` that opens at `start`, counting nested elements
 * of the same name (self-closing ones do not nest); -1 when it never closes.
 */
export function matchingClose(xml: string, start: number, tag: string): number {
  const re = new RegExp(`<${tag}(?=[\\s>/])[^>]*?(/?)>|</${tag}>`, 'g')
  re.lastIndex = start
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('</')) depth--
    else if (m[1] !== '/') depth++
    else if (depth === 0) return m.index + m[0].length
    if (depth === 0) return m.index + m[0].length
  }
  return -1
}

export function splitBody(body: string): BodyElement[] {
  const out: BodyElement[] = []
  let i = 0
  let raw = ''
  let index = 0
  const flushRaw = () => {
    if (raw) out.push({ kind: 'raw', xml: raw })
    raw = ''
  }
  while (i < body.length) {
    if (body.startsWith('<w:tbl>', i) || body.startsWith('<w:tbl ', i)) {
      let depth = 0
      let j = i
      const re = /<w:tbl[ >]|<\/w:tbl>/g
      re.lastIndex = i
      let m: RegExpExecArray | null
      while ((m = re.exec(body))) {
        depth += m[0] === '</w:tbl>' ? -1 : 1
        if (depth === 0) {
          j = m.index + m[0].length
          break
        }
      }
      if (j === i) throw new Error('unterminated table')
      flushRaw()
      out.push({ kind: 'tbl', xml: body.slice(i, j), index: index++ })
      i = j
      continue
    }
    if (
      body.startsWith('<w:p>', i) ||
      body.startsWith('<w:p ', i) ||
      body.startsWith('<w:p/>', i)
    ) {
      let j: number
      if (body.startsWith('<w:p/>', i)) j = i + 6
      else {
        // text boxes (w:txbxContent) nest whole paragraphs inside a paragraph
        j = matchingClose(body, i, 'w:p')
        if (j < 0) throw new Error('unterminated paragraph')
      }
      flushRaw()
      out.push({ kind: 'p', xml: body.slice(i, j), index: index++ })
      i = j
      continue
    }
    raw += body[i]
    i++
  }
  flushRaw()
  return out
}

export async function loadDocx(bytes: Uint8Array): Promise<DocxParts> {
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file('word/document.xml')
  if (!file) throw new Error('not a Word document: word/document.xml is missing')
  const document = await file.async('string')
  const open = /<w:body(?:\s[^>]*)?>/.exec(document)
  const bodyEnd = document.lastIndexOf('</w:body>')
  if (!open || bodyEnd < 0) throw new Error('word/document.xml has no body')
  const bodyStart = open.index + open[0].length
  return {
    zip,
    document,
    bodyStart,
    bodyEnd,
    elements: splitBody(document.slice(bodyStart, bodyEnd)),
  }
}

/** rows of a table element (top-level rows only), each a list of cell XML */
export function tableRows(tbl: string): string[][] {
  const inner = tbl.slice(tbl.indexOf('>') + 1, tbl.lastIndexOf('</w:tbl>'))
  const rows: string[][] = []
  for (const tr of topLevel(inner, 'w:tr')) rows.push(topLevel(tr, 'w:tc'))
  return rows
}

/** top-level elements named `tag` inside `xml`, nesting-aware */
export function topLevel(xml: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}[ >]|<\\/${tag}>`, 'g')
  let depth = 0
  let start = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('</')) {
      depth--
      if (depth === 0 && start >= 0) {
        out.push(xml.slice(start, m.index + m[0].length))
        start = -1
      }
    } else {
      if (depth === 0) start = m.index
      depth++
    }
  }
  return out
}

export const styleIdOf = (p: string): string | null =>
  /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? null
