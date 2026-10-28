// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { parseDocx } from '@genoffice/docx-engine'
import {
  buildFormDocx,
  measureDocxStyle,
  readDocxOutline,
  renderTemplateMd,
  type TemplateDef,
} from '@genoffice/team-templates'
import { blocksToPmDoc } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createTemplateLander } from '../src/renderer/ai/report/template-lander'
import { templateRunFor } from '../src/renderer/ai/report/team-template-skill'
import { makeDocx, type FxBlock } from '../../../packages/team-templates/tests/fixtures'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

/** a real form.docx through docx-engine into the editor, and the md the shell would store */
async function setup(blocks: FxBlock[], mdHeadings?: string[]) {
  const source = await makeDocx(blocks)
  const form = await buildFormDocx(source, { coverLabels: ['사업명'] })
  const outline = await readDocxOutline(form)
  const def: TemplateDef = {
    title: '팀 템플릿',
    kind: 'Word',
    purpose: '',
    confirmedAt: '2026-10-28',
    author: '공용',
    documents: 1,
    signatures: [],
    formSha256: 'a'.repeat(64),
    materials: [],
    wikiPages: [],
    outline: (mdHeadings ?? outline.headings.map((h) => h.text)).map((heading, i) => ({
      level: outline.headings[i]?.level ?? 1,
      heading,
      guidance: '',
    })),
    notes: '',
    style: await measureDocxStyle(source, { id: 'team-x', title: 't', documents: 1 }),
  }
  const parsed = await parseDocx(form)
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
  })
  editor.commands.setContent(blocksToPmDoc(parsed.blocks) as never)
  editors.push(editor)
  const got = (await templateRunFor(
    { templateFor: async () => renderTemplateMd(def) },
    'x.docx',
    editor,
  ))!
  const lander = createTemplateLander({
    editor: () => editor,
    style: got.style,
    numIds: () => ({ bullet: null, ordered: null }),
    runId: 'e2e',
    template: got.run,
  })
  return { editor, got, lander }
}

const texts = (editor: Editor) => {
  const out: string[] = []
  editor.state.doc.forEach((n) => {
    out.push(n.textContent)
  })
  return out
}

const GUESSED: FxBlock[] = [
  { text: '인도네시아 보건 사업' },
  { text: 'Ⅰ. 개요', bold: true, size: 32 },
  { text: '개요 본문' },
  { text: '1. 배경', bold: true, size: 28 },
  { text: '배경 본문' },
  { text: '2. 목표', bold: true, size: 28 },
  { text: '목표 본문' },
]

describe('template fill through a real form.docx', () => {
  it('styled headings: each section lands under its own heading', async () => {
    const { editor, got, lander } = await setup([
      { text: '인도네시아 보건 사업', style: 'Title' },
      { text: 'Ⅰ. 개요', style: 'Heading1' },
      { text: '개요 본문' },
      { text: '1. 배경', style: 'Heading2' },
      { text: '배경 본문' },
      { text: '2. 목표', style: 'Heading2' },
      { text: '목표 본문' },
    ])
    expect(got.run.problem).toBeUndefined()
    expect(got.run.filled).toBe(false)
    await lander.section(2, [{ type: 'paragraph', text: '새 목표' }])
    await lander.section(1, [{ type: 'paragraph', text: '새 배경' }])
    const t = texts(editor)
    expect(t.indexOf('새 배경')).toBe(t.indexOf('1. 배경') + 1)
    expect(t.indexOf('새 목표')).toBe(t.indexOf('2. 목표') + 1)
  })

  it('guessed headings (bold text, no heading styles) are found too', async () => {
    const { editor, got, lander } = await setup(GUESSED)
    expect(got.run.problem).toBeUndefined()
    await lander.section(1, [{ type: 'paragraph', text: '새 배경' }])
    const t = texts(editor)
    expect(t.indexOf('새 배경')).toBe(t.indexOf('1. 배경') + 1)
  })

  it('a filled copy is recognized as filled', async () => {
    const { editor, lander } = await setup(GUESSED)
    for (const i of [0, 1, 2]) await lander.section(i, [{ type: 'paragraph', text: `본문 ${i}` }])
    await lander.finish()
    const again = (await templateRunFor(
      {
        templateFor: async () =>
          (await setup(GUESSED)).got.run && renderTemplateMd(await defOf(GUESSED)),
      },
      'x.docx',
      editor,
    ))!
    expect(again.run.filled).toBe(true)
  })

  it('an outline the form does not have names its first missing heading', async () => {
    const { got } = await setup(GUESSED, ['Ⅰ. 개요', '1. 배경', '2. 다른 제목'])
    expect(got.run.problem).toBe('2. 다른 제목')
  })
})

async function defOf(blocks: FxBlock[]): Promise<TemplateDef> {
  const source = await makeDocx(blocks)
  const outline = await readDocxOutline(await buildFormDocx(source))
  return {
    title: '팀 템플릿',
    kind: 'Word',
    purpose: '',
    confirmedAt: '2026-10-28',
    author: '공용',
    documents: 1,
    signatures: [],
    formSha256: 'a'.repeat(64),
    materials: [],
    wikiPages: [],
    outline: outline.headings.map((h) => ({ level: h.level, heading: h.text, guidance: '' })),
    notes: '',
    style: await measureDocxStyle(source, { id: 'team-x', title: 't', documents: 1 }),
  }
}
