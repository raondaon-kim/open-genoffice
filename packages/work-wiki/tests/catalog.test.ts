import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WorkWikiEngine } from '../src/node/engine'
import { relevantCatalog } from '../src/node/search'
import { WikiStore } from '../src/node/store'
import type { WikiPage } from '../src/types'

const page = (
  slug: string,
  title: string,
  updated: string,
  over: Partial<WikiPage> = {},
): WikiPage => ({
  slug,
  type: 'work',
  title,
  aliases: [],
  summary: `${title} 요약`,
  tags: [],
  related: [],
  sources: [],
  created: updated,
  updated,
  body: '## 개요\n내용\n',
  ...over,
})

/** 50 newer unrelated pages and one older page about KOICA */
function pages(): WikiPage[] {
  const out = Array.from({ length: 50 }, (_, i) =>
    page(
      `newer-${i}`,
      `최근 업무 ${i} 일반 행정 처리 문서`,
      `2026-10-${String((i % 20) + 1).padStart(2, '0')}`,
    ),
  )
  out.push(page('koica-health', 'KOICA 보건 PMC 제안', '2024-01-01', { aliases: ['코이카 보건'] }))
  return out
}

describe('relevantCatalog', () => {
  it('lists the page that matches the query first, even behind 50 newer pages, within the cap', () => {
    const text = relevantCatalog(pages(), 'KOICA 보건 사업 제안서 작성', 3000)
    expect(text.length).toBeLessThanOrEqual(3000)
    expect(text.split('\n')[0]).toContain('KOICA 보건 PMC 제안')
    expect(text).toContain('(aliases: 코이카 보건)')
  })

  it('learn: the catalog for a digest contains the most relevant page', () => {
    const many = pages()
    for (let i = 0; i < 200; i++)
      many.push(page(`filler-${i}`, `채움 페이지 ${i} 일반 행정`, '2026-10-20'))
    const text = relevantCatalog(many, '이번 문서는 KOICA 보건 분야 PMC 제안서의 개정본이다', 6000)
    expect(text.length).toBeLessThanOrEqual(6000)
    expect(text).toContain('work/koica-health')
  })
})

describe('WorkWikiEngine.catalogFor', () => {
  function engineWith(extra: () => Promise<never[]> = async () => []) {
    const root = mkdtempSync(join(tmpdir(), 'ww-cat-'))
    const store = new WikiStore(root)
    store.bootstrap()
    for (const p of pages()) store.writePage(p)
    const engine = new WorkWikiEngine({
      root,
      complete: vi.fn(async () => ''),
      extractText: async () => null,
      extraSearch: extra,
    })
    engine.start()
    return { engine, root }
  }

  it('puts a page matching the question first even when 50 newer pages exist, within 3,000 chars', async () => {
    const { engine } = engineWith()
    const text = await engine.catalogFor('KOICA 보건 제안서 어디까지 했지?')
    expect(text.length).toBeLessThanOrEqual(3000)
    expect(text.split('\n')[0]).toContain('KOICA 보건 PMC 제안')
  })

  it('lists the top index categories after the hits', async () => {
    const { engine, root } = engineWith()
    writeFileSync(
      join(root, 'wiki', 'index.md'),
      '# 위키 목차\n\n페이지 120개\n\n## 개념 (40)\n개념, 방법, 용어 · 목록: index/concepts.md\n- [[pdm]] — PDM\n\n## 작업물 (51)\n앱에서 만든 문서 · 목록: index/work.md\n',
    )
    const text = await engine.catalogFor('KOICA 보건')
    expect(text).toContain('개념 (40)')
    expect(text).toContain('wiki_index')
    expect(text.indexOf('KOICA 보건 PMC 제안')).toBeLessThan(text.indexOf('개념 (40)'))
  })

  it('without a question it is the plain catalog', async () => {
    const { engine } = engineWith()
    const text = await engine.catalogFor('')
    expect(text.length).toBeLessThanOrEqual(3000)
    expect(text).toContain('최근 업무')
  })
})

describe('WorkWikiEngine.indexFile', () => {
  function engineWithIndex(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'ww-idx-'))
    for (const [rel, text] of Object.entries(files)) {
      const parts = rel.split('/')
      mkdirSync(join(root, 'wiki', ...parts.slice(0, -1)), { recursive: true })
      writeFileSync(join(root, 'wiki', ...parts), text)
    }
    const engine = new WorkWikiEngine({
      root,
      complete: vi.fn(async () => ''),
      extractText: async () => null,
    })
    engine.start()
    return engine
  }

  it('reads the top, category and group files', () => {
    const engine = engineWithIndex({
      'index.md': '# 위키 목차\n',
      'index/concepts.md': '# 개념 (2)\n- [[a]] — A\n',
      'index/concepts/교육.md': '# 개념 › 교육 (1)\n- [[b]] — B\n',
    })
    expect(engine.indexFile()).toContain('# 위키 목차')
    expect(engine.indexFile('concepts')).toContain('[[a]]')
    expect(engine.indexFile('concepts', '교육')).toContain('[[b]]')
    // the pointers the index files print are accepted too
    expect(engine.indexFile('index/concepts.md')).toContain('[[a]]')
    expect(engine.indexFile('concepts/교육')).toContain('[[b]]')
  })

  it('caps a file at 6,000 chars and says how to narrow it', () => {
    const long = Array.from(
      { length: 400 },
      (_, i) => `- [[p${i}]] — 페이지 ${i} 제목과 요약`,
    ).join('\n')
    const engine = engineWithIndex({ 'index.md': '#\n', 'index/sources.md': long })
    const text = engine.indexFile('sources')
    expect(text.length).toBeLessThanOrEqual(6000)
    expect(text).toMatch(/group|묶음/)
  })

  it('reports that the index is not available when it is missing, and rejects paths outside it', () => {
    const engine = engineWithIndex({})
    expect(engine.indexFile()).toBe('색인이 아직 없습니다. wiki_search로 찾으세요.')
    expect(engine.indexFile('concepts')).toBe('색인이 아직 없습니다. wiki_search로 찾으세요.')
    expect(engine.indexFile('../../secret')).toBe('색인이 아직 없습니다. wiki_search로 찾으세요.')
  })
})
