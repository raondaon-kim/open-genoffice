import JSZip from 'jszip'
import { readDocxOutline } from './docx-outline'
import { XMLValidator } from 'fast-xml-parser'
import { escapeXml, loadDocx, matchingClose, tableRows, textOf, topLevel } from './xml'

export interface FormOptions {
  /** generalized heading texts, same count and order as the source's headings */
  headings?: string[]
  /** a label per cover paragraph: the paragraph becomes `[label]`; '' or missing empties it */
  coverLabels?: string[]
  /** part name (e.g. 'word/header1.xml') → its generalized text */
  headerFooter?: Record<string, string>
}

/** the paragraph's own properties (nested pPr inside a tracked change counted), or '' */
function pPrOf(p: string): string {
  const open = /^<w:p(?:\s[^>]*)?>\s*/.exec(p)
  if (!open) return ''
  const at = open[0].length
  if (p.startsWith('<w:pPr/>', at)) return '<w:pPr/>'
  if (!p.startsWith('<w:pPr>', at) && !p.startsWith('<w:pPr ', at)) return ''
  const end = matchingClose(p, at, 'w:pPr')
  return end < 0 ? '' : stripHistory(p.slice(at, end))
}

/** tracked formatting changes keep the old formatting and its author: never part of a form */
const stripHistory = (xml: string): string =>
  xml.replace(
    /<w:(pPrChange|rPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange)\b[\s\S]*?<\/w:\1>/g,
    '',
  )

/** the paragraph with its pPr only: no runs, no text */
const emptyParagraph = (p: string): string => `<w:p>${pPrOf(p)}</w:p>`

/** the paragraph with one plain run holding `text` in the formatting of its first text run */
export function setParagraphText(p: string, text: string): string {
  const firstText = topLevel(p, 'w:r').find((r) => /<w:t[ >]/.test(r)) ?? ''
  const rPr = stripHistory(
    /^<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(firstText)?.[1] ?? '',
  )
  const run = text ? `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` : ''
  return `<w:p>${pPrOf(p)}${run}</w:p>`
}

/** a run that carries something other than text: a picture, an object, a text box, a comment mark */
const CARRIER =
  /<w:drawing\b|<w:pict\b|<w:object\b|<mc:AlternateContent\b|<w:commentReference\b|<w:footnoteReference\b|<w:endnoteReference\b/

/** tracked changes accepted, comments, pictures, text boxes and history dropped, in a paragraph that stays */
function cleanKept(p: string): string {
  let out = p
    .replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')
    .replace(/<w:ins\b[^>]*>|<\/w:ins>/g, '')
    .replace(/<w:comment(?:RangeStart|RangeEnd)\b[^>]*\/>/g, '')
  for (const run of topLevel(out, 'w:r')) if (CARRIER.test(run)) out = out.replace(run, '')
  return stripHistory(out)
}

/** a cell with its properties and one empty paragraph (a cell must end with a paragraph) */
function emptyCell(tc: string): string {
  const tcPr = /^<w:tc(?:\s[^>]*)?>\s*(<w:tcPr>[\s\S]*?<\/w:tcPr>)?/.exec(tc)?.[1] ?? ''
  const first = /<w:p(?=[\s>/])/.exec(tc.slice(tcPr.length))
  let pPr = ''
  if (first) {
    const from = tc.indexOf(first[0], tcPr.length)
    const end = tc.startsWith('<w:p/>', from) ? from + 6 : matchingClose(tc, from, 'w:p')
    if (end > 0) pPr = pPrOf(tc.slice(from, end))
  }
  return `<w:tc>${stripHistory(tcPr)}<w:p>${pPr}</w:p></w:tc>`
}

const emptyRow = (tr: string): string => {
  const cells = topLevel(tr, 'w:tc')
  const trPr = /^<w:tr(?:\s[^>]*)?>\s*(<w:trPr>[\s\S]*?<\/w:trPr>)?/.exec(tr)?.[1] ?? ''
  return `<w:tr>${stripHistory(trPr)}${cells.map(emptyCell).join('')}</w:tr>`
}

const HEADER_CELL_CHARS = 30

/**
 * A first row is form only when it looks like a header: the table has body rows, the row repeats
 * as a header (w:tblHeader) or every filled cell is bold or shaded, and no cell reads like a value.
 */
