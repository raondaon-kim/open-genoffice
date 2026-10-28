import { describe, expect, it, vi } from 'vitest'
import { createReportSkill, type ReportSkillDeps } from '../src/skill'
import type { LlmPort, TemplateForRun, TemplateLander, WikiPort } from '../src/types'

const TEMPLATE: TemplateForRun = {
  title: 'KOICA ODA 기술제안서',
  purpose: '용역 제안서',
  sections: [{ index: 0, path: ['Ⅰ. 소개'], heading: '1. 개요', level: 2, guidance: '' }],
  coverLabels: [],
  wikiPages: [],
  styleRules: '',
}

const llm: LlmPort = async (req) =>
  req.system.includes('템플릿 기획자')
    ? { status: 'complete', text: '{"brief":{},"cover":{},"sections":[{"index":0,"point":"p"}]}' }
    : { status: 'complete', text: '본문.\n<<주장>>\n- a\n<<부족>>\n- 없음' }

function deps(over: Partial<ReportSkillDeps<object>> = {}) {
  const sections: number[] = []
  const templateLander: TemplateLander = {
    cover: async () => {},
    section: async (i) => void sections.push(i),
    sectionFailed: async () => {},
    gaps: async () => {},
    finish: async () => {},
  }
  const wiki: WikiPort = { catalog: async () => '', index: async () => '', read: async () => null }
  const d: ReportSkillDeps<object> = {
    defaultStyle: 'docx-report',
    proposalStyle: 'docx-bid-proposal',
    lander: vi.fn(() => {
      throw new Error('the report lander must not be used for a template')
    }),
    llm: () => llm,
    wiki: vi.fn(() => wiki),
    attachments: async () => [],
    readStyle: async () => ({ style: {}, description: '' }),
    progress: () => {},
    template: async () => TEMPLATE,
    templateLander: vi.fn(() => templateLander),
    wikiReady: async () => ({ ok: true }),
    ...over,
  }
  return { d, sections }
}

const call = (input: Record<string, unknown>) => ({ id: '1', name: 'write_report', input })

describe('write_report with a team template', () => {
  it('fills the template outline instead of planning one', async () => {
    const { d, sections } = deps()
    const r = await createReportSkill(d).executeTool(call({ request: '써 줘' }))
    expect(r.isError).toBeFalsy()
    expect(sections).toEqual([0])
    expect(d.lander).not.toHaveBeenCalled()
  })

  it('asks the user before writing without an unavailable wiki', async () => {
    const { d, sections } = deps({
      wikiReady: async () => ({ ok: false, off: false, reason: 'health check timed out' }),
    })
    const r = await createReportSkill(d).executeTool(call({ request: '써 줘' }))
    expect(r.isError).toBe(true)
    expect(r.output).toContain(
      '업무 위키를 사용할 수 없습니다 (health check timed out). 첨부 자료만으로 쓸까요?',
    )
    expect(r.output).toContain('withoutWiki')
    expect(sections).toEqual([])
  })

  it('withoutWiki writes with no wiki', async () => {
    const { d, sections } = deps({
      wikiReady: async () => ({ ok: false, off: true, reason: '업무 위키가 꺼져 있습니다' }),
    })
    const r = await createReportSkill(d).executeTool(call({ request: '써 줘', withoutWiki: true }))
    expect(r.isError).toBeFalsy()
    expect(sections).toEqual([0])
    expect(d.wiki).not.toHaveBeenCalled()
  })

  it('names the template in the context and strips it from older messages', async () => {
    const { d } = deps()
    const skill = createReportSkill(d)
    const ctx = await skill.buildContext!('')
    expect(ctx).toContain('KOICA ODA 기술제안서')
    expect(skill.stripContext!(`질문\n\n${ctx}`)).toBe('질문')
  })

  it('without a template the report path is unchanged', async () => {
    const { d } = deps({ template: async () => null })
    const skill = createReportSkill(d)
    expect(await skill.buildContext!('')).toBe('')
    await skill.executeTool(call({ request: '보고서 써 줘' }))
    expect(d.lander).toHaveBeenCalled()
  })
})
