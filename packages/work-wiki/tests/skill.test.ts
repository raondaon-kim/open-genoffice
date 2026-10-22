import { describe, expect, it, vi } from 'vitest'
import { createWorkWikiPreloadApi, createWorkWikiSkill } from '../src/index'
import type { WorkWikiApi } from '../src/types'

const api = (): WorkWikiApi => ({
  catalog: vi.fn(async () => '- [업무] KOICA 보건 — 제안 (koica-health)'),
  index: vi.fn(async () => '# 위키 목차'),
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
  it('puts the rules in the prompt and the catalog for the question in the turn context', async () => {
    const a = api()
    const skill = createWorkWikiSkill(() => a)
    expect(skill.systemPrompt).toContain('wiki_search')
    expect(skill.systemPrompt).toContain('wiki_index')
    expect(await skill.buildContext?.('KOICA 보건 제안서')).toContain('KOICA 보건')
    expect(a.catalog).toHaveBeenCalledWith('KOICA 보건 제안서')
    expect(skill.tools.map((t) => t.name)).toEqual([
      'wiki_search',
      'wiki_read',
      'wiki_index',
      'wiki_remember',
    ])
  })

  it("tells the AI that a page's usage notes are not the source", () => {
    const skill = createWorkWikiSkill(() => api())
    expect(skill.systemPrompt).toContain('## 활용 메모 (원문 아님)')
    expect(skill.systemPrompt).toMatch(/never cite/i)
  })

  it('stripContext removes the catalog from an earlier message and keeps the rest', async () => {
    const skill = createWorkWikiSkill(() => api())
    const ctx = (await skill.buildContext?.('q')) as string
    const message = `내 질문\n\n${ctx}`
    expect(skill.stripContext?.(message)).toBe('내 질문')
    expect(skill.stripContext?.('### 업무 위키 목차 없이 쓴 글')).toBe(
      '### 업무 위키 목차 없이 쓴 글',
    )
  })

  it('a catalog that does not answer in time is left out of the turn', async () => {
    vi.useFakeTimers()
    try {
      const a = api()
      a.catalog = vi.fn(() => new Promise<string>(() => {}))
      const skill = createWorkWikiSkill(() => a)
      const pending = skill.buildContext?.('q') as Promise<string>
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('wiki_index returns the index text from the api', async () => {
    const a = api()
    const skill = createWorkWikiSkill(() => a)
    const top = await skill.executeTool({ id: '1', name: 'wiki_index', input: {} })
    expect(top.output).toBe('# 위키 목차')
    await skill.executeTool({
      id: '2',
      name: 'wiki_index',
      input: { category: 'concepts', group: '교육' },
    })
    expect(a.index).toHaveBeenLastCalledWith('concepts', '교육')
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
    expect(await skill.buildContext?.('q')).toBe('')
    const r = await skill.executeTool({ id: '1', name: 'wiki_search', input: { query: 'x' } })
    expect(r.isError).toBe(true)
    expect(r.output).toContain('업무 위키를 사용할 수 없습니다')
  })

  it('the preload api maps calls to the wiki channels', async () => {
    const invoke = vi.fn(async () => 'ok')
    const p = createWorkWikiPreloadApi(invoke)
    await p.search('q')
    await p.remember(['a'], 'w')
    await p.catalog('question')
    await p.index('concepts', '교육')
    expect(invoke).toHaveBeenNthCalledWith(1, 'wiki:search', 'q')
    expect(invoke).toHaveBeenNthCalledWith(2, 'wiki:remember', ['a'], 'w')
    expect(invoke).toHaveBeenNthCalledWith(3, 'wiki:catalog', 'question')
    expect(invoke).toHaveBeenNthCalledWith(4, 'wiki:index', 'concepts', '교육')
  })
})
