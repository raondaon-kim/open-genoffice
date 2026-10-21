import { PAGE_FOLDERS } from '../types'
import type { WikiHit, WikiHitKind, WikiPage } from '../types'

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const out: string[] = []
  for (const w of words) {
    out.push(w)
    // bigrams: Korean particles and missing spaces still overlap ("제안서를" ~ "제안서")
    if (w.length > 2) for (let i = 0; i + 2 <= w.length; i++) out.push(w.slice(i, i + 2))
    // Latin and Hangul written together ("koica제안") also split at the script change
    for (const part of w.split(/(?<=[a-z0-9])(?=[가-힣])|(?<=[가-힣])(?=[a-z0-9])/)) {
      if (part !== w) out.push(part)
    }
  }
  return out
}

/** what the search indexes: our pages and LLM Wiki's pages alike */
export interface SearchDoc {
  id: string
  kind: WikiHitKind
  title: string
  aliases: string[]
  summary: string
  tags: string[]
  body: string
}

export const docOfPage = (p: WikiPage): SearchDoc => ({
  id: `${PAGE_FOLDERS[p.type]}/${p.slug}`,
  kind: p.type,
  title: p.title,
  aliases: p.aliases,
  summary: p.summary,
  tags: p.tags,
  body: p.body,
})

interface Indexed {
  doc: SearchDoc
  tf: Map<string, number>
  len: number
}

const FIELD_WEIGHTS: Array<[(p: SearchDoc) => string, number]> = [
  [(p) => p.title, 3],
  [(p) => p.aliases.join(' '), 3],
  [(p) => p.summary, 2],
  [(p) => p.tags.join(' '), 2],
  [(p) => p.body, 1],
]

/** BM25-style ranking over weighted page fields */
export class WikiSearch {
  private readonly docs: Indexed[]
  private readonly df = new Map<string, number>()
  private readonly avgLen: number

  constructor(docs: SearchDoc[]) {
    this.docs = docs.map((doc) => {
      const tf = new Map<string, number>()
      let len = 0
      for (const [get, w] of FIELD_WEIGHTS) {
        for (const t of tokenize(get(doc))) {
          tf.set(t, (tf.get(t) ?? 0) + w)
          len += w
        }
      }
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      return { doc, tf, len }
    })
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length)
  }

  search(query: string, k = 5): WikiHit[] {
    const terms = [...new Set(tokenize(query))]
    if (terms.length === 0) return []
    const n = this.docs.length
    const scored = this.docs.map((d) => {
      let score = 0
      for (const t of terms) {
        const f = d.tf.get(t)
        if (!f) continue
        const df = this.df.get(t) ?? 0
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / (this.avgLen || 1))))
      }
      return { d, score }
    })
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ d, score }) => ({
        id: d.doc.id,
        kind: d.doc.kind,
        title: d.doc.title,
        summary: d.doc.summary,
        score,
      }))
  }
}

const LABEL = { work: '업무', method: '작업 방식', client: '기관' } as const

const typeOrder = (t: WikiPage['type']) => (t === 'work' ? 0 : t === 'method' ? 1 : 2)

/** work first (newest first), then methods, then clients */
export function byCatalogOrder(a: WikiPage, b: WikiPage): number {
  return typeOrder(a.type) !== typeOrder(b.type)
    ? typeOrder(a.type) - typeOrder(b.type)
    : b.updated.localeCompare(a.updated)
}

export function catalogLine(p: WikiPage, aliases = false): string {
  const alias = aliases && p.aliases.length ? ` (aliases: ${p.aliases.join(', ')})` : ''
  return `- [${LABEL[p.type]}] ${p.title}${alias} — ${p.summary} (${PAGE_FOLDERS[p.type]}/${p.slug})`
}

/** as many lines as fit in capChars, in order */
export function fitLines(lines: string[], capChars: number): string {
  let out = ''
  for (const line of lines) {
    if (out.length + line.length + 1 > capChars) break
    out += `${line}\n`
  }
  return out.trimEnd()
}

/** one line per page — work first (newest first), then methods, then clients — within capChars */
export function buildCatalog(
  pages: WikiPage[],
  capChars = 3000,
  opts: { aliases?: boolean } = {},
): string {
  return fitLines(
    [...pages].sort(byCatalogOrder).map((p) => catalogLine(p, opts.aliases)),
    capChars,
  )
}

/**
 * The catalog for one question or document: the pages that match `query`
 * first (best match first), then the rest in catalog order, within capChars.
 * A large wiki no longer pushes the relevant page out of a fixed-size list.
 */
export function relevantCatalog(
  pages: WikiPage[],
  query: string,
  capChars: number,
  opts: { aliases?: boolean } = { aliases: true },
): string {
  const idOf = (p: WikiPage) => `${PAGE_FOLDERS[p.type]}/${p.slug}`
  const byId = new Map(pages.map((p) => [idOf(p), p]))
  const first = new WikiSearch(pages.map(docOfPage))
    .search(query, pages.length)
    .map((h) => byId.get(h.id))
    .filter((p): p is WikiPage => p !== undefined)
  const seen = new Set(first.map(idOf))
  const rest = pages.filter((p) => !seen.has(idOf(p))).sort(byCatalogOrder)
  return fitLines(
    [...first, ...rest].map((p) => catalogLine(p, opts.aliases)),
    capChars,
  )
}

/** local hits first, then the other source's, alternating, without duplicate ids */
export function mergeHits(local: WikiHit[], extra: WikiHit[], limit = 8): WikiHit[] {
  const out: WikiHit[] = []
  const seen = new Set<string>()
  const push = (h?: WikiHit) => {
    if (h && !seen.has(h.id) && out.length < limit) {
      seen.add(h.id)
      out.push(h)
    }
  }
  for (let i = 0; i < Math.max(local.length, extra.length); i++) {
    push(local[i])
    push(extra[i])
  }
  return out
}
