import { detectSensitive, type RuleId } from './rules'
import { XML_FAMILIES, type XmlFamily, xmlParagraphTexts, xmlTextsAndAttrs } from './xml-text'
import { decodePart, isXmlPart, readPackage } from './zip'

export type MaskFormat = 'docx' | 'hwpx' | 'pptx' | 'xlsx' | 'csv' | 'tsv' | 'md' | 'txt' | 'html'

export type VerifyResult = { ok: true } | { ok: false; part: string; rule: RuleId }

const FAMILIES: Partial<Record<MaskFormat, readonly XmlFamily[]>> = {
  docx: [XML_FAMILIES.docx, XML_FAMILIES.drawing],
  pptx: [XML_FAMILIES.drawing],
  xlsx: [XML_FAMILIES.sheet, XML_FAMILIES.inline, XML_FAMILIES.comment, XML_FAMILIES.drawing],
  hwpx: [XML_FAMILIES.hwpx, XML_FAMILIES.drawing],
}

/** pictures, sound, video and fonts: never read as text */
const MEDIA =
  /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|ico|webp|wdp|jxr|mp3|mp4|m4a|wav|avi|mov|wmv|ttf|otf|woff2?|odttf|fntdata)$/i

function firstHit(texts: Iterable<string>): RuleId | null {
  for (const t of texts) {
    const found = detectSensitive(t)
    if (found.length > 0) return found[0].rule
  }
  return null
}

/**
 * Re-checks a masked file independently of the masker: every part except media is read as text
 * (XML: paragraph texts of the format's families, every text node and every attribute value;
 * anything else: decoded as UTF-8 and as UTF-16LE) and the detectors run on it. Any hit means the
 * copy must not leave. Embedded packages are checked as the binary parts they are, which is
 * enough for their XML (deflated text does not match, but the embedded masker ran on them and an
 * unmasked one shows in its stored strings only when it was stored uncompressed).
 */
export async function verifyMasked(format: MaskFormat, bytes: Uint8Array): Promise<VerifyResult> {
  const families = FAMILIES[format]
  if (!families) {
    const rule = firstHit([decodePart(bytes).text])
    return rule ? { ok: false, part: '', rule } : { ok: true }
  }
  for (const entry of await readPackage(bytes)) {
    if (MEDIA.test(entry.name)) continue
    let rule: RuleId | null
    if (isXmlPart(entry.name)) {
      const xml = decodePart(entry.data).text
      rule = firstHit([...families.flatMap((f) => xmlParagraphTexts(xml, f)), ...xmlTextsAndAttrs(xml)])
    } else if (/\.(xlsx|docx|pptx)$/i.test(entry.name)) {
      const inner = entry.name.toLowerCase().endsWith('.xlsx')
        ? 'xlsx'
        : entry.name.toLowerCase().endsWith('.docx')
          ? 'docx'
          : 'pptx'
      const r = await verifyMasked(inner, entry.data).catch(() => null)
      if (r === null) {
        // an embedded file that is not a readable package (e.g. encrypted): read it as bytes
        rule = firstHit([Buffer.from(entry.data).toString('utf8'), Buffer.from(entry.data).toString('utf16le')])
      } else {
        rule = r.ok ? null : r.rule
      }
    } else {
      rule = firstHit([Buffer.from(entry.data).toString('utf8'), Buffer.from(entry.data).toString('utf16le')])
    }
    if (rule) return { ok: false, part: entry.name, rule }
  }
  return { ok: true }
}
