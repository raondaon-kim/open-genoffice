import { describe, expect, it } from 'vitest'
import { planWikiMaterial, readChapterPages, wikiPortOf } from '../src/wiki'
import type { WikiPort } from '../src/types'

const wikiOf = (pages: Record<string, string>, extra: Partial<WikiPort> = {}): WikiPort => ({
  catalog: async () => '',
  index: async () => '',
  read: async (id) => pages[id] ?? null,
  ...extra,
})

describe('readChapterPages', () => {
  it('reads a bare page id through the category folders and drops missing pages', async () => {
    const got = await readChapterPages(wikiOf({ 'entities/unesco': '유네스코' }), [
      'unesco',
      'ghost',
    ])
    expect(got).toEqual([{ id: 'entities/unesco', text: '유네스코' }])
  })

  it('caps each page at 6,000 chars and all pages at 20,000', async () => {
    const pages = Object.fromEntries(
      [1, 2, 3, 4, 5].map((n) => [`concepts/p${n}`, '가'.repeat(9000)]),
    )
    const got = await readChapterPages(wikiOf(pages), Object.keys(pages))
    expect(got.map((p) => p.text.length)).toEqual([6000, 6000, 6000, 2000])
  })

  it('a page that fails to read is dropped', async () => {
    const got = await readChapterPages(
      wikiOf({}, { read: async () => Promise.reject(new Error('off')) }),
      ['concepts/a'],
    )
    expect(got).toEqual([])
  })
})

describe('planWikiMaterial', () => {
  // the real formats: work-wiki catalogFor() and LLM Wiki's wiki/index.md and wiki/index/<cat>.md
  const catalog = [
    '- [개념] RoPE — 회전 위치 인코딩 (concepts/rope)',
    '- [목차] 개념 (12) — wiki_index("concepts")로 목록을 엽니다',
    '- [목차] 인물·기관 (3) — wiki_index("entities")로 목록을 엽니다',
  ].join('\n')
  const top = [
    '# 위키 목차',
    '',
    '## 개념 (12)',
    '개념 · 목록: index/concepts.md',
    '- [[rope]] — RoPE',
    '',
    '## 인물·기관 (3)',
    '대상 · 목록: index/entities.md',
    '- [[unesco]] — 유네스코',
  ].join('\n')
  const index = async (category?: string) =>
    category === 'concepts'
      ? '# 개념 (12)\n개념, 방법\n\n- [[rope]] — RoPE — s\n- [[alibi]] — ALiBi — s'
      : category === 'entities'
        ? '# 인물·기관 (3)\n\n- [[unesco]] — 유네스코 — s'
        : top

  it('gathers the catalog, the top index and the category lists the catalog names', async () => {
    const got = await planWikiMaterial(wikiOf({}, { catalog: async () => catalog, index }), 'q')
    expect(got.text).toContain('[[alibi]]')
    expect(got.text).toContain('[[unesco]]')
    expect([...got.pages].sort()).toEqual(['concepts/alibi', 'concepts/rope', 'entities/unesco'])
  })

  it('stays within the cap', async () => {
    const big = async (category?: string) =>
      category ? `# ${category}\n${'- [[x]] — y\n'.repeat(2000)}` : top
    const got = await planWikiMaterial(
      wikiOf({}, { catalog: async () => catalog, index: big }),
      'q',
      12000,
    )
    expect(got.text.length).toBeLessThanOrEqual(12000)
  })

  it('a failing wiki gives nothing', async () => {
    const got = await planWikiMaterial(
      wikiOf({}, { catalog: async () => Promise.reject(new Error('off')) }),
      'q',
    )
    expect(got).toEqual({ text: '', pages: new Set() })
  })
})

describe('wikiPortOf', () => {
  it('turns a work-wiki API into the port: a missing page reads as null', async () => {
    const port = wikiPortOf({
      catalog: async (q) => `catalog:${q}`,
      index: async (c) => `index:${c ?? ''}`,
      read: async (id) =>
        id === 'concepts/a' ? { ok: true, page: '본문' } : { ok: false, error: 'no wiki page' },
    })!
    expect(await port.catalog('q')).toBe('catalog:q')
    expect(await port.read('concepts/a')).toBe('본문')
    expect(await port.read('concepts/b')).toBeNull()
  })

  it('no API means no wiki', () => {
    expect(wikiPortOf(undefined)).toBeNull()
  })
})
