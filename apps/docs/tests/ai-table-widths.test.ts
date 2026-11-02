// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { contentColumnPcts } from '../src/renderer/ai/table-widths'
import { parseHtmlFragment } from '../src/renderer/ai/protocol'

const NUM_IDS = { bullet: null, ordered: null }
const MONTHS = Array.from({ length: 13 }, (_, i) => `${i + 1}월`)

/** a project schedule as the report writer produces it: task names, then one column per month */
const GANTT: string[][] = [
  ['세부 과업', ...MONTHS],
  ['착수보고회 개최 및 과업 범위 확정', '●', ...Array(12).fill('')],
  ['현황 조사 및 기초자료 분석', '●', '●', '●', ...Array(10).fill('')],
  ['생태공원 기본구상 및 공간계획 수립', '', '', '●', '●', '●', ...Array(8).fill('')],
  ['중간보고회 및 주민설명회', ...Array(6).fill(''), '●', ...Array(6).fill('')],
  ['최종보고서 작성 및 납품', ...Array(11).fill(''), '●', '●'],
]

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('column widths of an AI-written table', () => {
  it('give a wide schedule its task column instead of an equal 1/14 share', () => {
    const pct = contentColumnPcts(GANTT)
    expect(pct).toHaveLength(14)
    expect(sum(pct)).toBeCloseTo(100, 1)
    // month columns stay narrow ("10월" is a little wider than "1월")
    const month = Math.max(...pct.slice(1))
    expect(month).toBeLessThan(8)
    // the task column holds its longest word with room, not one syllable per line
    expect(pct[0]).toBeGreaterThan(2 * month)
  })

  it('never squeeze a month header below one line at 11 pt (the blank document body size)', () => {
    // estimate independent of the module: Hangul 1 em, digit 0.55 em, Word's default cell
    // margins 108 twips a side, a 6.5 in text column = 9360 twips, all at 11 pt = 220 twips/em
    const tableEm = 9360 / 220
    const padEm = 216 / 220
    const pct = contentColumnPcts(GANTT)
    MONTHS.forEach((label, i) => {
      const needEm = (label.length - 1) * 0.55 + 1 + padEm
      expect(pct[i + 1], label).toBeGreaterThanOrEqual((needEm / tableEm) * 100)
    })
  })

  it('keep the equal split when every column already fits its equal share', () => {
    const pct = contentColumnPcts([
      ['Metric', 'Value', 'Change'],
      ['Revenue', '100', '+5%'],
    ])
    for (const p of pct) expect(p).toBeCloseTo(100 / 3, 1)
  })

  it('give a long description column the room a short number column does not need', () => {
    const pct = contentColumnPcts([
      ['번호', '항목', '세부 내용'],
      ['1', '사업 개요', '사업의 배경과 목적, 추진 경위, 기대 효과를 종합적으로 정리하여 제시한다'],
      ['2', '추진 체계', '발주처와 수행사, 자문단의 역할과 협업 절차, 보고 일정을 명확히 한다'],
    ])
    expect(sum(pct)).toBeCloseTo(100, 1)
    expect(pct[2]).toBeGreaterThan(pct[1])
    expect(pct[1]).toBeGreaterThan(pct[0])
    expect(pct[0]).toBeLessThan(15)
  })

  it('handle ragged rows and empty tables without NaN', () => {
    expect(contentColumnPcts([['a', 'b'], ['c']])).toHaveLength(2)
    const empty = contentColumnPcts([['', '', '']])
    for (const p of empty) expect(p).toBeCloseTo(100 / 3, 1)
  })

  it('reach the Word table the AI inserts', () => {
    const html =
      '<table>' +
      GANTT.map(
        (r, i) =>
          `<tr>${r.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`,
      ).join('') +
      '</table>'
    const [table] = parseHtmlFragment(html, NUM_IDS)
    const pct = table.attrs?.colWidthsPct as number[]
    expect(pct).toHaveLength(14)
    expect(pct[0]).toBeGreaterThan(2 * pct[1])
  })
})
