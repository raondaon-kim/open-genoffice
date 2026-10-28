import { describe, expect, it } from 'vitest'
import {
  parseIndexMd,
  removeSet,
  renderIndexMd,
  upsertSet,
  type TemplateIndex,
} from '../src/index-md'

const index: TemplateIndex = {
  updatedAt: '2026-10-28 15:20',
  author: '공용',
  sets: [
    {
      title: '국내 연구용역 결과보고서',
      path: 'Word/국내 연구용역 결과보고서/',
      kind: 'Word',
      purpose: '연구용역 결과보고서 본문',
      hash8: '77b0d1aa',
    },
    {
      title: 'KOICA ODA 기술제안서 [본문]',
      path: 'Word/KOICA-ODA-기술제안서/',
      kind: 'Word',
      purpose: 'KOICA 용역 입찰 · 기술제안서',
      hash8: '3f9a1c2e',
    },
    {
      title: '발표 자료',
      path: 'PowerPoint/발표 자료/',
      kind: 'PowerPoint',
      purpose: '',
      hash8: '00ff00ff',
    },
  ],
  loose: [{ name: '경기도 기술제안서.docx', path: 'Word/경기도 기술제안서.docx' }],
}

describe('index.md', () => {
  it('round trips (sets sorted by kind, then title)', () => {
    const parsed = parseIndexMd(renderIndexMd(index))
    expect(parsed).toEqual({
      ...index,
      sets: [index.sets[1], index.sets[0], index.sets[2]],
    })
  })

  it('renders the header and groups by kind in the fixed order', () => {
    const text = renderIndexMd(index)
    expect(text.startsWith('# 팀 템플릿 목록\n갱신: 2026-10-28 15:20 · 공용 · 템플릿 3개\n')).toBe(
      true,
    )
    expect(text.indexOf('## Word')).toBeLessThan(text.indexOf('## PowerPoint'))
    expect(text.indexOf('## PowerPoint')).toBeLessThan(text.indexOf('## 정리되지 않은 파일'))
    expect(text).toContain(
      '- [국내 연구용역 결과보고서](<Word/국내 연구용역 결과보고서/>) — 연구용역 결과보고서 본문 · 확정 · 77b0d1aa',
    )
  })

  it('ignores prose and skips only a broken line', () => {
    const text = renderIndexMd(index).replace(
      '## Word\n',
      '## Word\n누군가 손으로 쓴 메모\n- [깨진 줄](\n',
    )
    const parsed = parseIndexMd(text)!
    expect(parsed.sets).toHaveLength(3)
  })

  it('garbage is not an index', () => {
    expect(parseIndexMd('hello')).toBeNull()
  })

  it('upsertSet replaces by path and removeSet drops it', () => {
    const changed = upsertSet(index, { ...index.sets[0]!, purpose: '바뀐 용도' })
    expect(changed.sets.filter((s) => s.path === index.sets[0]!.path)).toHaveLength(1)
    expect(changed.sets.find((s) => s.path === index.sets[0]!.path)!.purpose).toBe('바뀐 용도')
    expect(removeSet(changed, index.sets[0]!.path).sets).toHaveLength(2)
  })
})

describe('index.md loose files carry size and time', () => {
  it('round trips size and mtime; older lines without them still read', () => {
    const withMeta: TemplateIndex = {
      ...index,
      loose: [
        {
          name: '옛 양식.docx',
          path: 'Word/a/b/옛 양식.docx',
          sizeBytes: 18261,
          mtimeMs: 1793156125865,
        },
      ],
    }
    const text = renderIndexMd(withMeta)
    expect(text).toContain('- [옛 양식.docx](<Word/a/b/옛 양식.docx>) · 18261 · 1793156125865')
    expect(parseIndexMd(text)!.loose).toEqual(withMeta.loose)
    expect(parseIndexMd(renderIndexMd(index))!.loose).toEqual(index.loose)
  })
})
