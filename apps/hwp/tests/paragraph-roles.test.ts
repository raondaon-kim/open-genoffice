import { describe, expect, it } from 'vitest'
import { buildRoles, levelStep, markerOf } from '../src/shared/paragraph-roles'
import type { RoleSource } from '../src/shared/paragraph-roles'

describe('markerOf', () => {
  it.each([
    ['1. 관련', 'N.'],
    ['12. 열두 번째', 'N.'],
    ['가. 서울특별시', '가.'],
    ['1) 일정', 'N)'],
    ['가) 근거', '가)'],
    ['(1) 항목', '(N)'],
    ['(가) 항목', '(가)'],
    ['① 첫째', '①'],
    ['□ 추진 배경', '□'],
    ['■ 추진 배경', '□'],
    ['○ 전사 자동화', '○'],
    ['- 세부 내용', '-'],
    ['· 항목', '·'],
    ['▸ 참고', '▸'],
    ['※ 유의사항', '※'],
    ['붙임  1. 계획표', '붙임'],
    ['끝.', '끝'],
    ['Ⅱ. 사업 개요', 'Ⅰ.'],
    ['제3조(목적) 이 규정은', '제N조'],
    ['일반 문장입니다.', 'text'],
    ['2026. 10. 6.', 'text'],
    ['', 'empty'],
    ['   ', 'empty'],
  ])('%s -> %s', (text, expected) => {
    expect(markerOf(text)).toBe(expected)
  })

  it('ignores leading spaces and tabs', () => {
    expect(markerOf('   ○ 항목')).toBe('○')
    expect(markerOf('\t가. 항목')).toBe('가.')
  })
})

const p = (paragraph: number, preview: string, over: Partial<RoleSource> = {}): RoleSource => ({
  section: 0,
  paragraph,
  preview,
  empty: preview.trim() === '',
  ...over,
})

describe('buildRoles', () => {
  const list = [
    p(0, '1. 관련', { lead: 0, fontSize: 13, bold: false, indent: 660 }),
    p(1, '가. 근거', { lead: 2, fontSize: 13, bold: false, indent: 660 }),
    p(2, '나. 규정', { lead: 2, fontSize: 13, bold: false, indent: 700 }),
    p(3, '', { fontSize: 6 }),
    p(4, '붙임 1. 표', { lead: 0, fontSize: 13, bold: false, indent: 0 }),
    p(5, '다. 지침', { lead: 2, fontSize: 15, bold: false, indent: 660 }),
  ]

  it('groups text paragraphs by marker, leading spaces, size and bold, in order of appearance', () => {
    const { roles, roleOf } = buildRoles(list)
    expect(roles.map((r) => [r.marker, r.lead, r.size, r.count])).toEqual([
      ['N.', 0, 13, 1],
      ['가.', 2, 13, 2],
      ['붙임', 0, 13, 1],
      ['가.', 2, 15, 1],
    ])
    expect(roles[1]).toMatchObject({
      id: 1,
      example: { section: 0, paragraph: 1 },
      indentRange: [660, 700],
    })
    expect(roleOf.get('0.2')).toBe(1)
    expect(roleOf.get('0.5')).toBe(3)
  })

  it('gives blank paragraphs no role', () => {
    const { roleOf } = buildRoles(list)
    expect(roleOf.has('0.3')).toBe(false)
  })

  it('treats a missing size or indent as unknown', () => {
    const { roles } = buildRoles([p(0, '○ 항목', { lead: 1 })])
    expect(roles[0]).toMatchObject({ size: null, bold: false, indentRange: null })
  })
})

describe('levelStep', () => {
  it('is the median extra leading space between adjacent outline levels', () => {
    const list = [
      p(0, '□ 배경', { lead: 0 }),
      p(1, '○ 내용', { lead: 1 }),
      p(2, '- 세부', { lead: 3 }),
      p(3, '○ 내용', { lead: 1 }),
      p(4, '- 세부', { lead: 3 }),
    ]
    expect(levelStep(list)).toBe(2)
  })

  it('is 2 when no adjacent levels show a step', () => {
    expect(levelStep([p(0, '일반 문장', { lead: 0 })])).toBe(2)
    expect(levelStep([])).toBe(2)
  })
})
