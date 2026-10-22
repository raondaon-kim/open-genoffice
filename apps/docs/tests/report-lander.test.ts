// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { DocxStyle } from '@genoffice/doc-styles'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createDocsLander } from '../src/renderer/ai/report/docs-lander'
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
  id: 'docx-report',
  title: '보고서',
  version: 1,
  evidence: { documents: 1, note: 'n' },
  page: {
    paper: 'A4',
    orientation: 'portrait',
    marginMm: { left: 25, right: 25, top: 25, bottom: 25 },
    settable: true,
  },
  fonts: {},
  roles: [
    role({ id: 'title', kind: 'title', size: 26 }),
    role({ id: 'heading-1', kind: 'heading', heading: 1, size: 14, bold: true }),
    role({ id: 'heading-2', kind: 'heading', heading: 2, size: 12, bold: true }),
    role({ id: 'body' }),
    role({ id: 'list', kind: 'list', bullet: 'bullet' }),
  ],
  skeleton: [],
} as unknown as DocxStyle

const editors: Editor[] = []
const para = (text: string): PmNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content: [{ type: 'text', text }],
})
function createEditor(content: PmNode[] = [{ type: 'docParagraph', attrs: { docxIndex: null } }]) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content },
  })
  editors.push(editor)
  return editor
}
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

const blocks = (editor: Editor): Array<[string, string]> => {
  const out: Array<[string, string]> = []
  editor.state.doc.forEach((n) => out.push([n.type.name, n.textContent]))
  return out
}
const texts = (editor: Editor) => blocks(editor).map((b) => b[1])
const skeleton = {
  title: '보고서 제목',
  withSummary: true,
  chapters: [
    { no: 1, title: '원칙', sections: ['1.1 범위'] },
    { no: 2, title: '규제', sections: [] },
    { no: 3, title: '로드맵', sections: [] },
  ],
}
const lander = (editor: Editor) =>
  createDocsLander({
    editor: () => editor,
    style,
    numIds: () => ({ bullet: null, ordered: null }),
    runId: 'r1',
  })

describe('docs lander', () => {
  it('lands the title, TOC and one placeholder per chapter into a blank document', async () => {
    const editor = createEditor()
    await lander(editor).skeleton(skeleton)
    const t = texts(editor)
    expect(t[0]).toBe('보고서 제목')
    expect(t).toContain('목차')
    expect(t).toContain('2. 규제')
    expect(t).toContain('1.1 범위')
    expect(t.filter((x) => x.includes('쓰는 중'))).toHaveLength(5) // summary, 3 chapters, gaps
    expect(blocks(editor)[0]![0]).toBe('docParagraph')
  })

  it("replaces chapter 2's placeholder with heading, body, list and table nodes", async () => {
    const editor = createEditor()
    const l = lander(editor)
    await l.skeleton(skeleton)
    await l.chapter(2, [
      { type: 'chapter', text: '2. 규제' },
      { type: 'paragraph', text: '첫 문장이 결론이다.' },
      { type: 'bullet', text: '데이터 보호' },
      {
        type: 'table',
        rows: [
          ['단계', '내용'],
          ['1', '데이터'],
        ],
      },
    ])
    const b = blocks(editor)
    const at = b.findIndex(([, x]) => x === '첫 문장이 결론이다.')
    expect(b[at - 1]).toEqual(['docHeading', '2. 규제'])
    expect(b[at + 1]![0]).toBe('docListItem')
    expect(b[at + 2]![0]).toMatch(/table/i)
    expect(texts(editor).some((x) => x.includes('2. 규제 — 쓰는 중'))).toBe(false)
    expect(texts(editor).some((x) => x.includes('1. 원칙 — 쓰는 중'))).toBe(true)
  })

  it('finds the placeholder after blocks were inserted above it', async () => {
    const editor = createEditor()
    const l = lander(editor)
    await l.skeleton(skeleton)
    editor.commands.insertContentAt(0, para('사용자가 넣은 문단'))
    await l.chapter(1, [{ type: 'paragraph', text: '1장 본문' }])
    const t = texts(editor)
    expect(t[0]).toBe('사용자가 넣은 문단')
    expect(t.indexOf('1장 본문')).toBeGreaterThan(t.indexOf('목차'))
    expect(t.indexOf('1장 본문')).toBeLessThan(t.findIndex((x) => x.includes('2. 규제 — 쓰는 중')))
  })

  it('appends after the last block in a non-blank document and keeps the existing blocks', async () => {
    const editor = createEditor([para('기존 문단')])
    await lander(editor).skeleton(skeleton)
    const t = texts(editor)
    expect(t[0]).toBe('기존 문단')
    expect(t[1]).toBe('보고서 제목')
  })

  it('abandon removes the placeholders still open and keeps landed chapters', async () => {
    const editor = createEditor()
    const l = lander(editor)
    await l.skeleton(skeleton)
    await l.chapter(1, [{ type: 'paragraph', text: '1장 본문' }])
    await l.abandon()
    const t = texts(editor)
    expect(t).toContain('1장 본문')
    expect(t.some((x) => x.includes('쓰는 중'))).toBe(false)
  })

  it('a failed chapter shows its failure line; empty summary and gaps remove their placeholders', async () => {
    const editor = createEditor()
    const l = lander(editor)
    await l.skeleton(skeleton)
    await l.chapterFailed(3, '로드맵')
    await l.summary([])
    await l.gaps([])
    const t = texts(editor)
    expect(t).toContain('이 장을 쓰지 못했습니다: 3. 로드맵')
    expect(t.some((x) => x.includes('요약 — 쓰는 중'))).toBe(false)
    expect(t.some((x) => x.includes('확인 필요 사항 — 쓰는 중'))).toBe(false)
  })
})
