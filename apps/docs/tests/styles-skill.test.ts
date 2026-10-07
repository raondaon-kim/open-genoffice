// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { DocxStyle } from '@genoffice/doc-styles'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createStylesSkill, styledBlockNodes } from '../src/renderer/ai/styles-skill'
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
  title: '시험 보고서',
  version: 1,
  draft: true,
  evidence: { documents: 5, note: '합성' },
  page: {
    paper: 'A4',
    orientation: 'portrait',
    marginMm: { left: 25, right: 25, top: 25, bottom: 25 },
    settable: true,
  },
  fonts: { latin: 'Calibri', eastAsian: '맑은 고딕' },
  roles: [
    role({ id: 'title', kind: 'title', size: 26, bold: true, align: 'center', spacingAfter: 12 }),
    role({
      id: 'heading-1',
      kind: 'heading',
      heading: 1,
      size: 16,
      bold: true,
      spacingBefore: 12,
      spacingAfter: 4,
      color: '#1F4FD8',
    }),
    role({ id: 'body', indentFirstLine: 10 }),
    role({ id: 'bullet', kind: 'list', bullet: 'bullet', indentLeft: 18, indentFirstLine: -18 }),
    role({ id: 'tight', spacingBefore: 0, spacingAfter: 0 }),
  ],
  skeleton: [
    { slot: 'title', role: 'title', required: true },
    { slot: 'body', roles: ['heading-1', 'body', 'bullet'], repeat: true },
  ],
} as unknown as DocxStyle

const liveEditors: Editor[] = []
function createEditor(content: PmNode[] = [{ type: 'docParagraph', attrs: { docxIndex: null } }]) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content },
  })
  liveEditors.push(editor)
  return editor
}
const para = (text: string): PmNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content: [{ type: 'text', text }],
})
afterEach(() => {
  for (const e of liveEditors.splice(0)) e.destroy()
})

const api = () => ({
  listDocStyles: vi.fn(async () => ({
    ok: true as const,
    styles: [{ id: 'docx-report', title: '시험 보고서', draft: true, evidence: style.evidence }],
    errors: [],
  })),
  readDocStyle: vi.fn(async (id: string) =>
    id === 'docx-report'
      ? { ok: true as const, style, description: '설명 본문' }
      : { ok: false as const, error: `no Word style "${id}"` },
  ),
})

const skillFor = (editor: Editor, track = false) =>
  createStylesSkill(
    () => editor,
    () => ({ bullet: null, ordered: null }),
    () => (track ? { author: 'AI' } : undefined),
    () => api(),
  )
const call = (name: string, input: Record<string, unknown> = {}) => ({ id: 'c1', name, input })
const write = (
  editor: Editor,
  blocks: unknown[],
  extra: Record<string, unknown> = {},
  track = false,
) =>
  skillFor(editor, track).executeTool(
    call('write_styled_document', { style: 'docx-report', blocks, ...extra }) as never,
  )
const texts = (editor: Editor) => {
  const out: string[] = []
  editor.state.doc.forEach((n) => out.push(n.textContent))
  return out
}

describe('styledBlockNodes', () => {
  it('puts the role formatting on the block and its text, including explicit zero spacing', () => {
    const r = (id: string) => style.roles.find((x) => x.id === id)!
    const [title, heading, tight, bullet] = styledBlockNodes(
      style,
      [
        { role: r('title'), text: '제목' },
        { role: r('heading-1'), text: '개요' },
        { role: r('tight'), text: '붙임' },
        { role: r('bullet'), text: '하나' },
      ],
      { bullet: '7', ordered: null },
    )
    expect(title!.attrs).toMatchObject({ align: 'center', spaceBefore: 0, spaceAfter: 240 })
    const titleStyle = title!.content![0]!.marks!.find((m) => m.type === 'docTextStyle')!
    expect(titleStyle.attrs).toMatchObject({
      sizeHalfPoints: 52,
      font: 'Calibri',
      eastAsiaFont: '맑은 고딕',
    })
    expect(title!.content![0]!.marks!.some((m) => m.type === 'bold')).toBe(true)
    expect(heading).toMatchObject({ type: 'docHeading', attrs: { level: 1 } })
    expect(
      heading!.content![0]!.marks!.find((m) => m.type === 'docTextStyle')!.attrs,
    ).toMatchObject({ color: '1F4FD8' })
    expect(tight!.attrs).toMatchObject({ spaceBefore: 0, spaceAfter: 0 })
    expect(bullet).toMatchObject({
      type: 'docListItem',
      attrs: { kind: 'bullet', numId: '7', indentLeft: 360, indentFirstLine: -360 },
    })
  })
})

