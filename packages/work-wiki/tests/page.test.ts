import { describe, expect, it } from 'vitest'
import { parsePage, sections, serializePage, slugify } from '../src/page'
import type { WikiPage } from '../src/types'

const page: WikiPage = {
  slug: 'koica-indonesia-health',
  type: 'work',
  title: 'KOICA 인도네시아 보건 PMC 제안',
  aliases: ['인니 보건 PMC', 'R25BK01238511'],
  summary: '보건인력 관리체계 개선사업 PMC 제안',
  tags: ['ODA', 'KOICA'],
  related: ['koica'],
  sources: ['D:/docs/제안서.hwp'],
  created: '2026-10-13',
  updated: '2026-10-14',
  body: '## 개요\n보건인력 관리체계 개선.\n\n## 관련 문서\n- 제안서 · 2026-10-13 · 기술제안서 (D:/docs/제안서.hwp)\n\n## 이력\n',
}

describe('page format', () => {
  it('round-trips front matter and body', () => {
    const text = serializePage(page)
    expect(text.startsWith('---\ntype: work\n')).toBe(true)
    expect(parsePage(text, page.slug)).toEqual(page)
  })

  it('reads lists with quotes and commas, and tolerates missing fields', () => {
    const p = parsePage(
      '---\ntype: method\ntitle: "제안서, 작성 방식"\naliases: ["a, b", c]\n---\n본문',
      'm',
    )
    expect(p?.title).toBe('제안서, 작성 방식')
    expect(p?.aliases).toEqual(['a, b', 'c'])
    expect(p?.tags).toEqual([])
    expect(p?.body).toBe('본문')
  })

  it('rejects text without front matter or with an unknown type', () => {
    expect(parsePage('no front matter', 'x')).toBeNull()
    expect(parsePage('---\ntype: note\ntitle: t\n---\n', 'x')).toBeNull()
  })

  it('slugifies Korean and Latin titles to file-safe names', () => {
    expect(slugify('KOICA 인도네시아 보건 PMC 제안!')).toBe('koica-인도네시아-보건-pmc-제안')
    expect(slugify('  /\\:*?  ')).toBe('page')
    expect(slugify('가'.repeat(100)).length).toBe(60)
  })

  it('splits a body into level-2 sections', () => {
    expect(sections(page.body).map((s) => s.heading)).toEqual(['개요', '관련 문서', '이력'])
  })
})
