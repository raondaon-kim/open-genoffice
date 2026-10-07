import { describe, expect, it } from 'vitest'
import {
  bodyFontSizeOf,
  findTinyWritten,
  isSpacerLine,
  SPACER_RATIO,
} from '../src/renderer/ai/paragraph-size'

const p = (
  paragraph: number,
  preview: string,
  fontSize: number | undefined,
  over: Partial<{ length: number; empty: boolean }> = {},
) => ({
  section: 0,
  paragraph,
  preview,
  length: over.length ?? preview.length,
  empty: over.empty ?? preview === '',
  hasTable: false,
  ...(fontSize === undefined ? {} : { fontSize }),
})

describe('bodyFontSizeOf', () => {
  it('is the most common size among paragraphs that hold text (larger wins a tie)', () => {
    expect(bodyFontSizeOf([p(0, 'a', 13), p(1, 'b', 13), p(2, 'c', 28), p(3, '', 6)])).toBe(13)
    expect(bodyFontSizeOf([p(0, 'a', 13), p(1, 'b', 15)])).toBe(15)
  })

  it('is undefined when no paragraph with text has a size', () => {
    expect(bodyFontSizeOf([p(0, '', 6), p(1, 'x', undefined)])).toBeUndefined()
  })
})

describe('isSpacerLine', () => {
  it('is a blank paragraph far below the body size', () => {
    expect(SPACER_RATIO).toBe(0.75)
    expect(isSpacerLine(p(0, '', 6), 13)).toBe(true)
    expect(isSpacerLine(p(0, '', 7), 13)).toBe(true)
    expect(isSpacerLine(p(0, '', 12), 13)).toBe(false)
    expect(isSpacerLine(p(0, 'text', 6), 13)).toBe(false)
    expect(isSpacerLine(p(0, '', 6), undefined)).toBe(false)
  })
})

describe('findTinyWritten', () => {
  const doc = [
    p(0, '1. 관련', 13),
    p(1, '가. 근거 문서', 6),
    p(2, '나. 다른 근거', 13),
    p(3, '문의: 02-0000-0000', 8),
    p(4, '', 12),
  ]

  it('finds just-written paragraphs that came out far smaller than the body text', () => {
    expect(findTinyWritten(doc, ['가. 근거 문서'])).toEqual([
      { section: 0, paragraph: 1, length: 8, fontSize: 6, bodyFontSize: 13 },
    ])
  })

  it('ignores written text at body size and small text the edit did not write', () => {
    expect(findTinyWritten(doc, ['나. 다른 근거'])).toEqual([])
    // the 8 pt contact line was already small in the form and this edit did not write it
    expect(findTinyWritten(doc, ['가. 근거 문서'])).toHaveLength(1)
  })

  it('matches long text through the engine-cut preview and ignores surrounding blanks', () => {
    const long =
      '다. 교육 장소: 서울특별시 인재개발원 대강당 및 강의실(서울특별시 서초구 남부순환로 2406)'
    const cut = `${long.slice(0, 40)}...`
    const found = findTinyWritten(
      [p(0, '1. 본문', 13), p(1, cut, 7, { length: long.length })],
      [`  ${long}  `],
    )
    expect(found).toEqual([
      { section: 0, paragraph: 1, length: long.length, fontSize: 7, bodyFontSize: 13 },
    ])
  })

  it('finds nothing without a body size or without written text', () => {
    expect(findTinyWritten([p(0, '', 6)], ['x'])).toEqual([])
    expect(findTinyWritten(doc, [])).toEqual([])
    expect(findTinyWritten(doc, ['   '])).toEqual([])
  })
})
