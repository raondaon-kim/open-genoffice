import { maskDocx } from './formats/docx'
import { maskHwpx } from './formats/hwpx'
import { maskPptx } from './formats/pptx'
import { maskHtml, maskPlainText } from './formats/text'
import { maskXlsx } from './formats/xlsx'
import { type Counts, maskText, type RuleId } from './rules'
import { type MaskFormat, verifyMasked } from './verify'

export { detectSensitive, maskText, PLACEHOLDER } from './rules'
export type { Counts, RuleId, SensitiveMatch } from './rules'
export { verifyMasked } from './verify'
export type { MaskFormat, VerifyResult } from './verify'

const FORMATS: Record<string, MaskFormat> = {
  docx: 'docx',
  hwpx: 'hwpx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  csv: 'csv',
  tsv: 'tsv',
  md: 'md',
  markdown: 'md',
  txt: 'txt',
  html: 'html',
  htm: 'html',
}

export function formatOf(fileName: string): MaskFormat | null {
  const ext = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase()
  return (ext && FORMATS[ext]) || null
}

/** the base name masked like body text; the extension is kept */
export function maskFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return maskText(fileName).text
  return maskText(fileName.slice(0, dot)).text + fileName.slice(dot)
}

export type MaskOutcome =
  | { ok: true; bytes: Uint8Array; counts: Counts }
  | {
      ok: false
      reason: 'unsupported' | 'encrypted' | 'parse' | 'residual'
      part?: string
      rule?: RuleId
    }

/**
 * Masks one saved document and re-checks the result. Only `ok` may leave the PC: a file that
 * cannot be parsed, an encrypted one, and one in which any detector still finds a number never do.
 */
export async function maskDocument(fileName: string, bytes: Uint8Array): Promise<MaskOutcome> {
  const format = formatOf(fileName)
  if (!format) return { ok: false, reason: 'unsupported' }
  let masked: { bytes: Uint8Array; counts: Counts }
  try {
    if (format === 'docx') {
      const r = await maskDocx(bytes)
      if ('encrypted' in r) return { ok: false, reason: 'encrypted' }
      masked = r
    } else if (format === 'hwpx') masked = await maskHwpx(bytes)
    else if (format === 'pptx') masked = await maskPptx(bytes)
    else if (format === 'xlsx') masked = await maskXlsx(bytes)
    else if (format === 'html') masked = maskHtml(bytes)
    else masked = maskPlainText(bytes)
    const check = await verifyMasked(format, masked.bytes)
    if (!check.ok) return { ok: false, reason: 'residual', part: check.part, rule: check.rule }
  } catch {
    return { ok: false, reason: 'parse' }
  }
  return { ok: true, bytes: masked.bytes, counts: masked.counts }
}
