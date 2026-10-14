import type { WikiHit, WikiPage } from '../types'

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

interface Doc {
  page: WikiPage
  tf: Map<string, number>
  len: number
}

const FIELD_WEIGHTS: Array<[(p: WikiPage) => string, number]> = [
  [(p) => p.title, 3],
  [(p) => p.aliases.join(' '), 3],
  [(p) => p.summary, 2],
  [(p) => p.tags.join(' '), 2],
  [(p) => p.body, 1],
]

/** BM25-style ranking over weighted page fields */
export class WikiSearch {
  private readonly docs: Doc[]
  private readonly df = new Map<string, number>()
  private readonly avgLen: number

  constructor(pages: WikiPage[]) {
    this.docs = pages.map((page) => {
      const tf = new Map<string, number>()
      let len = 0
      for (const [get, w] of FIELD_WEIGHTS) {
        for (const t of tokenize(get(page))) {
          tf.set(t, (tf.get(t) ?? 0) + w)
          len += w
        }
      }
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      return { page, tf, len }
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
        slug: d.page.slug,
        type: d.page.type,
        title: d.page.title,
        summary: d.page.summary,
        score,
      }))
  }
}

const LABEL = { work: '업무', method: '작업 방식', client: '기관' } as const

/** one line per page — work first (newest first), then methods, then clients — within capChars */
export function buildCatalog(pages: WikiPage[], capChars = 3000): string {
  const order = (t: WikiPage['type']) => (t === 'work' ? 0 : t === 'method' ? 1 : 2)
  const sorted = [...pages].sort((a, b) =>
    order(a.type) !== order(b.type)
      ? order(a.type) - order(b.type)
      : b.updated.localeCompare(a.updated),
  )
  let out = ''
  for (const p of sorted) {
    const line = `- [${LABEL[p.type]}] ${p.title} — ${p.summary} (${p.slug})\n`
    if (out.length + line.length > capChars) break
    out += line
  }
  return out.trimEnd()
}
