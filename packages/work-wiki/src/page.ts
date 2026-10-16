import type { WikiPage, WikiPageType } from './types'

const TYPES: readonly WikiPageType[] = ['work', 'method', 'client']
const LIST_FIELDS = ['aliases', 'tags', 'related', 'sources'] as const
const TEXT_FIELDS = ['title', 'summary', 'created', 'updated'] as const

/** bare when the value is plain words, quoted (JSON string) otherwise */
function quote(value: string): string {
  return /^[\w가-힣 .·()\-/]*$/.test(value) && value.trim() === value && value !== ''
    ? value
    : JSON.stringify(value)
}

function unquote(raw: string): string {
  const v = raw.trim()
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string
    } catch {
      return v.slice(1, -1)
    }
  }
  return v
}

function parseList(raw: string): string[] {
  const v = raw.trim()
  if (!v.startsWith('[') || !v.endsWith(']')) return v ? [unquote(v)] : []
  const inner = v.slice(1, -1)
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (ch === '"' && inner[i - 1] !== '\\') inQuote = !inQuote
    if (ch === ',' && !inQuote) {
      if (cur.trim()) out.push(unquote(cur))
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(unquote(cur))
  return out
}

export function parsePage(text: string, slug: string): WikiPage | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  const fields = new Map<string, string>()
  for (const line of m[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1))
  }
  const type = unquote(fields.get('type') ?? '') as WikiPageType
  if (!TYPES.includes(type)) return null
  const page: WikiPage = {
    slug,
    type,
    title: '',
    aliases: [],
    summary: '',
    tags: [],
    related: [],
    sources: [],
    created: '',
    updated: '',
    body: m[2] ?? '',
  }
  for (const f of TEXT_FIELDS) page[f] = unquote(fields.get(f) ?? '')
  for (const f of LIST_FIELDS) page[f] = parseList(fields.get(f) ?? '')
  return page
}

export function serializePage(page: WikiPage): string {
  const lines = ['---', `type: ${page.type}`]
  for (const f of ['title', 'summary'] as const) lines.push(`${f}: ${quote(page[f])}`)
  for (const f of LIST_FIELDS) lines.push(`${f}: [${page[f].map(quote).join(', ')}]`)
  lines.push(`created: ${page.created}`, `updated: ${page.updated}`, '---')
  return `${lines.join('\n')}\n${page.body}`
}

export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return s || 'page'
}

export interface Section {
  heading: string
  text: string
}

/** level-2 sections of a body; text before the first heading is dropped */
export function sections(body: string): Section[] {
  const out: Section[] = []
  for (const part of body.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n')
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim()
    out.push({ heading, text: nl < 0 ? '' : part.slice(nl + 1).replace(/\s+$/, '') })
  }
  return out
}

export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
