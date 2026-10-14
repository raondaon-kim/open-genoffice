import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { maskSensitive } from './mask'

/**
 * The unit of comparison is a line: rhwp export-text gives visual lines with "[page N]" markers
 * and no blank lines inside a page, and docx text puts one paragraph per line. Page markers are
 * dropped so a page break moving is not a change.
 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^\[page \d+\]$/.test(l))
}

const HEADING = /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.|\d+(?:-\d+)*\.|[가-하]\.|제\s*\d+\s*[장절]|[□■])\s*\S/
const LINE_MAX = 300

function fill(lines: string[], cap: number): string {
  let out = ''
  for (const l of lines) {
    const piece = `${l.slice(0, LINE_MAX)}\n`
    if (out.length + piece.length > cap) break
    out += piece
  }
  return out.trimEnd()
}

/**
 * First learn: the outline (numbered headings) plus the first two lines under each; a document
 * with too few headings to outline gives its opening lines up to the cap.
 */
export function buildFirstDigest(text: string, cap = 12000): string {
  const lines = splitParagraphs(text)
  const isHeading = (l: string) => HEADING.test(l) && l.length <= 80
  if (lines.filter(isHeading).length < 3) return fill(lines, cap)
  const picked: string[] = []
  let under = 2
  for (const l of lines) {
    if (isHeading(l)) {
      picked.push(picked.length ? `\n${l}` : l)
      under = 0
    } else if (under < 2) {
      picked.push(l)
      under++
    }
  }
  return fill(picked, cap)
}

export interface Hunk {
  removed: string[]
  added: string[]
}

/** revision learn: the changes in document order, added text ahead of removed within each change */
export function buildRevisionDigest(hunks: Hunk[], cap = 6000): string {
  const lines: string[] = []
  hunks.forEach((h, i) => {
    if (i > 0) lines.push('')
    for (const t of h.added) lines.push(`[추가] ${t}`)
    for (const t of h.removed) lines.push(`[삭제] ${t}`)
  })
  return fill(lines, cap)
}

export type Change =
  | { kind: 'first'; lines: string[] }
  | { kind: 'unchanged' }
  | { kind: 'revision'; lines: string[]; hunks: Hunk[] }

interface Entry {
  hash: string
  /** line hashes of the learned version, aligned with the (masked) snapshot */
  lines: string[]
  work: string | null
  learnedAt: string
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const keyOf = (path: string) => path.replace(/\\/g, '/').normalize('NFC').toLowerCase()
const MAX_LCS_CELLS = 4_000_000

/**
 * Changed regions between two line-hash lists: common prefix and suffix are skipped, the middle
 * goes through a longest-common-subsequence match (one region when the middle is too big).
 */
export function diffRegions(
  a: string[],
  b: string[],
): Array<{ a0: number; a1: number; b0: number; b1: number }> {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const A = a.slice(p, a.length - s)
  const B = b.slice(p, b.length - s)
  if (A.length === 0 && B.length === 0) return []
  if (A.length === 0 || B.length === 0 || (A.length + 1) * (B.length + 1) > MAX_LCS_CELLS) {
    return [{ a0: p, a1: a.length - s, b0: p, b1: b.length - s }]
  }
  const w = B.length + 1
  const dp = new Uint32Array((A.length + 1) * w)
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i * w + j] =
        A[i] === B[j]
          ? dp[(i + 1) * w + j + 1]! + 1
          : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!)
    }
  }
  const regions: Array<{ a0: number; a1: number; b0: number; b1: number }> = []
  let i = 0
  let j = 0
  let openA = -1
  let openB = -1
  const close = () => {
    if (openA >= 0) regions.push({ a0: p + openA, a1: p + i, b0: p + openB, b1: p + j })
    openA = -1
    openB = -1
  }
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      close()
      i++
      j++
    } else {
      if (openA < 0) {
        openA = i
        openB = j
      }
      if (j >= B.length || (i < A.length && dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!)) i++
      else j++
    }
  }
  close()
  return regions
}

/** what was last learned from each document: whole-text hash, line hashes, its work page */
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
    const lines = splitParagraphs(text)
    const entry = this.entries[keyOf(path)]
    if (!entry || !Array.isArray(entry.lines)) return { kind: 'first', lines }
    if (entry.hash === sha(lines.join('\n'))) return { kind: 'unchanged' }
    const oldText = this.snapshot(path)
    const regions = diffRegions(entry.lines, lines.map(sha))
    return {
      kind: 'revision',
      lines,
      hunks: regions.map((r) => ({
        removed: oldText.slice(r.a0, r.a1),
        added: lines.slice(r.b0, r.b1),
      })),
    }
  }

  commit(path: string, text: string, work: string | null): void {
    const lines = splitParagraphs(text)
    this.entries[keyOf(path)] = {
      hash: sha(lines.join('\n')),
      lines: lines.map(sha),
      work,
      learnedAt: new Date().toISOString(),
    }
    // the snapshot only serves the next diff; it is masked like everything else the wiki keeps
    writeFileSync(this.snapshotPath(path), JSON.stringify(lines.map(maskSensitive)), 'utf8')
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
