import { detectSensitive, type RuleId } from './rules'
import { XML_FAMILIES, type XmlFamily, xmlParagraphTexts, xmlTextsAndAttrs } from './xml-text'
import { decodePart, isXmlPart, readPackage } from './zip'

export type MaskFormat = 'docx' | 'hwpx' | 'pptx' | 'xlsx' | 'csv' | 'tsv' | 'md' | 'txt' | 'html'

export type VerifyResult =
  | { ok: true }
  | { ok: false; part: string; rule: RuleId }
  /** an embedded object or file the masker cannot open: its content cannot be vouched for */
  | { ok: false; part: string; embedded: true }

const FAMILIES: Partial<Record<MaskFormat, readonly XmlFamily[]>> = {
  docx: [XML_FAMILIES.docx, XML_FAMILIES.drawing],
  pptx: [XML_FAMILIES.drawing],
  xlsx: [XML_FAMILIES.sheet, XML_FAMILIES.inline, XML_FAMILIES.comment, XML_FAMILIES.drawing],
  hwpx: [XML_FAMILIES.hwpx, XML_FAMILIES.drawing],
}

/** raster pictures, sound, video and fonts: never read as text */
const MEDIA =
  /\.(png|jpe?g|gif|bmp|tiff?|ico|webp|wdp|jxr|mp3|mp4|m4a|wav|avi|mov|wmv|ttf|otf|woff2?|odttf|fntdata)$/i

/** vector previews (EMF/WMF) keep the original text of embedded objects as text records */
const VECTOR = /\.(emf|wmf)$/i

/** non-XML entries an Office or Hangul package normally carries and that hold no document text */
const PLAIN_ALLOWED = (name: string): boolean =>
  name === 'mimetype' ||
  /\.(txt|rdf)$/i.test(name) ||
  /(^|\/)printerSettings\/printerSettings\d+\.bin$/i.test(name)

const EMBEDDED_PACKAGE = /\.(xlsx|docx|pptx)$/i

const isZip = (data: Uint8Array): boolean =>
  data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04

function firstHit(texts: Iterable<string>): RuleId | null {
  for (const t of texts) {
    const found = detectSensitive(t)
    if (found.length > 0) return found[0].rule
  }
  return null
}

/** binary bytes read as text every way a number could be stored in them */
function binaryTexts(data: Uint8Array): string[] {
  const buf = Buffer.from(data)
  return [
    buf.toString('utf8'),
    buf.toString('utf16le'),
    buf.length > 1 ? buf.subarray(1).toString('utf16le') : '',
  ]
}

/**
 * Re-checks a masked file independently of the masker. Every part except raster media is read as
 * text (XML: paragraph texts of the format's families, every text node and every attribute value;
 * EMF/WMF previews and printer settings: decoded as UTF-8 and as UTF-16LE at both alignments) and
 * the detectors run on it; embedded Office packages are checked recursively. Any other embedded
 * object or file (OLE objects, attached .hwp/.pdf/.zip, macro documents) cannot be opened, so its
 * content cannot be vouched for and the copy must not leave.
 */
export async function verifyMasked(format: MaskFormat, bytes: Uint8Array): Promise<VerifyResult> {
  const families = FAMILIES[format]
  if (!families) {
    const rule = firstHit([decodePart(bytes).text])
    return rule ? { ok: false, part: '', rule } : { ok: true }
  }
  for (const entry of await readPackage(bytes)) {
    if (MEDIA.test(entry.name)) continue
    if (isXmlPart(entry.name)) {
      const xml = decodePart(entry.data).text
      const rule = firstHit([
        ...families.flatMap((f) => xmlParagraphTexts(xml, f)),
        ...xmlTextsAndAttrs(xml),
      ])
      if (rule) return { ok: false, part: entry.name, rule }
      continue
    }
    if (EMBEDDED_PACKAGE.test(entry.name)) {
      if (!isZip(entry.data)) return { ok: false, part: entry.name, embedded: true }
      const inner = entry.name.toLowerCase().slice(-4) as 'xlsx' | 'docx' | 'pptx'
      const r = await verifyMasked(inner, entry.data).catch(() => null)
      if (r === null) return { ok: false, part: entry.name, embedded: true }
      if (!r.ok) return { ...r, part: `${entry.name}/${r.part}` }
      continue
    }
    if (VECTOR.test(entry.name) || PLAIN_ALLOWED(entry.name)) {
      const rule = firstHit(binaryTexts(entry.data))
      if (rule) return { ok: false, part: entry.name, rule }
      continue
    }
    return { ok: false, part: entry.name, embedded: true }
  }
  return { ok: true }
}
