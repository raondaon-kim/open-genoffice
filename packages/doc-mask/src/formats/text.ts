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
