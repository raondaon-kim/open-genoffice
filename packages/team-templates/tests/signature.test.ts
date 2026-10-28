import { describe, expect, it } from 'vitest'
import type { DocxOutline } from '../src/docx-outline'
import {
  groupCandidates,
  normalizeHeading,
  outlineSignature,
  signatureHash,
  similarity,
  type CandidateDoc,
} from '../src/signature'

const outline = (headings: Array<[number, string]>, certain = true): DocxOutline => ({
  headings: headings.map(([level, text], index) => ({ level, text, styled: certain, index })),
  tables: [],
  body: [],
  cover: [],
  tableCells: [],
  certain,
})

const ODA: Array<[number, string]> = [
  [1, 'Ⅰ. 제안사 소개'],
  [2, '1. 일반현황 및 연혁'],
  [3, '1-1. 회사 일반현황'],
  [3, '1-2. 인도네시아 보건 현황'],
  [1, 'Ⅱ. 기술 부문'],
  [2, '1. 사업이해도'],
  [3, '1-1. 제안의 특징 및 차별성'],
  [3, '1-2. 과업대상지 분석'],
  [1, 'Ⅲ. 사업관리 부문'],
  [2, '1. 투입인력 현황 및 운용계획'],
]

const doc = (id: string, o: DocxOutline, mtimeMs = 0): CandidateDoc => ({
  id,
  signature: outlineSignature(o),
  certain: o.certain,
  mtimeMs,
})

describe('signatures', () => {
  it('normalizeHeading drops numbering, scores and punctuation', () => {
    expect(normalizeHeading('Ⅱ-1. 사업이해도 (10점)')).toBe('사업이해도')
    expect(normalizeHeading('1-1. 회사 일반현황')).toBe('회사일반현황')
  })

  it('project words differ, same form', () => {
    const a = outline(ODA)
    const b = outline(ODA.map(([l, t]) => [l, t.replace('인도네시아 보건', '르완다 교육')]))
    expect(similarity(outlineSignature(a), outlineSignature(b))).toBeGreaterThanOrEqual(0.8)
    const groups = groupCandidates([doc('a', a), doc('b', b)], { minDocs: 2 })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.docs.map((d) => d.id).sort()).toEqual(['a', 'b'])
  })

  it('different forms stay apart', () => {
    const report = outline([
      [1, '1. 개요'],
      [1, '2. 추진 경과'],
      [1, '3. 결과'],
      [1, '4. 향후 계획'],
      [1, '5. 붙임'],
    ])
    const docs = [doc('oda', outline(ODA)), doc('report', report)]
    expect(groupCandidates(docs, { minDocs: 1 })).toHaveLength(2)
    expect(groupCandidates(docs, { minDocs: 2 })).toHaveLength(0)
  })

  it('groups sort newest first and the representative is docs[0]', () => {
    const groups = groupCandidates(
      [doc('old', outline(ODA), 1), doc('new', outline(ODA), 5), doc('mid', outline(ODA), 3)],
      { minDocs: 1 },
    )
    expect(groups[0]!.docs.map((d) => d.id)).toEqual(['new', 'mid', 'old'])
    expect(groups[0]!.signatureHash).toBe(signatureHash(groups[0]!.docs[0]!.signature))
  })

  it('a filled copy of a template has the template signature', () => {
    const form = outline(ODA)
    const filled = { ...outline(ODA), body: ['새 본문'], tableCells: ['값'] }
    expect(signatureHash(outlineSignature(filled))).toBe(signatureHash(outlineSignature(form)))
  })

  it('uncertain docs mark the group uncertain', () => {
    const groups = groupCandidates([doc('g', outline(ODA, false))], { minDocs: 1 })
    expect(groups[0]!.certain).toBe(false)
  })

  it('a document without headings is never a candidate', () => {
    expect(groupCandidates([doc('flat', outline([]))], { minDocs: 1 })).toEqual([])
  })
})