function looksLikeHeader(rows: string[]): boolean {
  const row = rows[0]!
  if (rows.length < 2) return false
  const cells = topLevel(row, 'w:tc')
  const texts = cells.map((c) => textOf(c).trim())
  if (texts.some((t) => Array.from(t).length > HEADER_CELL_CHARS)) return false
  if (/<w:tblHeader(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(row)) return true
  const marked = (c: string) =>
    /<w:b\/>|<w:b w:val="(?:1|true|on)"\/>/.test(c) ||
    /<w:shd\b[^>]*w:fill="(?!auto|FFFFFF|ffffff)[0-9A-Fa-f]{6}"/.test(c)
  const filled = cells.filter((c, i) => texts[i])
  return filled.length > 0 && filled.every(marked)
}

/** a table with its header row (when it is one) and one emptied row, every value removed */
function emptyTable(tbl: string): string {
  const rows = topLevel(tbl, 'w:tr')
  if (rows.length === 0) return tbl
  const head = stripHistory(tbl.slice(0, tbl.indexOf(rows[0]!)))
  const tail = tbl.slice(tbl.lastIndexOf(rows.at(-1)!) + rows.at(-1)!.length)
  const kept = looksLikeHeader(rows)
    ? [stripHistory(cleanKept(rows[0]!)), emptyRow(rows[1]!)]
    : [emptyRow(rows[0]!), ...(rows[1] ? [emptyRow(rows[1])] : [])]
  return head + kept.join('') + tail
}

async function editPart(zip: JSZip, name: string, edit: (xml: string) => string): Promise<void> {
  const file = zip.file(name)
  if (!file) return
  zip.file(name, edit(await file.async('string')))
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (base + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

const relsOf = (name: string) => name.replace(/([^/]*)$/, '_rels/$1.rels')
const ownerOf = (rel: string) => rel.replace(/_rels\/([^/]*)\.rels$/, '$1')
const baseOf = (rel: string) => rel.replace(/_rels\/[^/]*\.rels$/, '')

/** relationship types whose parts hold content (pictures, charts, SmartArt, objects, media) */
const CONTENT_REL =
  /relationships\/(image|chart|diagram\w*|oleObject|package|control|video|audio|media)"|\/(?:chart|diagram)\w*"/
/** folders whose parts are content; a part there that nothing references any more goes */
const CONTENT_DIRS = /^word\/(media|charts|embeddings|diagrams|activeX|glossary)\//

/**
 * Content parts the form no longer uses: relationships of content types whose id the owning part
 * does not mention any more are dropped, the glossary (building blocks hold text) always, then
 * every part in a content folder that no remaining relationship reaches, with its own rels.
 */
async function dropUnusedContent(zip: JSZip): Promise<void> {
  const names = () => Object.keys(zip.files).filter((n) => !zip.files[n]!.dir)
  for (const rel of names().filter((n) => n.endsWith('.rels'))) {
    const owner = ownerOf(rel)
    const ownerXml = (await zip.file(owner)?.async('string')) ?? null
    await editPart(zip, rel, (xml) =>
      xml.replace(/<Relationship\b[^>]*\/>/g, (r) => {
        if (/relationships\/glossaryDocument"/.test(r)) return ''
        if (!CONTENT_REL.test(r) || ownerXml === null) return r
        const id = /Id="([^"]+)"/.exec(r)?.[1] ?? ''
        return new RegExp(`r:(?:embed|id|link|dm|lo|qs|cs|pict)="${id}"`).test(ownerXml) ? r : ''
      }),
    )
  }
  // remove unreachable content parts until nothing changes (a chart's rels reach its workbook)
  for (let pass = 0; pass < 5; pass++) {
    const reached = new Set<string>()
    for (const rel of names().filter((n) => n.endsWith('.rels'))) {
      const owner = ownerOf(rel)
      if (owner && !zip.file(owner) && rel !== '_rels/.rels') continue
      const xml = await zip.file(rel)!.async('string')
      for (const m of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
        if (/TargetMode="External"/.test(m[0])) continue
        reached.add(resolvePath(baseOf(rel), /Target="([^"]+)"/.exec(m[0])?.[1] ?? ''))
      }
    }
    const gone = names().filter(
      (n) =>
        (CONTENT_DIRS.test(n) && !n.includes('/_rels/') && !reached.has(n)) ||
        (n.includes('/_rels/') && CONTENT_DIRS.test(n) && !zip.file(ownerOf(n))),
    )
    if (gone.length === 0) break
    for (const n of gone) {
      zip.remove(n)
      zip.remove(relsOf(n))
    }
    await editPart(zip, '[Content_Types].xml', (xml) =>
      xml.replace(/<Override\b[^>]*\/>/g, (o) => {
        const name = /PartName="\/([^"]+)"/.exec(o)?.[1] ?? ''
        return gone.includes(name) ? '' : o
      }),
    )
  }
  dropEmptyFolders(zip)
}

