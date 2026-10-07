import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAnyStylePage, type StyleFormat, type StylePage } from './index'

/** the bundled document-style wiki (spec §4.1, §4.5): read, list and export the pages (main process only) */

export interface StylePageFile {
  style: StylePage & { format: StyleFormat }
  description: string
  file: string
}

/** reads every page; invalid or unreadable pages are reported in `errors` and skipped. Ids are unique across formats. */
export function loadStylePages(dir: string): { pages: StylePageFile[]; errors: string[] } {
  if (!existsSync(dir)) return { pages: [], errors: [`style folder not found: ${dir}`] }
  const pages: StylePageFile[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(join(dir, file), 'utf8')
    } catch (err) {
      errors.push(`${file}: cannot be read (${err instanceof Error ? err.message : String(err)})`)
      continue
    }
    const parsed = parseAnyStylePage(text)
    if (!parsed.ok) {
      errors.push(`${file}: ${parsed.error}`)
      continue
    }
    if (seen.has(parsed.style.id)) {
      errors.push(`${file}: duplicate style id "${parsed.style.id}"`)
      continue
    }
    seen.add(parsed.style.id)
    pages.push({ style: parsed.style, description: parsed.description, file })
  }
  pages.sort((a, b) => a.style.id.localeCompare(b.style.id))
  return { pages, errors }
}

export const EXPORT_FOLDER = 'genoffice-doc-styles'

/** copy the markdown pages to <targetParent>/genoffice-doc-styles; never overwrites unless asked */
export function exportStylePages(
  dir: string,
  targetParent: string,
  options: { overwrite: boolean },
):
  | { ok: true; target: string; count: number }
  | { ok: false; conflicts: string[]; error?: undefined }
  | { ok: false; conflicts?: undefined; error: string } {
  const target = join(targetParent, EXPORT_FOLDER)
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort()
    : []
  if (files.length === 0) return { ok: true, target, count: 0 }
  const conflicts = files.filter((f) => existsSync(join(target, f)))
  if (conflicts.length > 0 && !options.overwrite) return { ok: false, conflicts }
  try {
    mkdirSync(target, { recursive: true })
    for (const file of files) copyFileSync(join(dir, file), join(target, file))
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  return { ok: true, target, count: files.length }
}
