import { describe, expect, it } from 'vitest'
import { readDocxOutline } from '../src/docx-outline'
import { makeDocx, ODA_BLOCKS } from './fixtures'

describe('readDocxOutline', () => {
  it('reads styled headings', async () => {
    const o = await readDocxOutline(
      await makeDocx([
        { text: 'Ⅰ. 제안사 소개', style: 'Heading1' },
        { text: '1. 일반현황', style: 'Heading2' },
        { text: '1-1. 회사 일반현황', style: 'Heading3' },
        { text: '첫 문단' },
        { text: '둘째 문단' },
      ]),
    )
    expect(o.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Ⅰ. 제안사 소개'],
      [2, '1. 일반현황'],
      [3, '1-1. 회사 일반현황'],
    ])
    expect(o.certain).toBe(true)
    expect(o.body).toEqual(['첫 문단', '둘째 문단'])
  })

  it('cover is what precedes the first heading', async () => {
    const o = await readDocxOutline(await makeDocx(ODA_BLOCKS))
    expect(o.cover).toEqual([
      '인도네시아 보건인력 관리체계 개선사업 PMC 용역',
      '발주기관 : 한국국제협력단(KOICA) 동남아시아2팀',
    ])
  })

  it('tables report header and body cells', async () => {
    const o = await readDocxOutline(
      await makeDocx([
        { text: 'Ⅰ. 표', style: 'Heading1' },
        {
          table: [
            ['a', 'b', 'c'],
            ['1', '2', '3'],
            ['4', '5', '6'],
          ],
        },
      ]),
    )
    expect(o.tables).toHaveLength(1)
    expect(o.tables[0]!.header).toEqual(['a', 'b', 'c'])
    expect(o.tables[0]!.rows).toBe(3)
    expect(o.tableCells).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('guesses headings without styles', async () => {
    const o = await readDocxOutline(
      await makeDocx([
        { text: 'Ⅰ. 개요', bold: true, size: 32 },
        { text: '1. 배경', bold: true, size: 28 },
        { text: '1. 이 문장은 번호로 시작하지만 본문이다' },
        { text: '본문 문단' },
      ]),
    )
    expect(o.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Ⅰ. 개요'],
      [2, '1. 배경'],
    ])
    expect(o.headings.every((h) => !h.styled)).toBe(true)
    expect(o.certain).toBe(false)
  })

  it('outline level in paragraph properties counts as heading', async () => {
    const o = await readDocxOutline(
      await makeDocx([{ text: '사업 개요', outline: 1 }, { text: '본문' }]),
    )
    expect(o.headings).toEqual([{ level: 2, text: '사업 개요', styled: true, index: 0 }])
  })
})
