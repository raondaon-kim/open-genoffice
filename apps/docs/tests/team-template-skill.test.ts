// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { measureDocxStyle, renderTemplateMd, type TemplateDef } from '@genoffice/team-templates'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  coverLabelsOf,
  createTeamTemplatesSkill,
  templateRunFor,
} from '../src/renderer/ai/report/team-template-skill'
import { makeDocx, ODA_BLOCKS } from '../../../packages/team-templates/tests/fixtures'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})
function formEditor() {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: '[사업명]' }],
        },
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: '평범한 문장' }],
        },
        {
          type: 'docHeading',
          attrs: { docxIndex: null, level: 1 },
          content: [{ type: 'text', text: 'Ⅰ. 소개' }],
        },
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: '[본문 자리 아님]' }],
        },
      ],
    },
  })
  editors.push(editor)
  return editor
}

async function md(): Promise<string> {
  const def: TemplateDef = {
    title: 'KOICA ODA 기술제안서',
    kind: 'Word',
    purpose: '용역 제안서',
    confirmedAt: '2026-10-28',
    author: '공용',
    documents: 1,
    signatures: ['0123456789abcdef'],
    formSha256: 'b'.repeat(64),
    materials: [],
    wikiPages: [],
    outline: [{ level: 1, heading: 'Ⅰ. 소개', guidance: '도입문' }],
    notes: '',
    style: await measureDocxStyle(await makeDocx(ODA_BLOCKS), {
      id: 'team-x',
      title: 't',
      documents: 1,
    }),
  }
  return renderTemplateMd(def)
}

describe('team template in the Word AI panel', () => {
  it('cover labels are the [label] paragraphs before the first heading', () => {
    expect(coverLabelsOf(formEditor())).toEqual(['사업명'])
  })

  it('templateRunFor reads the template of the open working copy', async () => {
    const text = await md()
    const got = await templateRunFor(
      { templateFor: async (p) => (p === 'C:/copy.docx' ? text : null) },
      'C:/copy.docx',
      formEditor(),
    )
    expect(got!.run.title).toBe('KOICA ODA 기술제안서')
    expect(got!.run.sections.map((s) => s.heading)).toEqual(['Ⅰ. 소개'])
    expect(got!.run.coverLabels).toEqual(['사업명'])
    expect(got!.style.format).toBe('docx')
  })

  it('an ordinary document, an unsaved one or a broken md has no template', async () => {
    const api = { templateFor: async () => '# broken' }
    expect(
      await templateRunFor({ templateFor: async () => null }, 'C:/a.docx', formEditor()),
    ).toBeNull()
    expect(await templateRunFor(api, null, formEditor())).toBeNull()
    expect(await templateRunFor(api, 'C:/a.docx', formEditor())).toBeNull()
  })

  it('list_team_templates returns the index read-only', async () => {
    const skill = createTeamTemplatesSkill(() => ({
      teamTemplateIndex: async () => '# 팀 템플릿 목록\n- [A](<Word/A/>) — 용도 · 확정 · 11111111',
    }))
    const r = await skill.executeTool({ id: '1', name: 'list_team_templates', input: {} })
    expect(r.output).toContain('# 팀 템플릿 목록')
    expect(r.output).toContain('Home')
    expect(r.mutated).toBeFalsy()
    const none = createTeamTemplatesSkill(() => ({ teamTemplateIndex: async () => null }))
    expect(
      (await none.executeTool({ id: '2', name: 'list_team_templates', input: {} })).output,
    ).toContain('not set up')
  })
})
