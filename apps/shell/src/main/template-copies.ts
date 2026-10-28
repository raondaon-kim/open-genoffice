import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const MAX_ENTRIES = 200

interface Stored {
  version: 1
  /** oldest first: [normalized path, template.md text] */
  entries: Array<[string, string]>
}

const key = (path: string): string => {
  const full = resolve(path)
  return process.platform === 'win32' ? full.toLowerCase() : full
}

/**
 * Which team template each local working copy came from, so the Word AI can write into the
 * template's outline. Kept in userData (never on the NAS); a save-as follows the document.
 */
export class TemplateCopies {
  private entries: Array<[string, string]>

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Stored
      this.entries = Array.isArray(raw.entries) ? raw.entries.filter((e) => Array.isArray(e)) : []
    } catch {
      this.entries = []
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const staged = `${this.file}.tmp`
      writeFileSync(staged, JSON.stringify({ version: 1, entries: this.entries } satisfies Stored))
      renameSync(staged, this.file)
    } catch {
      // the association is a convenience; the document itself is unaffected
    }
  }

  remember(path: string, templateMd: string): void {
    const k = key(path)
    const entry: [string, string] = [k, templateMd]
    this.entries = [...this.entries.filter(([p]) => p !== k), entry].slice(-MAX_ENTRIES)
    this.save()
  }

  lookup(path: string): string | null {
    const k = key(path)
    return this.entries.find(([p]) => p === k)?.[1] ?? null
  }

  moved(oldPath: string, newPath: string): void {
    const md = this.lookup(oldPath)
    if (md === null) return
    const k = key(oldPath)
    this.entries = this.entries.filter(([p]) => p !== k)
    this.remember(newPath, md)
  }
}
