import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const COPY = new Set(['.docx', '.pptx', '.xlsx', '.pdf', '.md', '.txt'])
const HANGUL = new Set(['.hwp', '.hwpx'])
const MAX_FILES = 50
const MAX_BYTES = 100 * 1024 * 1024

export interface AddMaterialResult {
  added: string[]
  skipped: Array<{ file: string; reason: string }>
}

/** a free name in the folder: the wanted one, else "name (2).ext", "name (3).ext" */
function freeName(dir: string, name: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let n = 1
  let candidate = name
  while (existsSync(join(dir, candidate))) candidate = `${stem} (${++n})${ext}`
  return join(dir, candidate)
}

/**
 * Put the user's files into raw/sources for LLM Wiki to learn. Hangul files become Markdown text
 * (LLM Wiki cannot read them); the other formats are copied as they are. Nothing is overwritten.
 */
export async function addMaterial(opts: {
  files: string[]
  rawSources: string
  extractText: (path: string) => Promise<string | null>
}): Promise<AddMaterialResult> {
  const result: AddMaterialResult = { added: [], skipped: [] }
  mkdirSync(opts.rawSources, { recursive: true })
  opts.files.forEach((file, i) => {
    if (i >= MAX_FILES)
      result.skipped.push({ file, reason: `more than ${MAX_FILES} files at once` })
  })
  for (const file of opts.files.slice(0, MAX_FILES)) {
    const ext = extname(file).toLowerCase()
    if (!COPY.has(ext) && !HANGUL.has(ext)) {
      result.skipped.push({ file, reason: 'unsupported file format' })
      continue
    }
    try {
      if (statSync(file).size > MAX_BYTES) {
        result.skipped.push({ file, reason: 'file is larger than 100 MB' })
        continue
      }
      if (COPY.has(ext)) {
        const target = freeName(opts.rawSources, basename(file))
        copyFileSync(file, target)
        result.added.push(target)
        continue
      }
      const text = (await opts.extractText(file))?.replace(/^\[page \d+\]\r?\n/gm, '').trim()
      if (!text) {
        result.skipped.push({ file, reason: 'no readable text in the file' })
        continue
      }
      const stem = basename(file, extname(file))
      const target = freeName(opts.rawSources, `${stem}.md`)
      writeFileSync(target, `# ${stem}\n\n${text}\n`, 'utf8')
      result.added.push(target)
    } catch (err) {
      result.skipped.push({
        file,
        reason: `could not read the file: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  return result
}
