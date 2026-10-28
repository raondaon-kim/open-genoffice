import type { DocxAlign, DocxRole, DocxStyle } from '@genoffice/doc-styles'
import { loadDocx } from './xml'

interface RawStyle {
  basedOn: string | null
  size?: number
  bold?: boolean
  italic?: boolean
  before?: number
  after?: number
  line?: number
  lineRule?: string
  jc?: string
  left?: number
  hanging?: number
  firstLine?: number
  font?: string
}

const attr = (xml: string, tag: string, name: string): string | undefined =>
  new RegExp(`<w:${tag}\\b[^>]*\\bw:${name}="([^"]+)"`).exec(xml)?.[1]
const num = (v: string | undefined): number | undefined =>
  v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v)
const on = (xml: string, tag: string): boolean | undefined => {
  const m = new RegExp(`<w:${tag}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(xml)
  if (!m) return undefined
  return m[1] === undefined || !['0', 'false', 'off'].includes(m[1])
}

function readProps(xml: string, basedOn: string | null): RawStyle {
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml)?.[0] ?? ''
  const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(xml)?.[0] ?? ''
  const s: RawStyle = { basedOn }
  const set = <K extends keyof RawStyle>(k: K, v: RawStyle[K] | undefined) => {
    if (v !== undefined) s[k] = v
  }
  set('size', num(attr(rPr, 'sz', 'val')))
  set('bold', on(rPr, 'b'))
  set('italic', on(rPr, 'i'))
  set('font', attr(rPr, 'rFonts', 'eastAsia') ?? attr(rPr, 'rFonts', 'ascii'))
  set('before', num(attr(pPr, 'spacing', 'before')))
  set('after', num(attr(pPr, 'spacing', 'after')))
  set('line', num(attr(pPr, 'spacing', 'line')))
  set('lineRule', attr(pPr, 'spacing', 'lineRule'))
  set('jc', attr(pPr, 'jc', 'val'))
  set('left', num(attr(pPr, 'ind', 'left') ?? attr(pPr, 'ind', 'start')))
  set('hanging', num(attr(pPr, 'ind', 'hanging')))
  set('firstLine', num(attr(pPr, 'ind', 'firstLine')))
  return s
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const halfPoint = (pt: number) => clamp(Math.round(pt * 2) / 2, 5, 100)
const round1 = (v: number) => Math.round(v * 10) / 10

function alignOf(jc: string | undefined): DocxAlign {
  if (jc === 'both' || jc === 'distribute') return 'justify'
  if (jc === 'center') return 'center'
  if (jc === 'right' || jc === 'end') return 'right'
  return 'left'
}

const PAPERS: Array<[string, number, number]> = [
  ['A4', 210, 297],
  ['A3', 297, 420],
  ['B5', 182, 257],
  ['Letter', 215.9, 279.4],
  ['Legal', 215.9, 355.6],
]
const twipsToMm = (t: number) => (t / 1440) * 25.4

/**
 * A document-style description of a Word document, measured from its styles and first section:
 * the roles a writer needs (title, three heading levels, body, list) and the page setup.
 */
export async function measureDocxStyle(
  bytes: Uint8Array,
  meta: { id: string; title: string; documents: number },
): Promise<DocxStyle> {
  const parts = await loadDocx(bytes)
  const stylesXml = (await parts.zip.file('word/styles.xml')?.async('string')) ?? ''
  const raw = new Map<string, RawStyle>()
  let defaultId = 'Normal'
  /** style id → its name (Korean Word gives headings ids like "1", named "heading 1") */
  const names = new Map<string, string>()
  const outlines = new Map<string, number>()
  /** a style by one of its usual ids, else by name, else by its own outline level */
  const styleFor = (ids: string[], name: RegExp, outline?: number): string | undefined =>
    ids.find((x) => raw.has(x)) ??
    [...names].find(([, n]) => name.test(n))?.[0] ??
    (outline === undefined ? undefined : [...outlines].find(([, o]) => o === outline)?.[0])
  for (const m of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const head = m[1]!
    if (!/w:type="paragraph"/.test(head)) continue
    const id = /w:styleId="([^"]+)"/.exec(head)?.[1]
    if (!id) continue
    if (/w:default="(?:1|true)"/.test(head)) defaultId = id
    raw.set(id, readProps(m[2]!, /<w:basedOn w:val="([^"]+)"/.exec(m[2]!)?.[1] ?? null))
    names.set(id, (/<w:name w:val="([^"]+)"/.exec(m[2]!)?.[1] ?? '').toLowerCase())
    const outline = /<w:outlineLvl w:val="(\d)"/.exec(m[2]!)?.[1]
    if (outline !== undefined) outlines.set(id, Number(outline))
  }
  const defaults = readProps(
    /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(stylesXml)?.[0] ?? '',
    null,
  )

  const resolve = (id: string | null): RawStyle => {
    const chain: RawStyle[] = []
    let current = id
    for (let hops = 0; current && hops < 10; hops++) {
      const s = raw.get(current)
      if (!s) break
      chain.push(s)
      current = s.basedOn
    }
    const out: RawStyle = { ...defaults }
    for (const s of chain.reverse()) {
      for (const [k, v] of Object.entries(s))
        if (v !== undefined && k !== 'basedOn') (out as unknown as Record<string, unknown>)[k] = v
    }
    return out
  }

  const toRole = (
    s: RawStyle,
    base: {
      id: string
      label: string
      kind: DocxRole['kind']
      heading?: number
      bullet?: 'bullet'
    },
  ): DocxRole => {
    const size = halfPoint((s.size ?? 22) / 2)
    const lineSpacing =
      s.line === undefined
        ? 1
        : !s.lineRule || s.lineRule === 'auto'
          ? s.line / 240
          : s.line / 20 / (size * 1.2)
    return {
      id: base.id,
      label: base.label,
      kind: base.kind,
      ...(base.heading ? { heading: base.heading } : {}),
      size,
      bold: s.bold ?? false,
      ...(s.italic ? { italic: true } : {}),
      align: alignOf(s.jc),
      spacingBefore: clamp(round1((s.before ?? 0) / 20), 0, 200),
      spacingAfter: clamp(round1((s.after ?? 0) / 20), 0, 200),
      lineSpacing: clamp(Math.round(lineSpacing * 100) / 100, 0.5, 4),
      indentLeft: clamp(round1((s.left ?? 0) / 20), -100, 500),
      indentFirstLine: clamp(
        round1(s.hanging !== undefined ? -s.hanging / 20 : (s.firstLine ?? 0) / 20),
        -200,
        200,
      ),
      ...(base.bullet ? { bullet: base.bullet } : {}),
    }
  }

  const body = resolve(defaultId)
  const bodySize = (body.size ?? 22) / 2
  const roles: DocxRole[] = []
  if (raw.has('Title'))
    roles.push(toRole(resolve('Title'), { id: 'title', label: '표지 제목', kind: 'title' }))
  const labels = ['장', '절', '항']
  for (let n = 1; n <= 3; n++) {
    const id = styleFor(
      [`Heading${n}`, `heading${n}`, `제목${n}`],
      new RegExp(`^(?:heading|제목)\\s*${n}$`),
      n - 1,
    )
    const s = id
      ? resolve(id)
      : { ...body, size: (bodySize + 2 * (4 - n)) * 2, bold: true, jc: 'left' }
    roles.push(
      toRole(s, { id: `heading-${n}`, label: labels[n - 1]!, kind: 'heading', heading: n }),
    )
  }
  roles.push(toRole(body, { id: 'body', label: '본문', kind: 'body' }))
  if (raw.has('ListParagraph')) {
    roles.push(
      toRole(resolve('ListParagraph'), {
        id: 'bullet',
        label: '글머리 항목',
        kind: 'list',
        bullet: 'bullet',
      }),
    )
  }

  const sectPr =
    /<w:sectPr\b[\s\S]*?<\/w:sectPr>(?![\s\S]*<w:sectPr\b)/.exec(parts.document)?.[0] ?? ''
  const w = num(attr(sectPr, 'pgSz', 'w')) ?? 11906
  const h = num(attr(sectPr, 'pgSz', 'h')) ?? 16838
  const portrait = { w: Math.min(w, h), h: Math.max(w, h) }
  const paper =
    PAPERS.find(
      ([, pw, ph]) =>
        Math.abs(twipsToMm(portrait.w) - pw) < 2 && Math.abs(twipsToMm(portrait.h) - ph) < 2,
    )?.[0] ?? `${Math.round(twipsToMm(portrait.w))}x${Math.round(twipsToMm(portrait.h))}mm`
  const margin = (k: string, fallback: number) =>
    clamp(round1(twipsToMm(num(attr(sectPr, 'pgMar', k)) ?? fallback)), 0, 100)
  const latin = attr(
    /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(stylesXml)?.[0] ?? '',
    'rFonts',
    'ascii',
  )
  const eastAsian = attr(
    /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(stylesXml)?.[0] ?? '',
    'rFonts',
    'eastAsia',
  )

  return {
    format: 'docx',
    id: meta.id,
    title: meta.title.slice(0, 80),
    version: 1,
    evidence: { documents: meta.documents, note: '팀 문서에서 측정한 서식' },
    page: {
      paper,
      orientation: w > h ? 'landscape' : 'portrait',
      marginMm: {
        left: margin('left', 1440),
        right: margin('right', 1440),
        top: margin('top', 1440),
        bottom: margin('bottom', 1440),
      },
      settable: true,
    },
    fonts: { ...(latin ? { latin } : {}), ...(eastAsian ? { eastAsian } : {}) },
    roles,
    skeleton: [{ slot: 'body', roles: roles.map((r) => r.id), required: true, repeat: true }],
  }
}
