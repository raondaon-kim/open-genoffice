import type { WikiPort } from './types'

export const PLAN_WIKI_CHARS = 12000
export const PAGE_CHARS = 6000
export const CHAPTER_WIKI_CHARS = 20000
/** LLM Wiki's page folders, tried for a page named without its folder */
const SOURCE_FOLDERS = ['sources', 'entities', 'concepts']

/** page ids in catalog lines (`… (concepts/rope)`) and index lists (`[[rope]]` under a category) */
function pageIds(text: string, category: string | null, into: Set<string>): void {
  let current = category
  for (const line of text.split('\n')) {
    const key = /index\/([^/\n]+?)\.md/.exec(line)?.[1]
    if (key) current = key
    const hit = /\(([\p{L}\p{N}_-]+\/[^()\s]+)\)\s*$/u.exec(line)
    if (hit && !line.includes('wiki_index')) into.add(hit[1]!)
    for (const m of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const slug = m[1]!.trim()
      if (slug.includes('/')) into.add(slug)
      else if (current) into.add(`${current}/${slug}`)
    }
  }
}

/** category keys the catalog and the top index point to, catalog first */
function categoryKeys(catalog: string, top: string): string[] {
  const keys: string[] = []
  for (const m of catalog.matchAll(/wiki_index\("([^"]+)"\)/g)) keys.push(m[1]!)
  for (const m of top.matchAll(/index\/([^/\n]+?)\.md/g)) keys.push(m[1]!)
  return [...new Set(keys)]
}

/**
 * What the plan reads of the wiki: the catalog for the request (matching pages first), the top
 * index, then the category lists, within `cap` chars. `pages` lists every page id the text
 * shows, so the plan's picks can be checked. A failing wiki gives nothing.
 */
export async function planWikiMaterial(
  wiki: WikiPort,
  request: string,
  cap = PLAN_WIKI_CHARS,
): Promise<{ text: string; pages: Set<string> }> {
  try {
    const pages = new Set<string>()
    const pieces: string[] = []
    let used = 0
    const add = (text: string, category: string | null): boolean => {
      const t = text.trim()
      if (!t) return true
      const room = cap - used - 2
      if (room <= 0) return false
      const piece =
        t.length <= room
          ? t
          : t.slice(0, t.lastIndexOf('\n', room) > 0 ? t.lastIndexOf('\n', room) : room)
      pieces.push(piece)
      used += piece.length + 2
      pageIds(piece, category, pages)
      return piece.length === t.length
    }
    const catalog = await wiki.catalog(request)
    const top = await wiki.index()
    add(catalog, null)
    add(top, null)
    for (const key of categoryKeys(catalog, top)) {
      if (!add(await wiki.index(key), key)) break
    }
    return { text: pieces.join('\n\n'), pages }
  } catch {
    return { text: '', pages: new Set() }
  }
}

/** the pages one chapter uses; a page named without its folder is looked up in LLM Wiki's */
export async function readChapterPages(
  wiki: WikiPort,
  ids: string[],
  perPage = PAGE_CHARS,
  total = CHAPTER_WIKI_CHARS,
): Promise<Array<{ id: string; text: string }>> {
  const out: Array<{ id: string; text: string }> = []
  let left = total
  for (const id of ids) {
    if (left <= 0) break
    const tries = id.includes('/') ? [id] : [id, ...SOURCE_FOLDERS.map((f) => `${f}/${id}`)]
    for (const tryId of tries) {
      const text = await wiki.read(tryId).catch(() => null)
      if (text === null) continue
      const piece = text.slice(0, Math.min(perPage, left))
      out.push({ id: tryId, text: piece })
      left -= piece.length
      break
    }
  }
  return out
}

/** the slice of the work-wiki renderer API (`window.workWiki`) the port needs */
export interface WorkWikiLike {
  catalog(query?: string): Promise<string>
  index(category?: string): Promise<string>
  read(id: string): Promise<{ ok: true; page: string } | { ok: false; error: string }>
}

/** `window.workWiki` as a WikiPort; no API (wiki not wired) means no wiki */
export function wikiPortOf(api: WorkWikiLike | undefined): WikiPort | null {
  if (!api) return null
  return {
    catalog: (q) => api.catalog(q),
    index: (c) => api.index(c),
    read: async (id) => {
      const r = await api.read(id)
      return r.ok ? r.page : null
    },
  }
}
