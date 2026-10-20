import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { WIKI_MATERIAL_EXTS } from '@genoffice/work-wiki/material'
import type { WikiMaterialResult } from '@genoffice/work-wiki/material'

const HANGUL = new Set(['.hwp', '.hwpx'])
const ACCEPTED = new Set<string>(WIKI_MATERIAL_EXTS.map((e) => `.${e}`))
const MAX_FILES = 50
const MAX_BYTES = 100 * 1024 * 1024

/** a free name in the folder: the wanted one, else "name (2).ext", "name (3).ext" */
function freeName(dir: string, name: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let n = 1
  let candidate = name
  while (existsSync(join(dir, candidate))) candidate = `${stem} (${++n})${ext}`
  return join(dir, candidate)
}

/** the content hash → copied file map; a missing or broken index starts empty */
function readIndex(indexPath: string | undefined): Record<string, string> {
  if (!indexPath) return {}
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Put the user's files into raw/sources for LLM Wiki to learn. Hangul files become Markdown text
 * (LLM Wiki cannot read them); the other formats are copied as they are. Nothing is overwritten.
 * With an index, content already added (same bytes, any name) is reported as a duplicate and not
 * copied again, unless its earlier copy was deleted from the wiki. One result per input file, in
 * input order.
 */
export async function addMaterial(opts: {
  files: string[]
  rawSources: string
  extractText: (path: string) => Promise<string | null>
  indexPath?: string
}): Promise<WikiMaterialResult[]> {
  mkdirSync(opts.rawSources, { recursive: true })
  const index = readIndex(opts.indexPath)
  let indexChanged = false
  const results: WikiMaterialResult[] = []
  for (const [i, file] of opts.files.entries()) {
    if (i >= MAX_FILES) {
      results.push({ path: file, status: 'skipped', reason: 'too-many' })
      continue
    }
    const ext = extname(file).toLowerCase()
    if (!ACCEPTED.has(ext)) {
      results.push({ path: file, status: 'skipped', reason: 'unsupported' })
      continue
    }
    let bytes: Buffer
    try {
      if (statSync(file).size > MAX_BYTES) {
        results.push({ path: file, status: 'skipped', reason: 'too-large' })
        continue
      }
      bytes = readFileSync(file)
    } catch {
      results.push({ path: file, status: 'skipped', reason: 'unreadable' })
      continue
    }
    const hash = createHash('sha256').update(bytes).digest('hex')
    const earlier = index[hash]
    if (earlier && existsSync(earlier)) {
      results.push({ path: file, status: 'duplicate' })
      continue
    }
    try {
      let target: string
      if (HANGUL.has(ext)) {
        const text = (await opts.extractText(file))?.replace(/^\[page \d+\]\r?\n/gm, '').trim()
        if (!text) {
          results.push({ path: file, status: 'skipped', reason: 'no-text' })
          continue
        }
        const stem = basename(file, extname(file))
        target = freeName(opts.rawSources, `${stem}.md`)
        writeFileSync(target, `# ${stem}\n\n${text}\n`, 'utf8')
      } else {
        target = freeName(opts.rawSources, basename(file))
        writeFileSync(target, bytes)
      }
      index[hash] = target
      indexChanged = true
      results.push({ path: file, status: 'added' })
    } catch {
      results.push({ path: file, status: 'skipped', reason: 'unreadable' })
    }
  }
  if (opts.indexPath && indexChanged) {
    mkdirSync(dirname(opts.indexPath), { recursive: true })
    writeFileSync(opts.indexPath, JSON.stringify(index), 'utf8')
  }
  return results
}
