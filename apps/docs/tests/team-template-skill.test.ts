// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { measureDocxStyle, renderTemplateMd, type TemplateDef } from '@genoffice/team-templates'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  coverLabelsOf,
  createTeamTemplatesSkill,
  templateRunFor,
  type TeamTemplatesPort,
  type TemplateSwitch,
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

  it('list_team_templates returns the index read-only, with the ask-once rule', async () => {
    const skill = createTeamTemplatesSkill(() => port({ teamTemplateIndex: async () => INDEX }), {
      filePath: () => 'C:/plain.docx',
      onSwitch: () => {},
    })
    const r = await skill.executeTool({ id: '1', name: 'list_team_templates', input: {} })
    expect(r.output).toContain('# 팀 템플릿 목록')
    expect(r.output).toContain('use_team_template')
    expect(r.mutated).toBeFalsy()
    const none = createTeamTemplatesSkill(() => port({ teamTemplateIndex: async () => null }))
    expect(
      (await none.executeTool({ id: '2', name: 'list_team_templates', input: {} })).output,
    ).toContain('not set up')
  })

  it('in a working copy the list says to fill this one and not to ask', async () => {
    const skill = createTeamTemplatesSkill(
      () => port({ teamTemplateIndex: async () => INDEX, templateFor: async () => '# md' }),
      { filePath: () => 'C:/copy.docx', onSwitch: () => {} },
    )
    const r = await skill.executeTool({ id: '1', name: 'list_team_templates', input: {} })
    expect(r.output).not.toContain('# 팀 템플릿 목록')
    expect(r.output).toContain('write_report')
  })

  it('the prompt tells the assistant to look first and ask once', () => {
    const skill = createTeamTemplatesSkill(() => port({}), {
      filePath: () => null,
      onSwitch: () => {},
    })
    expect(skill.systemPrompt).toContain('list_team_templates')
    expect(skill.systemPrompt).toContain('use_team_template')
    expect(skill.systemPrompt).toMatch(/ask once/i)
  })
})

const INDEX = '# 팀 템플릿 목록\n- [A](<Word/A/>) — 용도 · 확정 · 11111111'

function port(over: Partial<TeamTemplatesPort<string>>): TeamTemplatesPort<string> {
  return {
    teamTemplateIndex: async () => INDEX,
    templateFor: async () => null,
    confirmDocumentReplace: async () => true,
    useTeamTemplate: async (path) => ({ ok: true, result: `opened:${path}` }),
    ...over,
  }
}

describe('use_team_template', () => {
  const call = (input: Record<string, unknown>) => ({ id: 'u', name: 'use_team_template', input })

  it('makes the working copy, then switches the tab once the reply ends', async () => {
    const switches: TemplateSwitch<string>[] = []
    const used: string[] = []
    const skill = createTeamTemplatesSkill(
      () =>
        port({
          useTeamTemplate: async (path) => {
            used.push(path)
            return { ok: true, result: `opened:${path}` }
          },
        }),
      { filePath: () => null, onSwitch: (s) => switches.push(s) },
    )
    const r = await skill.executeTool(
      call({ path: 'Word/기술제안서/', request: '기술제안서 써줘. 사업명은 도시숲 용역' }),
    )
    expect(r.isError).toBeFalsy()
    expect(used).toEqual(['Word/기술제안서/'])
    expect(switches).toHaveLength(1)
    expect(switches[0]!.result).toBe('opened:Word/기술제안서/')
    expect(switches[0]!.handoff.display).toBe('기술제안서 써줘. 사업명은 도시숲 용역')
    expect(switches[0]!.handoff.instruction).toContain('기술제안서 써줘. 사업명은 도시숲 용역')
    expect(switches[0]!.handoff.instruction).toContain('기술제안서')
    expect(r.output).toMatch(/end your reply/i)
  })

  it('a refused replace, a bad path or a working copy switches nothing', async () => {
    const switches: unknown[] = []
    const opts = { filePath: () => null, onSwitch: (s: unknown) => switches.push(s) }
    const declined = createTeamTemplatesSkill(
      () => port({ confirmDocumentReplace: async () => false }),
      opts,
    )
    const r1 = await declined.executeTool(call({ path: 'Word/A/', request: '써줘' }))
    expect(r1.output).toMatch(/kept/i)
    const any = createTeamTemplatesSkill(() => port({}), opts)
    for (const path of ['Word/../x/', 'Excel/A/', 'Word/A/B/', '', 'C:/x']) {
      expect((await any.executeTool(call({ path, request: '써줘' }))).isError).toBe(true)
    }
    expect((await any.executeTool(call({ path: 'Word/A/', request: ' ' }))).isError).toBe(true)
    const copy = createTeamTemplatesSkill(() => port({ templateFor: async () => '# md' }), {
      ...opts,
      filePath: () => 'C:/copy.docx',
    })
    expect((await copy.executeTool(call({ path: 'Word/A/', request: '써줘' }))).isError).toBe(true)
    expect(switches).toHaveLength(0)
  })

  it('a NAS failure is told to the assistant and switches nothing', async () => {
    const switches: unknown[] = []
    const skill = createTeamTemplatesSkill(
      () => port({ useTeamTemplate: async () => ({ ok: false, error: 'moved' }) }),
      { filePath: () => null, onSwitch: (s) => switches.push(s) },
    )
    const r = await skill.executeTool(call({ path: 'Word/A/', request: '써줘' }))
    expect(r.isError).toBe(true)
    expect(r.output).toContain('moved')
    expect(switches).toHaveLength(0)
  })

  it('without a switch target (no panel wiring) the tool is not offered', () => {
    const skill = createTeamTemplatesSkill(() => port({}))
    expect(skill.tools.map((t) => t.name)).toEqual(['list_team_templates'])
    const wired = createTeamTemplatesSkill(() => port({}), {
      filePath: () => null,
      onSwitch: () => {},
    })
    expect(wired.tools.map((t) => t.name)).toEqual(['list_team_templates', 'use_team_template'])
  })
})

describe('renderer bundle boundary', () => {
  it('the Word renderer imports only the browser-safe team-templates entry', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const text = readFileSync(
      join(__dirname, '..', 'src', 'renderer', 'ai', 'report', 'team-template-skill.ts'),
      'utf8',
    )
    expect(text).toContain("from '@genoffice/team-templates/md'")
    expect(text).not.toMatch(/from '@genoffice\/team-templates'/)
  })
})
