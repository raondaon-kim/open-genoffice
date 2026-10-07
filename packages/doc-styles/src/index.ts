/**
 * Document-style wiki pages (spec §4.1): markdown for people, plus one fenced
 * ```json style block the app reads. This entry is pure (no file access) so the renderer
 * and the main process share it; folder loading and export are in "@genoffice/doc-styles/node".
 */
import { BLOCK, Invalid, isRec, str, type Rec } from './common'
import { type DocxStyle, validateDocx } from './docx'
import { type DocStyle, validateHwp } from './hwp'
import { type PptxStyle, validatePptx } from './pptx'

export * from './hwp'
export * from './docx'
export * from './pptx'
export { type PageCommon, type SkeletonSlot } from './common'

export type StylePage = DocStyle | DocxStyle | PptxStyle
export type StyleFormat = 'hwp' | 'docx' | 'pptx'

export type ParsedAnyStylePage =
  | { ok: true; style: StylePage & { format: StyleFormat }; description: string }
  | { ok: false; error: string }

export type ParsedStylePage =
  { ok: true; style: DocStyle; description: string } | { ok: false; error: string }

function extract(
  markdown: string,
): { ok: true; raw: Rec; description: string } | { ok: false; error: string } {
  const match = BLOCK.exec(markdown)
  if (!match) return { ok: false, error: 'the page has no ```json style block' }
  let raw: unknown
  try {
    raw = JSON.parse(match[1]!)
  } catch (err) {
    return { ok: false, error: `the style block is not valid JSON: ${(err as Error).message}` }
  }
  if (!isRec(raw)) return { ok: false, error: 'the style block must be an object' }
  return {
    ok: true,
    raw,
    description: markdown
      .replace(BLOCK, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }
}

/** reads a page of any format; a page without a "format" is a Hangul page */
export function parseAnyStylePage(markdown: string): ParsedAnyStylePage {
  const got = extract(markdown)
  if (!got.ok) return got
  try {
    const format = got.raw.format === undefined ? 'hwp' : str(got.raw.format, 'format', 10)
    let style: StylePage & { format: StyleFormat }
    if (format === 'hwp') style = validateHwp(got.raw) as DocStyle & { format: 'hwp' }
    else if (format === 'docx') style = validateDocx(got.raw)
    else if (format === 'pptx') style = validatePptx(got.raw)
    else throw new Invalid(`format must be one of hwp, docx, pptx (got "${format}")`)
    return { ok: true, style, description: got.description }
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message }
    throw err
  }
}

/** the Hangul reader the Hangul app uses: it refuses pages of other formats */
export function parseStylePage(markdown: string): ParsedStylePage {
  const r = parseAnyStylePage(markdown)
  if (!r.ok) return r
  if (r.style.format !== 'hwp') {
    return { ok: false, error: `this is a ${r.style.format} page, not a Hangul page` }
  }
  return { ok: true, style: r.style as DocStyle, description: r.description }
}
