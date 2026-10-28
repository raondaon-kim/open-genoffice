// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { DocxStyle } from '@genoffice/doc-styles'
import type { TemplateForRun } from '@genoffice/report-writer'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createTemplateLander } from '../src/renderer/ai/report/template-lander'
import { parseHtmlFragment } from '../src/renderer/ai/protocol'
import type { PmNode } from '../src/renderer/editor/convert'

const role = (over: Record<string, unknown>) => ({
  label: 'x',
  kind: 'body',
  size: 11,
  bold: false,
  align: 'left',
  spacingBefore: 0,
  spacingAfter: 8,
  lineSpacing: 1.15,
  indentLeft: 0,
  indentFirstLine: 0,
  ...over,
})
const style = {
  format: 'docx',
  id: 'team-x',
  title: '팀',
  version: 1,
  evidence: { documents: 1, note: 'n' },
  page: {
    paper: 'A4',
    orientation: 'portrait',
    marginMm: { left: 25, right: 25, top: 20, bottom: 15 },
    settable: true,
  },
  fonts: {},
  roles: [
    role({ id: 'heading-1', kind: 'heading', heading: 1, size: 16, bold: true }),
    role({ id: 'body', size: 13 }),
    role({ id: 'bullet', kind: 'list', bullet: 'bullet' }),
  ],
  skeleton: [],
} as unknown as DocxStyle

const NUM = { bullet: null, ordered: null }
const para = (text = ''): PmNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  ...(text ? { content: [{ type: 'text', text }] } : {}),
})
const heading = (level: number, text: string): PmNode => ({
  type: 'docHeading',
  attrs: { docxIndex: null, level },
  content: [{ type: 'text', text }],
})

const TEMPLATE: TemplateForRun = {
  title: '팀 템플릿',
  purpose: '',
  sections: [
    { index: 0, path: [], heading: 'Ⅰ. 소개', level: 1, guidance: '도입문' },
    { index: 1, path: ['Ⅰ. 소개'], heading: '1. 개요', level: 2, guidance: '' },
    { index: 2, path: ['Ⅰ. 소개'], heading: '2. 계획', level: 2, guidance: '' },
  ],
  coverLabels: ['사업명', '발주기관'],
  wikiPages: [],
  styleRules: '',
}

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})
function formEditor(extra: PmNode[] = []) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        para('[사업명]'),
        para('[발주기관]'),
        heading(1, 'Ⅰ. 소개'),
        para(),
        heading(2, '1. 개요'),
        para(),
        heading(2, '2. 계획'),
        para(),
        ...extra,
      ],
    },
  })
  editors.push(editor)
  return editor
}
const blocks = (editor: Editor): Array<[string, string]> => {
  const out: Array<[string, string]> = []
  editor.state.doc.forEach((n) => out.push([n.type.name, n.textContent]))
  return out
}
const lander = (editor: Editor) =>
  createTemplateLander({
    editor: () => editor,
    style,
    numIds: () => NUM,
    runId: 'r',
    template: TEMPLATE,
  })

describe('template lander', () => {
  it('writes a section into its slot under its heading', async () => {
    const editor = formEditor()
    await lander(editor).section(1, [
      { type: 'paragraph', text: '개요 본문' },
      { type: 'bullet', text: '항목' },
    ])
    const b = blocks(editor)
    const at = b.findIndex(([, t]) => t === '1. 개요')
    expect(b[at + 1]).toEqual(['docParagraph', '개요 본문'])
    expect(b[at + 2]).toEqual(['docListItem', '항목'])
    expect(b[at + 3]).toEqual(['docHeading', '2. 계획'])
    // the other slots are untouched
    expect(b[b.findIndex(([, t]) => t === '2. 계획') + 1]).toEqual(['docParagraph', ''])
  })

  it('fills cover placeholders and leaves unknown ones', async () => {
    const editor = formEditor()
    await lander(editor).cover({ 사업명: '르완다 PMC' })
    expect(blocks(editor).slice(0, 2)).toEqual([
      ['docParagraph', '르완다 PMC'],
      ['docParagraph', '[발주기관]'],
    ])
  })

  it('a failed section says so in its slot', async () => {
    const editor = formEditor()
    await lander(editor).sectionFailed(2, '2. 계획')
    const b = blocks(editor)
    expect(b[b.findIndex(([, t]) => t === '2. 계획') + 1]![1]).toBe(
      '이 절을 쓰지 못했습니다: 2. 계획',
    )
  })

  it("a section's table replaces the form's empty table", async () => {
    const empty = parseHtmlFragment(
      '<table><tr><th>구분</th><th>내용</th></tr><tr><td></td><td></td></tr></table>',
      NUM,
    )
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [heading(1, 'Ⅰ. 소개'), para(), ...empty, heading(2, '1. 개요'), para()],
      },
    })
    editors.push(editor)
    await lander(editor).section(0, [
      {
        type: 'table',
        rows: [
          ['구분', '내용'],
          ['A', '가'],
        ],
      },
    ])
    const tables = blocks(editor).filter(([type]) => /table/i.test(type))
    expect(tables).toHaveLength(1)
    expect(tables[0]![1]).toContain('A')
  })

  it('finish drops slots that stayed empty; gaps go to the end', async () => {
    const editor = formEditor()
    const l = lander(editor)
    await l.section(1, [{ type: 'paragraph', text: '개요 본문' }])
    await l.gaps([{ type: 'paragraph', text: '확인 필요 사항 표' }])
    await l.finish()
    const b = blocks(editor)
    expect(b.filter(([type, t]) => type === 'docParagraph' && t === '')).toHaveLength(0)
    expect(b.at(-1)).toEqual(['docParagraph', '확인 필요 사항 표'])
  })
})

describe('template lander fills the form table', () => {
  const formTable = () =>
    parseHtmlFragment(
      '<table><tr><th>구분</th><th>내용</th></tr><tr><td></td><td></td></tr></table>',
      NUM,
    )
  const editorWith = (content: PmNode[]) => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: { type: 'doc', content },
    })
    editors.push(editor)
    return editor
  }
  const tableRowsOf = (editor: Editor) => {
    const out: string[][] = []
    editor.state.doc.forEach((n) => {
      if (!/table/i.test(n.type.name)) return
      n.forEach((row) => {
        const cells: string[] = []
        row.forEach((cell) => void cells.push(cell.textContent))
        out.push(cells)
      })
    })
    return out
  }

  it('same number of columns: the form table keeps its header and gets the rows', async () => {
    const editor = editorWith([
      heading(1, 'Ⅰ. 소개'),
      para(),
      ...formTable(),
      heading(2, '1. 개요'),
      para(),
    ])
    await lander(editor).section(0, [
      { type: 'paragraph', text: '표 앞 문장' },
      {
        type: 'table',
        rows: [
          ['항목', '설명'],
          ['A', '가'],
          ['B', '나'],
        ],
      },
    ])
    expect(tableRowsOf(editor)).toEqual([
      ['구분', '내용'],
      ['A', '가'],
      ['B', '나'],
    ])
    expect(blocks(editor).filter(([t]) => /table/i.test(t))).toHaveLength(1)
  })

  it('a different number of columns: the written table replaces the form table', async () => {
    const editor = editorWith([
      heading(1, 'Ⅰ. 소개'),
      para(),
      ...formTable(),
      heading(2, '1. 개요'),
      para(),
    ])
    await lander(editor).section(0, [
      {
        type: 'table',
        rows: [
          ['a', 'b', 'c'],
          ['1', '2', '3'],
        ],
      },
    ])
    expect(tableRowsOf(editor)).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })
})
