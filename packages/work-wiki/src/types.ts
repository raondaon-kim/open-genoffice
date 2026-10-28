import type { WikiMaterialApi } from './material'

export type WikiPageType = 'work' | 'method' | 'client'

/** folder under wiki/ for each page type */
export const PAGE_FOLDERS: Record<WikiPageType, string> = {
  work: 'work',
  method: 'methods',
  client: 'clients',
}

/** body length caps in characters */
export const PAGE_CAPS: Record<WikiPageType, number> = {
  work: 1500,
  method: 2000,
  client: 800,
}

export interface WikiPage {
  slug: string
  type: WikiPageType
  title: string
  aliases: string[]
  summary: string
  tags: string[]
  related: string[]
  sources: string[]
  created: string
  updated: string
  body: string
}

export type WikiHitKind = 'work' | 'method' | 'client' | 'entity' | 'concept' | 'source' | 'other'

export interface WikiHit {
  /** path under wiki/ without .md, e.g. work/koica-health or entities/koica */
  id: string
  kind: WikiHitKind
  title: string
  summary: string
  score: number
}

/** what an assistant can do with the work wiki (window.workWiki) */
export interface WorkWikiApi extends WikiMaterialApi {
  /** the catalog for a question (pages it matches first); the plain catalog without one */
  catalog(query?: string): Promise<string>
  /** LLM Wiki's index: the top index, a category's list, or one group of it */
  index(category?: string, group?: string): Promise<string>
  search(query: string): Promise<WikiHit[]>
  read(id: string): Promise<{ ok: true; page: string } | { ok: false; error: string }>
  remember(points: string[], work?: string): Promise<{ ok: boolean; error?: string }>
  /**
   * LLM Wiki answering, waited for (bounded) and restarted once if needed; a template fill
   * checks this first. Optional: hosts without the bundled LLM Wiki leave it out.
   */
  ensureReady?(): Promise<WikiReadiness>
}

export type WikiReadiness = { ok: true } | { ok: false; off: boolean; reason: string }

export const WIKI_CHANNELS = {
  catalog: 'wiki:catalog',
  index: 'wiki:index',
  search: 'wiki:search',
  read: 'wiki:read',
  remember: 'wiki:remember',
  status: 'wiki:status',
  addMaterial: 'wiki:add-material',
  ensureReady: 'wiki:ensure-ready',
} as const

export const WIKI_UNAVAILABLE = '업무 위키를 사용할 수 없습니다'