/** removes parts and every relationship / content-type entry that points at them */
async function dropParts(zip: JSZip, match: (name: string) => boolean): Promise<void> {
  const gone = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir && match(n))
  if (gone.length === 0) return
  for (const n of gone) zip.remove(n)
  dropEmptyFolders(zip)
  for (const rel of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
    await editPart(zip, rel, (xml) =>
      xml.replace(/<Relationship\b[^>]*\/>/g, (r) => {
        if (/TargetMode="External"/.test(r)) return r
        const resolved = resolvePath(baseOf(rel), /Target="([^"]+)"/.exec(r)?.[1] ?? '')
        return gone.includes(resolved) ? '' : r
      }),
    )
  }
  await editPart(zip, '[Content_Types].xml', (xml) =>
    xml.replace(/<Override\b[^>]*\/>/g, (o) => {
      const name = /PartName="\/([^"]+)"/.exec(o)?.[1] ?? ''
      return gone.includes(name) ? '' : o
    }),
  )
}

const CORE_FIELDS = [
  'dc:title',
  'dc:subject',
  'dc:creator',
  'cp:keywords',
  'dc:description',
  'cp:lastModifiedBy',
  'cp:category',
]

/**
 * The form of a Word document: headings, cover layout, slots and table shapes kept with their
 * formatting; every sentence, value and personal trace removed.
 */
export async function buildFormDocx(
  source: Uint8Array,
  opts: FormOptions = {},
): Promise<Uint8Array> {
  const parts = await loadDocx(source)
  const outline = await readDocxOutline(source)
  const headingAt = new Map(outline.headings.map((h, i) => [h.index, i]))
  if (opts.headings && opts.headings.length !== outline.headings.length) {
    throw new Error('heading count differs')
  }
  let out = ''
  let seenHeading = false
  let coverNo = 0
  let slotDone = true
  for (const e of parts.elements) {
    if (e.kind === 'raw') {
      // body-level content controls (w:sdt, e.g. a cover page) keep their shape, not their text
      out += stripHistory(e.xml).replace(
        /<w:(t|delText)(\s[^>]*)?>[^<]*<\/w:\1>/g,
        '<w:$1$2></w:$1>',
      )
      continue
    }
    const h = headingAt.get(e.index)
    if (h !== undefined) {
      seenHeading = true
      const kept = cleanKept(e.xml)
      out += opts.headings ? setParagraphText(kept, opts.headings[h]!) : kept
      slotDone = false
      continue
    }
    if (e.kind === 'tbl') {
      if (!slotDone && seenHeading) {
        out += '<w:p/>'
        slotDone = true
      }
      out += emptyTable(e.xml)
      continue
    }
    if (!seenHeading) {
      if (!textOf(e.xml).trim()) {
        out += emptyParagraph(e.xml)
        continue
      }
      const label = opts.coverLabels?.[coverNo++]
      out += label ? setParagraphText(cleanKept(e.xml), `[${label}]`) : emptyParagraph(e.xml)
      continue
    }
    // a section break lives in a paragraph's pPr: keep that paragraph, emptied
    if (!slotDone || /<w:sectPr\b/.test(pPrOf(e.xml))) {
      out += emptyParagraph(e.xml)
      slotDone = true
    }
  }
  if (!slotDone) out += '<w:p/>'
  const zip = parts.zip
  zip.file(
    'word/document.xml',
    parts.document.slice(0, parts.bodyStart) + out + parts.document.slice(parts.bodyEnd),
  )

  // a header/footer keeps its layout, fields (page numbers) and logo; its words are the AI's
  // generalized text, or nothing when the AI left that part alone
  for (const name of Object.keys(zip.files).filter((n) =>
    /^word\/(header|footer)\d*\.xml$/.test(n),
  )) {
    const text = opts.headerFooter?.[name] ?? ''
    await editPart(zip, name, (xml) => {
      let first = true
      return stripHistory(xml).replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, () => {
        if (!first || !text) return '<w:t></w:t>'
        first = false
        return `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`
      })
    })
  }
  for (const name of ['word/footnotes.xml', 'word/endnotes.xml']) {
    await editPart(zip, name, (xml) => xml.replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/g, '<w:t$1></w:t>'))
  }
  await dropParts(
    zip,
    (n) =>
      /^word\/comments[^/]*\.xml$/.test(n) ||
      /^word\/people\.xml$/.test(n) ||
      /^docProps\/thumbnail\.[a-z]+$/.test(n) ||
      /^docProps\/custom\.xml$/.test(n) ||
      n.startsWith('customXml/'),
  )
  await editPart(zip, 'docProps/core.xml', (xml) =>
    CORE_FIELDS.reduce(
      (acc, f) => acc.replace(new RegExp(`<${f}(\\s[^>]*)?>[^<]*</${f}>`, 'g'), `<${f}$1></${f}>`),
      xml,
    ),
  )
  await editPart(zip, 'docProps/app.xml', (xml) =>
    xml
      .replace(/<(Company|Manager)>[^<]*<\/\1>/g, '<$1></$1>')
      .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/g, (t) =>
        t.replace(/<vt:lpstr>[^<]*<\/vt:lpstr>/g, '<vt:lpstr></vt:lpstr>'),
      ),
  )
  await dropUnusedContent(zip)
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}

