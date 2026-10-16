import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { WikiHitKind } from '../types'
import type { SearchDoc } from './search'

/** folders GenOffice owns; everything else under wiki/ belongs to LLM Wiki */
const OWN = new Set(['work', 'methods', 'clients'])
const CATALOG_FILES = new Set(['index.md', 'log.md', 'overview.md'])
const KIND_BY_FOLDER: Record<string, WikiHitKind> = {
  entities: 'entity',
  concepts: 'concept',
  sources: 'source',
}
const MAX_FILES = 3000
const MAX_DEPTH = 3
const MAX_READ = 20_000
const MAX_BODY = 6_000

function frontMatter(text: string): { fields: Map<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const fields = new Map<string, string>()
  if (!m) return { fields, body: text }
  for (const line of m[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return { fields, body: m[2] ?? '' }
}

const unquote = (v: string) => v.replace(/^["']|["']$/g, '').trim()

function listOf(raw: string | undefined): string[] {
  if (!raw) return []
  const inner = raw.replace(/^\[|\]$/g, '')
  return inner.split(',').map(unquote).filter(Boolean)
}

function docOf(file: string, id: string): SearchDoc {
  const text = readFileSync(file, 'utf8').slice(0, MAX_READ)
  const { fields, body } = frontMatter(text)
  const heading = /^# (.+)$/m.exec(body)?.[1]?.trim()
  const firstLine = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  const folder = id.split('/')[0]!
  return {
    id,
    kind: KIND_BY_FOLDER[folder] ?? 'other',
    title: unquote(fields.get('title') ?? '') || heading || id.split('/').pop()!,
    aliases: [],
    summary: (firstLine ?? '').slice(0, 160),
    tags: listOf(fields.get('tags')),
    body: body.slice(0, MAX_BODY),
  }
}

/** every page under wiki/ that LLM Wiki wrote, as search documents */
export function readForeignDocs(wikiDir: string): { docs: SearchDoc[] } {
  const docs: SearchDoc[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > MAX_DEPTH || docs.length >= MAX_FILES) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.') || docs.length >= MAX_FILES) continue
      const path = join(dir, name)
      const relPath = rel ? `${rel}/${name}` : name
      let isDir: boolean
      try {
        isDir = statSync(path).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        if (!rel && (OWN.has(name) || name === 'media')) continue
        walk(path, relPath, depth + 1)
      } else if (name.endsWith('.md')) {
        if (!rel && CATALOG_FILES.has(name)) continue
        try {
          docs.push(docOf(path, relPath.slice(0, -3)))
        } catch {
          // an unreadable file is skipped
        }
      }
    }
  }
  if (existsSync(wikiDir)) walk(wikiDir, '', 0)
  return { docs }
}

const SEGMENT = /^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/

/** the absolute file of a page id under wiki/, or null for anything that is not a plain page inside it */
export function resolveWikiFile(wikiDir: string, id: string): string | null {
  const clean = id.endsWith('.md') ? id.slice(0, -3) : id
  const parts = clean.split('/')
  if (parts.length === 0 || parts.length > MAX_DEPTH + 1) return null
  if (!parts.every((p) => SEGMENT.test(p))) return null
  const base = resolve(wikiDir)
  const file = resolve(base, ...parts) + '.md'
  if (!file.startsWith(base + sep)) return null
  return existsSync(file) ? file : null
}
