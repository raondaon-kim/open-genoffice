import { describe, expect, it } from 'vitest'
import { buildCatalog, docOfPage, mergeHits, tokenize, WikiSearch } from '../src/node/search'
import type { SearchDoc } from '../src/node/search'
import type { WikiHit, WikiPage } from '../src/types'

const p = (slug: string, over: Partial<WikiPage>): WikiPage => ({
  slug,
  type: 'work',
  title: slug,
  aliases: [],
  summary: '',
  tags: [],
  related: [],
  sources: [],
  created: '2026-10-01',
  updated: '2026-10-01',
  body: '',
  ...over,
})

const pages = [
  p('koica-health', {
    title: 'KOICA 인도네시아 보건 PMC 제안',
    aliases: ['코이카 인니 보건'],
    summary: 'ODA 제안',
    updated: '2026-10-13',
  }),
  p('gyeonggi-eco', {
    title: '경기도 도시생태현황지도 기술제안',
    summary: '공공입찰 제안',
    updated: '2026-10-10',
  }),
  p('proposal-method', {
    type: 'method',
    title: '제안서 작성 방식',
    summary: '실적 표를 앞에, 개조식',
  }),
  p('koica', {
    type: 'client',
    title: 'KOICA',
    aliases: ['한국국제협력단', '코이카'],
    summary: '표와 PDM 선호',
  }),
]

describe('work wiki search', () => {
  it('tokenizes Korean into words and character bigrams', () => {
    expect(tokenize('코이카 제안서를')).toEqual(
      expect.arrayContaining(['코이카', '제안서를', '코이', '이카', '제안']),
    )
  })

  it('finds the work page with particles and spacing variants', () => {
    const s = new WikiSearch(pages.map(docOfPage))
    expect(s.search('코이카 제안서를')[0]?.id).toBe('work/koica-health')
    expect(s.search('KOICA제안').map((h) => h.id)).toContain('work/koica-health')
    expect(s.search('도시생태')[0]?.id).toBe('work/gyeonggi-eco')
  })

  it('returns at most k hits and nothing for an empty query', () => {
    const s = new WikiSearch(pages.map(docOfPage))
    expect(s.search('제안', 2)).toHaveLength(2)
    expect(s.search('   ')).toEqual([])
  })

  it('builds a capped catalog with work pages first, newest first', () => {
    const c = buildCatalog(pages)
    expect(c.indexOf('KOICA 인도네시아')).toBeLessThan(c.indexOf('경기도'))
    expect(c.indexOf('경기도')).toBeLessThan(c.indexOf('제안서 작성 방식'))
    expect(buildCatalog(pages, 120).length).toBeLessThanOrEqual(120)
  })

  it('ranks LLM Wiki pages together with ours', () => {
    const foreign: SearchDoc = {
      id: 'entities/koica-health-co',
      kind: 'entity',
      title: '코이카 보건 협력',
      aliases: [],
      summary: '',
      tags: [],
      body: '',
    }
    const s = new WikiSearch([...pages.map(docOfPage), foreign])
    expect(s.search('코이카 보건').map((h) => h.id)).toContain('entities/koica-health-co')
  })

  it('merges hit lists, ours first, without duplicates, within the limit', () => {
    const h = (id: string): WikiHit => ({ id, kind: 'work', title: id, summary: '', score: 1 })
    expect(mergeHits([h('a'), h('b')], [h('x'), h('a'), h('y')], 4).map((x) => x.id)).toEqual([
      'a',
      'x',
      'b',
      'y',
    ])
    expect(mergeHits([], [h('x')], 8).map((x) => x.id)).toEqual(['x'])
  })
})