describe('Word style wiki tools', () => {
  it('lists and reads styles', async () => {
    const editor = createEditor()
    const list = await skillFor(editor).executeTool(call('list_document_styles') as never)
    expect(JSON.parse(list.output).styles[0].id).toBe('docx-report')
    const read = await skillFor(editor).executeTool(
      call('read_document_style', { id: 'docx-report' }) as never,
    )
    expect(JSON.parse(read.output).roles).toHaveLength(5)
  })

  it('replaces a blank document with formatted blocks and reports the mutation', async () => {
    const editor = createEditor()
    const r = await write(editor, [
      { role: 'title', text: '보고서' },
      { role: 'body', text: '본문' },
    ])
    expect(r.isError).toBeFalsy()
    expect(r.mutated).toBe(true)
    expect(texts(editor)).toEqual(['보고서', '본문'])
    expect(editor.state.doc.child(0).attrs.align).toBe('center')
  })

  it('keeps blank lines as empty paragraphs instead of dropping them', async () => {
    const editor = createEditor()
    await write(editor, [
      { role: 'title', text: 'T' },
      { role: 'body', text: '' },
      { role: 'body', text: 'x' },
    ])
    expect(texts(editor)).toEqual(['T', '', 'x'])
    expect(editor.state.doc.child(1).attrs.indentFirstLine).toBe(200)
  })

  it('keeps text with backtick fences and repeated spaces as written', async () => {
    const editor = createEditor()
    await write(editor, [
      { role: 'title', text: 'a ``` b' },
      { role: 'body', text: 'mid  two  spaces' },
      { role: 'body', text: 'c ``` d' },
    ])
    expect(texts(editor)).toEqual(['a ``` b', 'mid  two  spaces', 'c ``` d'])
  })

  it('does not wipe a document whose only content has no text (a table, an image)', async () => {
    const editor = createEditor([
      para('keep'),
      { type: 'docParagraph', attrs: { docxIndex: null } },
    ])
    // two blocks: not a blank document, so the blocks go after the existing ones
    await write(editor, [{ role: 'title', text: 'new' }])
    expect(texts(editor)).toEqual(['keep', '', 'new'])
  })

  it('treats afterBlockIndex null as the end of the document', async () => {
    const editor = createEditor([para('a'), para('b'), para('c')])
    await write(editor, [{ role: 'body', text: 'z' }], { afterBlockIndex: null })
    expect(texts(editor)).toEqual(['a', 'b', 'c', 'z'])
  })

  it('inserts after the requested block', async () => {
    const editor = createEditor([para('a'), para('b')])
    await write(editor, [{ role: 'body', text: 'z' }], { afterBlockIndex: 0 })
    expect(texts(editor)).toEqual(['a', 'z', 'b'])
  })

  it('is one undo step: a single undo removes the text and its formatting', async () => {
    const editor = createEditor([para('hello')])
    await write(editor, [
      { role: 'title', text: 'T' },
      { role: 'body', text: 'x' },
    ])
    expect(texts(editor)).toEqual(['hello', 'T', 'x'])
    editor.commands.undo()
    expect(texts(editor)).toEqual(['hello'])
  })

  it('with track changes on, records insertions only, no format-change revisions', async () => {
    const editor = createEditor([para('hello')])
    await write(editor, [{ role: 'title', text: 'T' }], {}, true)
    const inserted = editor.state.doc.child(1)
    expect(inserted.attrs.pPrChange).toBeNull()
    const marks = inserted.child(0).marks.map((m) => m.type.name)
    expect(marks).toContain('ins')
    expect(marks).not.toContain('rprChange')
  })

  it('rejects an unknown role and changes nothing', async () => {
    const editor = createEditor([para('a')])
    const r = await write(editor, [{ role: 'nope', text: 'x' }])
    expect(r.isError).toBe(true)
    expect(r.mutated).toBe(false)
    expect(r.output).toMatch(/unknown role "nope"/)
    expect(texts(editor)).toEqual(['a'])
  })

  it('warns about a missing required part', async () => {
    const editor = createEditor()
    const r = await write(editor, [{ role: 'body', text: 'x' }])
    expect(r.output).toMatch(/missing required part "title"/)
  })
})
