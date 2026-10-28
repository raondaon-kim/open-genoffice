import type JSZip from 'jszip'
import { readDocxOutline } from './docx-outline'
import { escapeXml, loadDocx, tableRows, textOf, topLevel } from './xml'

export interface FormOptions {
  /** generalized heading texts, same count and order as the source's headings */
  headings?: string[]
  /** a label per cover paragraph: the paragraph becomes `[label]`; '' or missing empties it */
  coverLabels?: string[]
  /** part name (e.g. 'word/header1.xml') → its generalized text */
  headerFooter?: Record<string, string>
}

/** the paragraph's properties, or '' */
const pPrOf = (p: string): string => /<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>/.exec(p)?.[0] ?? ''

/** the paragraph with its pPr only: no runs, no text */
const emptyParagraph = (p: string): string => `<w:p>${pPrOf(p)}</w:p>`

/** the paragraph with one plain run holding `text` in the formatting of its first run */
export function setParagraphText(p: string, text: string): string {
  const rPr = /<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(p)?.[1] ?? ''
  const run = text ? `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` : ''
  return `<w:p>${pPrOf(p)}${run}</w:p>`
}

/** tracked changes accepted, comments and pictures dropped, in a paragraph that stays */
function cleanKept(p: string): string {
  return p
    .replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')
    .replace(/<w:ins\b[^>]*>|<\/w:ins>/g, '')
    .replace(/<w:(?:pPrChange|rPrChange)\b[\s\S]*?<\/w:(?:pPrChange|rPrChange)>/g, '')
    .replace(/<w:comment(?:RangeStart|RangeEnd)\b[^>]*\/>/g, '')
    .replace(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[\s\S]*?<\/w:r>/g, '')
    .replace(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:(?:drawing|pict|object)>[\s\S]*?<\/w:r>/g, '')
}

/** a table with its header row and one emptied copy of its first body row */
function emptyTable(tbl: string): string {
  const rows = topLevel(tbl, 'w:tr')
  if (rows.length === 0) return tbl
  const head = tbl.slice(0, tbl.indexOf(rows[0]!))
  const tail = tbl.slice(tbl.lastIndexOf(rows.at(-1)!) + rows.at(-1)!.length)
  const kept = [cleanKept(rows[0]!)]
  if (rows[1]) {
    kept.push(rows[1].replace(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g, (p) => emptyParagraph(p)))
  }
  return head + kept.join('') + tail
}

async function editPart(zip: JSZip, name: string, edit: (xml: string) => string): Promise<void> {
  const file = zip.file(name)
  if (!file) return
  zip.file(name, edit(await file.async('string')))
}

/** removes parts and every relationship / content-type entry that points at them */
async function dropParts(zip: JSZip, match: (name: string) => boolean): Promise<void> {
  const gone = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir && match(n))
  if (gone.length === 0) return
  for (const n of gone) zip.remove(n)
  // folder entries left without files go too
  for (const dir of Object.keys(zip.files).filter((n) => zip.files[n]!.dir)) {
    if (!Object.keys(zip.files).some((n) => n !== dir && n.startsWith(dir))) zip.remove(dir)
  }
  const relFiles = Object.keys(zip.files).filter((n) => n.endsWith('.rels'))
  for (const rel of relFiles) {
    // `_rels/.rels` belongs to the package root: its base is ''
    const base = rel.replace(/_rels\/[^/]*\.rels$/, '')
    await editPart(zip, rel, (xml) =>
      xml.replace(/<Relationship\b[^>]*\/>/g, (r) => {
        const target = /Target="([^"]+)"/.exec(r)?.[1] ?? ''
        if (/TargetMode="External"/.test(r)) return r
        const resolved = resolvePath(base, target)
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

/** relationship ids of images the document part no longer uses → the media they point at */
async function dropUnusedMedia(zip: JSZip): Promise<void> {
  const used = new Set<string>()
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith('.xml') || name.includes('_rels')) continue
    const xml = await zip.file(name)!.async('string')
    for (const m of xml.matchAll(/r:(?:embed|id|link)="([^"]+)"/g)) used.add(`${name}#${m[1]}`)
  }
  const media = new Set<string>()
  for (const rel of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
    const owner = rel.replace(/_rels\/([^/]*)\.rels$/, '$1')
    const base = rel.replace(/_rels\/[^/]*\.rels$/, '')
    await editPart(zip, rel, (xml) =>
      xml.replace(/<Relationship\b[^>]*\/>/g, (r) => {
        if (!/relationships\/image"/.test(r)) return r
        const id = /Id="([^"]+)"/.exec(r)?.[1] ?? ''
        if (used.has(`${owner}#${id}`)) {
          media.add(resolvePath(base, /Target="([^"]+)"/.exec(r)?.[1] ?? ''))
          return r
        }
        return ''
      }),
    )
  }
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith('word/media/') && !media.has(name)) zip.remove(name)
  }
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
      out += e.xml
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

  for (const [name, text] of Object.entries(opts.headerFooter ?? {})) {
    await editPart(zip, name, (xml) => {
      let first = true
      return xml.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, () => {
        if (!first) return '<w:t></w:t>'
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
    xml.replace(/<(Company|Manager)>[^<]*<\/\1>/g, '<$1></$1>'),
  )
  await dropUnusedMedia(zip)
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
