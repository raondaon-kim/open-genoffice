import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** paragraphs: blank-line separated, plus a break before a numbered/bulleted heading line */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n|\r?\n(?=\s*(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.|\d+(?:-\d+)*\.|[가-하]\.|[□■○●▶◆]))/)
    .map((p) => p.trim())
    .filter(Boolean)
}

const HEADING = /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.|\d+(?:-\d+)*\.|[가-하]\.|제\s*\d+\s*[장절]|[□■])\s*\S/

/** first learn: the outline plus the first lines of each section, never the whole document */
export function buildFirstDigest(paragraphs: string[], cap = 12000): string {
  const out: string[] = []
  let sinceHeading = 99
  for (const p of paragraphs) {
    const firstLine = p.split(/\r?\n/)[0]!.slice(0, 160)
    if (HEADING.test(firstLine) && firstLine.length <= 80) {
      out.push(`\n${firstLine}`)
      const second = p.split(/\r?\n/)[1]
      if (second) out.push(second.slice(0, 160))
      sinceHeading = 0
    } else if (sinceHeading < 2) {
      out.push(firstLine)
      sinceHeading++
    } else if (out.length < 8) {
      out.push(firstLine) // documents without numbered headings: keep the opening
    }
  }
  return out.join('\n').trim().slice(0, cap)
}

/** revision learn: only what changed, labelled */
export function buildRevisionDigest(added: string[], removed: string[], cap = 6000): string {
  const lines = [...removed.map((t) => `[삭제] ${t}`), ...added.map((t) => `[추가] ${t}`)]
  let out = ''
  for (const l of lines) {
    const piece = l.slice(0, 600)
    if (out.length + piece.length + 1 > cap) break
    out += `${piece}\n`
  }
  return out.trimEnd()
}

export type Change =
  | { kind: 'first'; paragraphs: string[] }
  | { kind: 'unchanged' }
  | { kind: 'revision'; added: string[]; removed: string[]; paragraphs: string[] }

interface Entry {
  hash: string
  paragraphs: string[]
  work: string | null
  learnedAt: string
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const keyOf = (path: string) => path.replace(/\\/g, '/').normalize('NFC').toLowerCase()

/** what was last learned from each document: whole-text hash, paragraph hashes, its work page */
export class DocumentRegistry {
  private readonly file: string
  private readonly snapDir: string
  private readonly entries: Record<string, Entry>

  constructor(stateDir: string) {
    this.snapDir = join(stateDir, 'snapshots')
    mkdirSync(this.snapDir, { recursive: true })
    this.file = join(stateDir, 'documents.json')
    this.entries = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Entry>)
      : {}
  }

  compare(path: string, text: string): Change {
    const paragraphs = splitParagraphs(text)
    const entry = this.entries[keyOf(path)]
    if (!entry) return { kind: 'first', paragraphs }
    if (entry.hash === sha(text)) return { kind: 'unchanged' }
    const old = new Set(entry.paragraphs)
    const now = new Set(paragraphs.map(sha))
    return {
      kind: 'revision',
      paragraphs,
      added: paragraphs.filter((p) => !old.has(sha(p))),
      removed: this.snapshot(path).filter((p) => !now.has(sha(p))),
    }
  }

  commit(path: string, text: string, work: string | null): void {
    const paragraphs = splitParagraphs(text)
    this.entries[keyOf(path)] = {
      hash: sha(text),
      paragraphs: paragraphs.map(sha),
      work,
      learnedAt: new Date().toISOString(),
    }
    writeFileSync(this.snapshotPath(path), JSON.stringify(paragraphs), 'utf8')
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.entries, null, 1), 'utf8')
    renameSync(tmp, this.file)
  }

  workOf(path: string): string | null {
    return this.entries[keyOf(path)]?.work ?? null
  }

  private snapshotPath(path: string): string {
    return join(this.snapDir, `${sha(keyOf(path)).slice(0, 16)}.json`)
  }

  private snapshot(path: string): string[] {
    const f = this.snapshotPath(path)
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as string[]) : []
  }
}
