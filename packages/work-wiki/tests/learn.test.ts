import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { extractJson, learn } from '../src/node/learn'
import { WikiStore } from '../src/node/store'

const plan = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    work: {
      slug: null,
      title: 'KOICA 인도네시아 보건 PMC 제안',
      aliases: ['인니 보건 PMC'],
      summary: '보건인력 관리체계 개선 PMC 제안',
    },
    document: '기술제안서 초안, 평가항목 순서로 구성',
    workPoints: ['발주처 KOICA', '사업기간 2024-2028'],
    methods: [
      {
        slug: null,
        title: '제안서 작성 방식',
        points: ['평가항목 순서로 목차 구성', '각 절 끝에 KEY POINT'],
      },
    ],
    client: {
      slug: null,
      title: 'KOICA',
      aliases: ['한국국제협력단'],
      points: ['PDM과 성과지표를 중시'],
    },
    conflicts: [],
    ...over,
  })

function fakeModel() {
  return vi.fn(async (system: string, user: string) => {
    if (system.includes('PLAN')) return 'Here is the plan:\n```json\n' + plan() + '\n```'
    const title = /TITLE: (.*)/.exec(user)?.[1] ?? ''
    return `## 개요\n${title} 요약\n\n## 이력\n`
  })
}

const newStore = () => {
  const s = new WikiStore(mkdtempSync(join(tmpdir(), 'ww-')), () => new Date('2026-10-14T10:00:00'))
  s.bootstrap()
  return s
}

describe('learn', () => {
  it('extracts JSON from prose or code fences', () => {
    expect(extractJson('blah {"a":1} tail')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] })
    expect(() => extractJson('no json')).toThrow()
  })

  it('first learn creates work, method and client pages and a document line kept by code', async () => {
    const store = newStore()
    const model = fakeModel()
    const r = await learn(store, model, {
      kind: 'first',
      title: '제안서',
      path: 'D:/docs/제안서.hwp',
      digest: 'Ⅰ. 사업 이해',
    })
    const work = store.readPage(r.work)!
    expect(work.type).toBe('work')
    expect(work.body).toContain('## 관련 문서')
    expect(work.body).toContain('D:/docs/제안서.hwp')
    expect(work.sources).toEqual(['D:/docs/제안서.hwp'])
    expect(
      store
        .listPages()
        .map((p) => p.type)
        .sort(),
    ).toEqual(['client', 'method', 'work'])
    expect(model).toHaveBeenCalledTimes(4) // plan + 3 merges
  })

  it('a second document about the same work updates the same page by alias', async () => {
    const store = newStore()
    await learn(store, fakeModel(), {
      kind: 'first',
      title: '제안서',
      path: 'D:/a.hwp',
      digest: 'x',
    })
    const slug = store.listPages().find((p) => p.type === 'work')!.slug
    const model = vi.fn(async (system: string) =>
      system.includes('PLAN')
        ? plan({
            work: { slug: null, title: '다른 제목', aliases: ['인니 보건 PMC'], summary: 's' },
            methods: [],
            client: null,
          })
        : '## 개요\n갱신\n\n## 이력\n',
    )
    await learn(store, model, {
      kind: 'revision',
      title: '제안서 v2',
      path: 'D:/b.hwp',
      digest: '[추가] 일정 구체화',
    })
    expect(store.listPages().filter((p) => p.type === 'work')).toHaveLength(1)
    expect(store.readPage(slug)!.sources).toEqual(['D:/a.hwp', 'D:/b.hwp'])
    // the related-documents list keeps the earlier document, newest first
    const related = /## 관련 문서\n([\s\S]*?)(?=\n## |$)/.exec(store.readPage(slug)!.body)![1]!
    expect(related.indexOf('D:/b.hwp')).toBeLessThan(related.indexOf('D:/a.hwp'))
  })

  it('condenses an oversized page once, then truncates at a section boundary', async () => {
    const store = newStore()
    const long = `## 개요\n${'가'.repeat(1400)}\n\n## 진행·결정\n${'나'.repeat(800)}\n\n## 이력\n`
    const model = vi.fn(async (system: string) =>
      system.includes('PLAN') ? plan({ methods: [], client: null }) : long,
    )
    const r = await learn(store, model, {
      kind: 'first',
      title: 't',
      path: 'D:/t.hwp',
      digest: 'x',
    })
    expect(model).toHaveBeenCalledTimes(3) // plan + merge + one condense
    const body = store.readPage(r.work)!.body
    expect(body.length).toBeLessThanOrEqual(1500 + 400) // cap plus the code-kept 관련 문서 section
    expect(body).toContain('## 관련 문서')
  })

  it('restores headings the model dropped from an existing page', async () => {
    const store = newStore()
    await learn(store, fakeModel(), { kind: 'first', title: 'a', path: 'D:/a.hwp', digest: 'x' })
    const slug = store.listPages().find((p) => p.type === 'work')!.slug
    const model = vi.fn(async (system: string) =>
      system.includes('PLAN')
        ? plan({ work: { slug, title: 'x', aliases: [], summary: 's' }, methods: [], client: null })
        : '## 개요\n새 요약\n',
    )
    await learn(store, model, { kind: 'revision', title: 'a', path: 'D:/a.hwp', digest: 'x' })
    const body = store.readPage(slug)!.body
    expect(body).toContain('## 이력')
    expect(body.match(/## 관련 문서/g)).toHaveLength(1)
  })

  it('every page gets a one-line summary for the catalog, even when the plan gives none', async () => {
    const store = newStore()
    await learn(store, fakeModel(), { kind: 'first', title: 't', path: 'D:/t.hwp', digest: 'x' })
    for (const p of store.listPages()) expect(p.summary.trim()).not.toBe('')
    expect(store.listPages().find((p) => p.type === 'method')!.summary).toBe(
      '평가항목 순서로 목차 구성',
    )
  })

  it('throws on a plan that is not usable', async () => {
    const store = newStore()
    await expect(
      learn(store, async () => 'nothing', {
        kind: 'first',
        title: 't',
        path: 'D:/t.hwp',
        digest: 'x',
      }),
    ).rejects.toThrow()
  })
})
