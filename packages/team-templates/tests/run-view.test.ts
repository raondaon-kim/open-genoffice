import { describe, expect, it } from 'vitest'
import { templateForRun } from '../src/run-view'
import type { TemplateDef } from '../src/template-md'

const def = {
  title: 'KOICA ODA 기술제안서',
  purpose: '용역 제안서',
  notes: '제안요청서가 있으면 평가 항목을 따른다.',
  materials: ['제안요청서'],
  wikiPages: ['methods/pmc'],
  outline: [
    { level: 1, heading: '목차', guidance: '장·절 제목을 계층으로' },
    { level: 1, heading: 'Ⅰ. 제안사 소개', guidance: '' },
    { level: 2, heading: '1. 일반현황', guidance: '' },
    { level: 3, heading: '1-1. 회사 일반현황', guidance: '회사명을 글머리로' },
    { level: 3, heading: '1-2. 주요 연혁', guidance: '' },
    { level: 1, heading: 'Ⅱ. 기술 부문', guidance: '장 도입문 한 문단' },
    { level: 2, heading: '1. 사업이해도', guidance: '' },
  ],
} as unknown as TemplateDef

describe('templateForRun', () => {
  it('writes leaves and headings with guidance, with their paths and heading ordinals', () => {
    const run = templateForRun(def, ['사업명', '발주기관'])
    expect(run.sections.map((s) => [s.index, s.heading, s.path])).toEqual([
      [0, '목차', []],
      [3, '1-1. 회사 일반현황', ['Ⅰ. 제안사 소개', '1. 일반현황']],
      [4, '1-2. 주요 연혁', ['Ⅰ. 제안사 소개', '1. 일반현황']],
      [5, 'Ⅱ. 기술 부문', []],
      [6, '1. 사업이해도', ['Ⅱ. 기술 부문']],
    ])
    expect(run.coverLabels).toEqual(['사업명', '발주기관'])
    expect(run.wikiPages).toEqual(['methods/pmc'])
    expect(run.styleRules).toContain('제안요청서가 있으면')
    expect(run.styleRules).toContain('필요한 자료: 제안요청서')
  })
})
