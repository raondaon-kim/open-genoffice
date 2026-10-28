import { describe, expect, it } from 'vitest'
import type { DocxOutline } from '../src/docx-outline'
import { draftPrompt, parseDraft } from '../src/draft'

const outline: DocxOutline = {
  headings: [
    { level: 1, text: 'Ⅰ. 제안사 소개', styled: true, index: 2 },
    { level: 2, text: '1-2. 인도네시아 보건 현황', styled: true, index: 4 },
    { level: 2, text: '2. 과업 이해', styled: true, index: 6 },
  ],
  tables: [{ index: 8, header: ['구분', '현황'], rows: 3 }],
  body: ['자카르타 보건소 인력은 2,300명이다.'],
  cover: ['인도네시아 보건인력 PMC 용역', '발주기관 : KOICA'],
  tableCells: ['보건소', '312개'],
  certain: true,
}

describe('draftPrompt', () => {
  it('shows the outlines, cover and header texts but no body sentences', () => {
    const { system, user } = draftPrompt({
      outlines: [outline],
      cover: outline.cover,
      headerFooter: { 'word/header1.xml': '가나다컨설팅 제안서' },
      wikiCatalog: 'methods/pmc-제안서-목차-구성-방식 | PMC 제안서 목차 구성 방식',
    })
    expect(user).toContain('Ⅰ. 제안사 소개')
    expect(user).toContain('1-2. 인도네시아 보건 현황')
    expect(user).toContain('구분 | 현황')
    expect(user).toContain('발주기관 : KOICA')
    expect(user).toContain('word/header1.xml')
    expect(user).not.toContain('2,300명')
    expect(user).not.toContain('312개')
    expect(system).toMatch(/사업명.*숫자.*문장/s)
  })
})

describe('parseDraft', () => {
  const known = new Set(['methods/pmc-제안서-목차-구성-방식'])

  it('fills what the model skipped from the outline and drops unknown wiki pages', () => {
    const d = parseDraft(
      {
        title: 'KOICA ODA 기술제안서',
        purpose: '용역 기술제안서',
        materials: ['제안요청서', 3],
        wikiPages: ['methods/pmc-제안서-목차-구성-방식', 'made/up'],
        headings: ['Ⅰ. 제안사 소개', '1-2. 사업대상지 현황'],
        guidance: ['회사 소개'],
        coverLabels: ['사업명'],
        headerFooter: { 'word/header1.xml': '[제안사] 제안서', 'word/document.xml': 'x' },
      },
      outline,
      known,
    )
    expect(d.headings).toEqual(['Ⅰ. 제안사 소개', '1-2. 사업대상지 현황', '2. 과업 이해'])
    expect(d.guidance).toEqual(['회사 소개', '', ''])
    expect(d.coverLabels).toEqual(['사업명', ''])
    expect(d.wikiPages).toEqual(['methods/pmc-제안서-목차-구성-방식'])
    expect(d.materials).toEqual(['제안요청서'])
    expect(d.headerFooter).toEqual({ 'word/header1.xml': '[제안사] 제안서' })
  })

  it('keeps the original heading when the model returned an empty one and trims extras', () => {
    const d = parseDraft({ title: '', headings: ['', 'x', 'y', 'z'], guidance: [] }, outline, known)
    expect(d.headings).toEqual(['Ⅰ. 제안사 소개', 'x', 'y'])
    expect(d.title).toBe('Ⅰ. 제안사 소개')
  })
})

describe('parseDraft level markers', () => {
  it('drops a "(n) " level marker the model copied from the prompt', () => {
    const d = parseDraft(
      { headings: ['(1) Ⅰ. 제안사 소개', '(2) 1-2. 사업대상지 현황'] },
      outline,
      new Set(),
    )
    expect(d.headings.slice(0, 2)).toEqual(['Ⅰ. 제안사 소개', '1-2. 사업대상지 현황'])
  })
})