export async function formHeadingTexts(form: Uint8Array): Promise<string[]> {
  return (await readDocxOutline(form)).headings.map((h) => h.text)
}

/** the form with its heading texts replaced in order (the md is the source of truth) */
export async function setFormHeadings(form: Uint8Array, headings: string[]): Promise<Uint8Array> {
  const outline = await readDocxOutline(form)
  if (outline.headings.length !== headings.length) throw new Error('heading count differs')
  const parts = await loadDocx(form)
  const headingAt = new Map(outline.headings.map((h, i) => [h.index, i]))
  let out = ''
  for (const e of parts.elements) {
    const h = e.kind === 'raw' ? undefined : headingAt.get(e.index)
    out += h === undefined ? e.xml : setParagraphText(e.xml, headings[h]!)
  }
  parts.zip.file(
    'word/document.xml',
    parts.document.slice(0, parts.bodyStart) + out + parts.document.slice(parts.bodyEnd),
  )
  return new Uint8Array(
    await parts.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
  )
}

/** paragraph texts of the body, headers, footers, footnotes and endnotes (table cells included) */
export async function docxTexts(bytes: Uint8Array): Promise<string[]> {
  const parts = await loadDocx(bytes)
  const names = Object.keys(parts.zip.files).filter((n) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n),
  )
  const out: string[] = []
  for (const name of names) {
    const xml = await parts.zip.file(name)!.async('string')
    for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
      const t = textOf(m[0]).trim()
      if (t) out.push(t)
    }
  }
  return out
}

export { tableRows }

/** each header/footer part with text → that text (paragraphs joined by a space) */
export async function headerFooterTexts(bytes: Uint8Array): Promise<Record<string, string>> {
  const parts = await loadDocx(bytes)
  const out: Record<string, string> = {}
  for (const name of Object.keys(parts.zip.files).sort()) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue
    const xml = await parts.zip.file(name)!.async('string')
    const text = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
      .map((m) => textOf(m[0]).trim())
      .filter(Boolean)
      .join(' ')
    if (text) out[name] = text
  }
  return out
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/**
 * Every piece of text in the package: paragraph texts of the Word parts, and the text nodes of
 * every other XML part (charts, SmartArt, properties, anything unknown). Relationship and
 * content-type lists are not text.
 */
export async function packageTexts(bytes: Uint8Array): Promise<string[]> {
  const parts = await loadDocx(bytes)
  const out = await docxTexts(bytes)
  for (const name of Object.keys(parts.zip.files).sort()) {
    if (parts.zip.files[name]!.dir || !/\.xml$/i.test(name)) continue
    if (
      name === '[Content_Types].xml' ||
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)
    )
      continue
    const xml = await parts.zip.file(name)!.async('string')
    for (const piece of xml.split(/<[^>]+>/)) {
      const t = piece
        .replace(/&(lt|gt|amp|quot|apos);/g, (_m, e: string) => XML_ENTITIES[e]!)
        .trim()
      if (t) out.push(t)
    }
  }
  return out
}

/** the first XML part that is not well-formed, or null */
export async function validateDocxXml(bytes: Uint8Array): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes)
  for (const name of Object.keys(zip.files).sort()) {
    if (zip.files[name]!.dir || !/\.(xml|rels)$/i.test(name)) continue
    const xml = await zip.file(name)!.async('string')
    if (XMLValidator.validate(xml) !== true) return name
  }
  return null
}

/** folder entries without files, deepest first so a parent of empty folders goes too */
function dropEmptyFolders(zip: JSZip): void {
  const dirs = Object.keys(zip.files)
    .filter((n) => zip.files[n]!.dir)
    .sort((a, b) => b.length - a.length)
  for (const dir of dirs) {
    if (!Object.keys(zip.files).some((n) => n !== dir && n.startsWith(dir))) zip.remove(dir)
  }
}
