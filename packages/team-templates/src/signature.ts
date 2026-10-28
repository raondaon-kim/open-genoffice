import { createHash } from 'node:crypto'
import type { DocxOutline } from './docx-outline'
import { normalizeHeading } from './normalize'

export { normalizeHeading }

/** `level:normalized heading` per heading, then `T:header|header` per table */
export function outlineSignature(o: DocxOutline): string[] {
  return [
    ...o.headings.map((h) => `${h.level}:${normalizeHeading(h.text)}`),
    ...o.tables.map((t) => `T:${t.header.map(normalizeHeading).join('|')}`),
  ]
}

export function signatureHash(sig: string[]): string {
  return createHash('sha256').update(sig.join('\n')).digest('hex').slice(0, 16)
}

function levenshtein(a: string[], b: string[]): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]!
}

const headingPart = (sig: string[]) => sig.filter((s) => !s.startsWith('T:'))

/** 0..1 over the heading sequence: 1 - edit distance / longer length */
export function similarity(a: string[], b: string[]): number {
  const x = headingPart(a)
  const y = headingPart(b)
  const longest = Math.max(x.length, y.length)
  if (longest === 0) return 0
  return 1 - levenshtein(x, y) / longest
}

export interface CandidateDoc {
  id: string
  signature: string[]
  certain: boolean
  mtimeMs: number
}
export interface CandidateGroup {
  signatureHash: string
  /** newest first; docs[0] is the representative */
  docs: CandidateDoc[]
  certain: boolean
}

/**
 * Single-link clusters of documents whose heading sequences are at least `threshold` alike.
 * A group needs `minDocs` documents; a document without headings is never a candidate.
 */
export function groupCandidates(
  docs: CandidateDoc[],
  opts: { minDocs: number; threshold?: number },
): CandidateGroup[] {
  const threshold = opts.threshold ?? 0.8
  const usable = docs.filter((d) => headingPart(d.signature).length > 0)
  const parent = usable.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (similarity(usable[i]!.signature, usable[j]!.signature) >= threshold) {
        parent[find(i)] = find(j)
      }
    }
  }
  const clusters = new Map<number, CandidateDoc[]>()
  usable.forEach((d, i) => {
    const root = find(i)
    clusters.set(root, [...(clusters.get(root) ?? []), d])
  })
  return [...clusters.values()]
    .filter((members) => members.length >= Math.max(1, opts.minDocs))
    .map((members) => {
      const sorted = [...members].sort((a, b) => b.mtimeMs - a.mtimeMs)
      return {
        signatureHash: signatureHash(sorted[0]!.signature),
        docs: sorted,
        certain: sorted.every((d) => d.certain),
      }
    })
    .sort((a, b) => b.docs[0]!.mtimeMs - a.docs[0]!.mtimeMs)
}
