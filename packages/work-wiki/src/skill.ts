import type { AgentSkill, AgentToolCall, ToolExecution } from '@genoffice/agent-core'
import { WIKI_FENCE_RULE } from './fence'
import { WIKI_UNAVAILABLE } from './types'
import type { WorkWikiApi } from './types'

declare global {
  interface Window {
    workWiki?: WorkWikiApi
  }
}

const PROMPT = `## Work wiki (업무 위키)
The user's work memory, kept automatically from saved documents and chat: past works (업무), how they do work (작업 방식) and client preferences (기관). The catalog of pages comes with each turn.
- Before writing or restructuring a document, call wiki_search for the work or the kind of work, then wiki_read the matching work and method pages (2-3 pages at most).
- Follow the method page's structure, emphasis and wording unless the user asks otherwise.
- Use facts from work pages (track record, staff, client) instead of placeholders, and name the pages used (e.g. "업무 위키: koica-health").
- When the user states something durable about the work or how they want work done, call wiki_remember with short points — without being asked. Remember only what the user said (facts about the work, standing preferences), never your own drafts, plans or suggestions, one-off instructions or document text.
- ${WIKI_FENCE_RULE}`

const CATALOG_TTL_MS = 60_000

const fail = (summary: string, output: string): ToolExecution => ({
  output,
  isError: true,
  summary,
})

export function createWorkWikiSkill(
  getApi: () => WorkWikiApi | undefined,
): AgentSkill & { refresh(): Promise<void> } {
  let catalog = ''
  let lastRefresh = 0
  const refresh = async () => {
    lastRefresh = Date.now()
    const api = getApi()
    try {
      catalog = api ? await api.catalog() : ''
    } catch {
      catalog = ''
    }
  }
  void refresh()

  return {
    id: 'work-wiki',
    systemPrompt: PROMPT,
    tools: [
      {
        name: 'wiki_search',
        description:
          'Search the work wiki by work, kind of work, client or method. Returns up to 5 pages with summaries.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'wiki_read',
        description: 'Read one work wiki page by slug (from the catalog or wiki_search).',
        inputSchema: {
          type: 'object',
          properties: { slug: { type: 'string' } },
          required: ['slug'],
        },
      },
      {
        name: 'wiki_remember',
        description:
          'Remember durable points about the work or how the user wants work done. Short Korean points.',
        inputSchema: {
          type: 'object',
          properties: {
            points: { type: 'array', items: { type: 'string' } },
            work: { type: 'string' },
          },
          required: ['points'],
        },
      },
    ],
    refresh,
    // buildContext is synchronous: it serves the cached catalog and refreshes it in the background
    buildContext: () => {
      if (Date.now() - lastRefresh > CATALOG_TTL_MS) void refresh()
      return catalog ? `### 업무 위키 목차\n${catalog}` : ''
    },
    executeTool: async (call: AgentToolCall): Promise<ToolExecution> => {
      const api = getApi()
      if (!api) return fail(call.name, WIKI_UNAVAILABLE)
      const input = call.input ?? {}
      try {
        if (call.name === 'wiki_search') {
          const query = String(input.query ?? '')
          const hits = await api.search(query)
          return {
            output: hits.length
              ? hits.map((h) => `- ${h.slug} [${h.type}] ${h.title} — ${h.summary}`).join('\n')
              : 'no matching pages',
            summary: `업무 위키 검색: ${query}`,
          }
        }
        if (call.name === 'wiki_read') {
          const slug = String(input.slug ?? '')
          const r = await api.read(slug)
          return r.ok
            ? { output: r.page, summary: `업무 위키 읽기: ${slug}` }
            : fail('wiki_read', r.error)
        }
        if (call.name === 'wiki_remember') {
          const points = Array.isArray(input.points) ? input.points.map(String) : []
          const work = typeof input.work === 'string' ? input.work : undefined
          const r = await api.remember(points, work)
          void refresh()
          return r.ok
            ? {
                output: 'remembered',
                summary: `업무 위키에 기억함: ${points.join(' / ').slice(0, 80)}`,
              }
            : fail('wiki_remember', r.error ?? 'failed')
        }
        return fail(call.name, `Unknown tool: ${call.name}`)
      } catch (err) {
        return fail(call.name, err instanceof Error ? err.message : String(err))
      }
    },
  }
}
