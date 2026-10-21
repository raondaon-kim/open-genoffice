import type { AgentSkill, AgentToolCall, ToolExecution } from '@genoffice/agent-core'
import { fenceWikiText, WIKI_FENCE_RULE } from './fence'
import { WIKI_UNAVAILABLE } from './types'
import type { WorkWikiApi } from './types'

declare global {
  interface Window {
    workWiki?: WorkWikiApi
  }
}

const PROMPT = `## Work wiki (업무 위키)
The user's work memory, kept automatically from saved documents and chat: past works (업무), how they do work (작업 방식) and client preferences (기관). The newest message carries a catalog for it: the pages that match it first, then the wiki's categories ([목차]).
- Before writing or restructuring a document, call wiki_search for the work or the kind of work, then wiki_read the matching work and method pages (2-3 pages at most).
- To browse beyond the catalog, call wiki_index: no argument for the table of contents, a category for its full list, and a group when a category is split.
- For company facts, people, track record and past material, search the wiki first: LLM Wiki's pages (sources, entities, concepts) hold what the user added.
- Follow the method page's structure, emphasis and wording unless the user asks otherwise.
- Use facts from work pages (track record, staff, client) instead of placeholders, and name the pages used (e.g. "업무 위키: koica-health").
- When the user states something durable about the work or how they want work done, call wiki_remember with short points — without being asked. Remember only what the user said (facts about the work, standing preferences), never your own drafts, plans or suggestions, one-off instructions or document text.
- ${WIKI_FENCE_RULE}`

/** a catalog that does not arrive in time is left out of that turn (the tools still work) */
const CATALOG_TIMEOUT_MS = 5_000
const CATALOG_HEADING = '### 업무 위키 목차'
/** the catalog block buildContext attaches; stripContext removes it from earlier messages */
const CATALOG_BLOCK = /\n*### 업무 위키 목차\n⟦업무 위키:[0-9a-f]+⟧[\s\S]*?⟦\/업무 위키:[0-9a-f]+⟧/g

const fail = (summary: string, output: string): ToolExecution => ({
  output,
  isError: true,
  summary,
})

export function createWorkWikiSkill(
  getApi: () => WorkWikiApi | undefined,
): AgentSkill & { refresh(): Promise<void> } {
  /** the catalog for one question; '' when the wiki is off, slow or failing */
  const catalogFor = async (question: string): Promise<string> => {
    const api = getApi()
    if (!api) return ''
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const catalog = await Promise.race([
        api.catalog(question),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve(''), CATALOG_TIMEOUT_MS)
        }),
      ])
      return catalog ? `${CATALOG_HEADING}\n${fenceWikiText(catalog)}` : ''
    } catch {
      return ''
    } finally {
      clearTimeout(timer)
    }
  }
  // kept for callers that warmed the old cached catalog; the catalog is now built per question
  const refresh = async () => {}

  return {
    id: 'work-wiki',
    systemPrompt: PROMPT,
    tools: [
      {
        name: 'wiki_search',
        description:
          'Search the work wiki (our work, method and client pages and the LLM Wiki pages) by work, kind of work, client, person or topic. Returns up to 8 pages with ids and summaries.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'wiki_read',
        description:
          'Read one work wiki page by its id, the path shown by wiki_search or the catalog (e.g. work/koica-health, entities/koica).',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'wiki_index',
        description:
          "Open the work wiki's table of contents. No argument: the top index (categories with counts and recent pages). category (e.g. concepts, sources, work): that category's full page list. group: one group of a split category. Pages listed as [[slug]] can be opened with wiki_read.",
        inputSchema: {
          type: 'object',
          properties: { category: { type: 'string' }, group: { type: 'string' } },
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
    // the catalog for this question rides on the newest message only
    buildContext: (instruction?: string) => catalogFor(instruction ?? ''),
    stripContext: (text: string) => text.replace(CATALOG_BLOCK, ''),
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
              ? fenceWikiText(
                  hits.map((h) => `- ${h.id} [${h.kind}] ${h.title} — ${h.summary}`).join('\n'),
                )
              : 'no matching pages',
            summary: `업무 위키 검색: ${query}`,
          }
        }
        if (call.name === 'wiki_read') {
          const id = String(input.id ?? input.slug ?? '')
          const r = await api.read(id)
          return r.ok
            ? { output: r.page, summary: `업무 위키 읽기: ${id}` }
            : fail('wiki_read', r.error)
        }
        if (call.name === 'wiki_index') {
          const category = typeof input.category === 'string' ? input.category : undefined
          const group = typeof input.group === 'string' ? input.group : undefined
          return {
            output: await api.index(category, group),
            summary: `업무 위키 목차: ${[category, group].filter(Boolean).join(' › ') || '전체'}`,
          }
        }
        if (call.name === 'wiki_remember') {
          const points = Array.isArray(input.points) ? input.points.map(String) : []
          const work = typeof input.work === 'string' ? input.work : undefined
          const r = await api.remember(points, work)
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
