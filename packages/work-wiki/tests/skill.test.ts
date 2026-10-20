import { describe, expect, it, vi } from 'vitest'
import { createWorkWikiPreloadApi, createWorkWikiSkill } from '../src/index'
import type { WorkWikiApi } from '../src/types'

const api = (): WorkWikiApi => ({
  catalog: vi.fn(async () => '- [업무] KOICA 보건 — 제안 (koica-health)'),
  search: vi.fn(async () => [
    {
      id: 'work/koica-health',
      kind: 'work' as const,
      title: 'KOICA 보건',
      summary: '제안',
      score: 3,
    },
  ]),
  read: vi.fn(async () => ({ ok: true as const, page: '⟦업무 위키:1⟧\n...\n⟦/업무 위키:1⟧' })),
  remember: vi.fn(async () => ({ ok: true })),
  status: vi.fn(async () => ({ enabled: true })),
  addMaterial: vi.fn(async () => []),
})

describe('work wiki skill', () => {
  it('puts the rules in the prompt and the cached catalog in the turn context', async () => {
    const skill = createWorkWikiSkill(() => api())
    await skill.refresh()
    expect(skill.systemPrompt).toContain('wiki_search')
    expect(skill.buildContext?.()).toContain('KOICA 보건')
    expect(skill.tools.map((t) => t.name)).toEqual(['wiki_search', 'wiki_read', 'wiki_remember'])
  })

  it('remembers only what the user said, never its own drafts', () => {
    const skill = createWorkWikiSkill(() => undefined)
    expect(skill.systemPrompt).toContain('only what the user said')
  })

  it('runs the three tools against the api', async () => {
    const a = api()
    const skill = createWorkWikiSkill(() => a)
    const s = await skill.executeTool({ id: '1', name: 'wiki_search', input: { query: 'KOICA' } })
    expect(s.output).toContain('work/koica-health')
    const r = await skill.executeTool({
      id: '2',
      name: 'wiki_read',
      input: { id: 'work/koica-health' },
    })
    expect(r.output.startsWith('⟦업무 위키:')).toBe(true)
    const m = await skill.executeTool({
      id: '3',
      name: 'wiki_remember',
      input: { points: ['표는 앞에'] },
    })
    expect(m.summary).toContain('업무 위키에 기억함')
    expect(a.remember).toHaveBeenCalledWith(['표는 앞에'], undefined)
  })

  it('degrades softly when the wiki is not available', async () => {
    const skill = createWorkWikiSkill(() => undefined)
    await skill.refresh()
    expect(skill.buildContext?.()).toBe('')
    const r = await skill.executeTool({ id: '1', name: 'wiki_search', input: { query: 'x' } })
    expect(r.isError).toBe(true)
    expect(r.output).toContain('업무 위키를 사용할 수 없습니다')
  })

  it('the preload api maps calls to the wiki channels', async () => {
    const invoke = vi.fn(async () => 'ok')
    const p = createWorkWikiPreloadApi(invoke)
    await p.search('q')
    await p.remember(['a'], 'w')
    expect(invoke).toHaveBeenNthCalledWith(1, 'wiki:search', 'q')
    expect(invoke).toHaveBeenNthCalledWith(2, 'wiki:remember', ['a'], 'w')
  })
})
