// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  BLANK_BULLET_NUM_ID,
  BLANK_ORDERED_NUM_ID,
  buildBlankDocx,
  parseDocx,
  saveDocx,
} from '@genoffice/docx-engine'
import { aiTableLayout } from '../src/renderer/ai/table-widths'
import { parseHtmlFragment } from '../src/renderer/ai/protocol'
import { executeTool } from '../src/renderer/ai/tools'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'

const NUM_IDS = { bullet: BLANK_BULLET_NUM_ID, ordered: BLANK_ORDERED_NUM_ID }
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

const tableHtml = (rows: string[][]) =>
  '<table>' +
  rows
    .map(
      (r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`,
    )
    .join('') +
  '</table>'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * One-line width of a bold header label in em, measured in the app (Calibri/Malgun Gothic bold
 * at 11 pt: "1월" 25.8 px, "10월" 33.2 px of a 14.67 px em). Independent of the module's estimate.
 */
const boldLabelEm = (label: string) => (label.length === 2 ? 25.8 : 33.2) / 14.67

describe('layout of an AI-written table', () => {
  it('writes a schedule too wide for 11 pt in 9 pt, every month header on one line', () => {
    const { colWidthsPct: pct, sizeHalfPoints } = aiTableLayout(GANTT, true)
    expect(sizeHalfPoints).toBe(18)
    expect(pct).toHaveLength(14)
    expect(sum(pct)).toBeCloseTo(100, 1)
    // 9 pt = 180 twips per em; Word's cell margins 108 twips a side; 6.5 in = 9360 twips
    MONTHS.forEach((label, i) => {
      const needTwips = boldLabelEm(label) * 180 + 216
      expect(pct[i + 1], label).toBeGreaterThanOrEqual((needTwips / 9360) * 100)
    })
    // the task column keeps room for its words instead of an equal 1/14 share
    expect(pct[0]).toBeGreaterThan(2 * Math.max(...pct.slice(1)))
  })

  it('keeps the body size and the equal split when every column fits its equal share', () => {
    const { colWidthsPct, sizeHalfPoints } = aiTableLayout(
      [
        ['Metric', 'Value', 'Change'],
        ['Revenue', '100', '+5%'],
      ],
      true,
    )
    expect(sizeHalfPoints).toBeNull()
    for (const p of colWidthsPct) expect(p).toBeCloseTo(100 / 3, 1)
  })

  it('gives a long description column the room a short number column does not need', () => {
    const { colWidthsPct: pct, sizeHalfPoints } = aiTableLayout(
      [
        ['번호', '항목', '세부 내용'],
        [
          '1',
          '사업 개요',
          '사업의 배경과 목적, 추진 경위, 기대 효과를 종합적으로 정리하여 제시한다',
        ],
        ['2', '추진 체계', '발주처와 수행사, 자문단의 역할과 협업 절차, 보고 일정을 명확히 한다'],
      ],
      true,
    )
    expect(sizeHalfPoints).toBeNull()
    expect(sum(pct)).toBeCloseTo(100, 1)
    expect(pct[2]).toBeGreaterThan(pct[1])
    expect(pct[1]).toBeGreaterThan(pct[0])
    expect(pct[0]).toBeLessThan(15)
  })

  it('handles ragged rows and empty tables without NaN', () => {
    expect(aiTableLayout([['a', 'b'], ['c']], false).colWidthsPct).toHaveLength(2)
    const empty = aiTableLayout([['', '', '']], false)
    for (const p of empty.colWidthsPct) expect(p).toBeCloseTo(100 / 3, 1)
    expect(empty.sizeHalfPoints).toBeNull()
  })

  it('reaches the Word table the AI inserts: widths and 9 pt runs', () => {
    const [table] = parseHtmlFragment(tableHtml(GANTT), NUM_IDS)
    const pct = table.attrs?.colWidthsPct as number[]
    expect(pct).toHaveLength(14)
    expect(pct[0]).toBeGreaterThan(2 * pct[1])
    const sizes = new Set<number>()
    const visit = (n: PmNode) => {
      for (const m of n.marks ?? [])
        if (m.attrs?.sizeHalfPoints) sizes.add(Number(m.attrs.sizeHalfPoints))
      for (const c of n.content ?? []) visit(c)
    }
    visit(table)
    expect([...sizes]).toEqual([18])

    const [small] = parseHtmlFragment(
      tableHtml([
        ['A', 'B'],
        ['1', '2'],
      ]),
      NUM_IDS,
    )
    const smallSizes = new Set<number>()
    const visitSmall = (n: PmNode) => {
      for (const m of n.marks ?? [])
        if (m.attrs?.sizeHalfPoints) smallSizes.add(Number(m.attrs.sizeHalfPoints))
      for (const c of n.content ?? []) visitSmall(c)
    }
    visitSmall(small)
    expect(smallSizes.size).toBe(0)
  })

  it('saves the 9 pt schedule and its column grid into the .docx', async () => {
    const { editorExtensions } = await import('../src/renderer/editor/extensions')
    const parsed = await parseDocx(await buildBlankDocx())
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
    })
    editor.commands.setContent(blocksToPmDoc(parsed.blocks) as never)
    const exec = await executeTool(
      editor,
      { id: 't', name: 'insert_content', input: { html: tableHtml(GANTT) } },
      NUM_IDS,
    )
    expect(exec.isError).toBeFalsy()
    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    const saved = await saveDocx(parsed, plan.saveBlocks)
    editor.destroy()
    const reparsed = await parseDocx(saved)
    const model = reparsed.blocks.find((b) => b.type === 'table')!.table!
    const firstRun = (r: number, c: number) => model.rows[r][c].richParas?.[0]?.runs[0]
    expect(firstRun(0, 1)?.text).toBe('1월')
    expect(firstRun(0, 1)?.sizeHalfPoints).toBe(18)
    expect(firstRun(1, 0)?.sizeHalfPoints).toBe(18)
    const pct = model.colWidthsPct!
    expect(pct[0]).toBeGreaterThan(2 * pct[1])
  })
})
