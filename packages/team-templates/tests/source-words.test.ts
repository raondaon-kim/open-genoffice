import { describe, expect, it } from 'vitest'
import { sourceWordsHit } from '../src/source-words'

describe('sourceWordsHit', () => {
  const source = ['인도네시아 보건인력 관리체계 개선사업을 수행한다.', '자카르타 보건소 312개']

  it('finds a run of 8 or more characters taken from the source', () => {
    expect(sourceWordsHit(source, ['- 1-1. 개요 — 보건인력 관리체계 개선 방향'])).toBe(
      '- 1-1. 개요 — 보건인력 관리체계 개선 방향',
    )
  })

  it('ignores whitespace when comparing', () => {
    expect(sourceWordsHit(source, ['보건인력관리체계'])).toBe('보건인력관리체계')
  })

  it('lets shorter overlaps and unrelated lines pass', () => {
    expect(sourceWordsHit(source, ['1-1. 회사 일반현황', '보건소 312개 미만'])).toBeNull()
  })

  it('ignores leading numbering of a line', () => {
    expect(sourceWordsHit(['1-1. 회사 일반현황 개요'], ['1-1. 회사 일반현황 개요'], 20)).toBeNull()
  })
})

describe('sourceContentTexts', () => {
  it('drops table-of-contents lines that repeat a heading', async () => {
    const { sourceContentTexts } = await import('../src/source-words')
    const texts = sourceContentTexts({
      headings: [{ level: 2, text: '2. 조직 및 인원 현황, 주요사업내용', styled: true, index: 9 }],
      tables: [],
      body: ['2. 조직 및 인원 현황, 주요사업내용', '조직은 3개 팀으로 운영된다.'],
      cover: ['인도네시아 보건 사업'],
      tableCells: ['312개'],
      certain: true,
    })
    expect(texts).toEqual(['조직은 3개 팀으로 운영된다.', '인도네시아 보건 사업', '312개'])
  })
})

describe('sourceWordsHit with allowed form text', () => {
  it('runs that also occur in headings or table headers do not count', () => {
    const source = ['주요 사업 추진현황(유사사업 수행실적)은 다음과 같다.']
    const candidate = ['- 2-2. 주요 사업 추진현황(유사사업 수행실적) — 표로 정리']
    expect(sourceWordsHit(source, candidate)).toBe(candidate[0])
    expect(
      sourceWordsHit(source, candidate, 8, ['2-2. 주요 사업 추진현황(유사사업 수행실적)']),
    ).toBeNull()
  })
})
