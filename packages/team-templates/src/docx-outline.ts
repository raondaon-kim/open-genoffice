import { loadDocx, styleIdOf, tableRows, textOf } from './xml'

export interface OutlineHeading {
  level: number
  text: string
  /** true when the level came from a style or outline level, false when it was guessed */
  styled: boolean
  /** body element index (paragraphs and tables counted together) */
  index: number
}
export interface OutlineTable {
  index: number
  header: string[]
  rows: number
}
export interface DocxOutline {
  headings: OutlineHeading[]
  tables: OutlineTable[]
  /** body paragraphs: not headings, not cover, not inside tables */
  body: string[]
  /** paragraphs before the first heading */
  cover: string[]
  /** table body cells (rows after the header row) */
  tableCells: string[]
  /** false when headings were guessed (the document has no heading styles) */
  certain: boolean
}

interface StyleInfo {
  outline: number | null
  basedOn: string | null
  bold: boolean
  size: number | null
}

/** paragraph styles from styles.xml: outline level (inherited), bold and size */
export function readStyles(stylesXml: string): {
  styles: Map<string, StyleInfo>
  normalSize: number
} {
  const styles = new Map<string, StyleInfo>()
  for (const m of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = /w:styleId="([^"]+)"/.exec(m[1]!)?.[1]
    if (!id) continue
    const body = m[2]!
    const outline = /<w:outlineLvl w:val="(\d+)"/.exec(body)?.[1]
    styles.set(id, {
      outline: outline === undefined ? null : Number(outline),
      basedOn: /<w:basedOn w:val="([^"]+)"/.exec(body)?.[1] ?? null,
      bold: /<w:b\/>|<w:b w:val="(?:1|true|on)"\/>/.test(body),
      size: Number(/<w:sz w:val="(\d+)"/.exec(body)?.[1] ?? NaN) || null,
    })
  }
  const normal = styles.get('Normal')
  const defaultSize = Number(/<w:rPrDefault>[\s\S]*?<w:sz w:val="(\d+)"/.exec(stylesXml)?.[1] ?? 22)
  return { styles, normalSize: normal?.size ?? defaultSize }
}

/** a style's outline level following basedOn (at most 10 hops) */
function inheritedOutline(styles: Map<string, StyleInfo>, id: string | null): number | null {
  let current = id
  for (let hops = 0; current && hops < 10; hops++) {
    const s = styles.get(current)
    if (!s) return null
    if (s.outline !== null) return s.outline
    current = s.basedOn
  }
  return null
}

/** level from a style name alone: Heading1, heading 2, 제목1, 제목 2 */
function levelFromStyleId(id: string | null): number | null {
  if (!id) return null
  const m = /^(?:heading|제목)\s*(\d)$/i.exec(id)
  return m ? Number(m[1]) : null
}

/** the level a numbering pattern suggests, for documents without heading styles */
export function guessLevel(text: string): number | null {
  const t = text.trim()
  if (/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.\s]/.test(t)) return 1
  if (/^\d+-\d+\.?\s/.test(t)) return 3
  if (/^\d+\.\s/.test(t)) return 2
  if (/^[가-하]\.\s/.test(t)) return 4
  return null
}

export async function readDocxOutline(bytes: Uint8Array): Promise<DocxOutline> {
  const parts = await loadDocx(bytes)
  const stylesXml = (await parts.zip.file('word/styles.xml')?.async('string')) ?? ''
  const { styles, normalSize } = readStyles(stylesXml)
  const headings: OutlineHeading[] = []
  const tables: OutlineTable[] = []
  const body: string[] = []
  const cover: string[] = []
  const tableCells: string[] = []
  const anyStyled = parts.elements.some((e) => {
    if (e.kind !== 'p') return false
    return styledLevel(e.xml) !== null
  })

  function styledLevel(p: string): number | null {
    const own = /<w:pPr>[\s\S]*?<w:outlineLvl w:val="(\d+)"[\s\S]*?<\/w:pPr>/.exec(p)?.[1]
    if (own !== undefined && Number(own) < 9) return Number(own) + 1
    const id = styleIdOf(p)
    const inherited = inheritedOutline(styles, id)
    if (inherited !== null && inherited < 9) return inherited + 1
    return levelFromStyleId(id)
  }

  function looksEmphasized(p: string): boolean {
    const runSize = Number(/<w:rPr>[\s\S]*?<w:sz w:val="(\d+)"/.exec(p)?.[1] ?? NaN)
    const bold = /<w:rPr>[\s\S]*?(?:<w:b\/>|<w:b w:val="(?:1|true|on)"\/>)/.test(p)
    return bold || (Number.isFinite(runSize) && runSize > normalSize)
  }

  for (const e of parts.elements) {
    if (e.kind === 'tbl') {
      const rows = tableRows(e.xml).map((r) => r.map(textOf))
      tables.push({ index: e.index, header: rows[0] ?? [], rows: rows.length })
      for (const row of rows.slice(1)) tableCells.push(...row)
      continue
    }
    if (e.kind !== 'p') continue
    const text = textOf(e.xml).trim()
    let level = styledLevel(e.xml)
    let styled = level !== null
    if (level === null && !anyStyled && text && looksEmphasized(e.xml)) {
      level = guessLevel(text)
      styled = false
    }
    if (level !== null && text) {
      headings.push({ level, text, styled, index: e.index })
      continue
    }
    if (!text) continue
    if (headings.length === 0) cover.push(text)
    else body.push(text)
  }
  return {
    headings,
    tables,
    body,
    cover,
    tableCells,
    certain: headings.length > 0 && headings.every((h) => h.styled),
  }
}
