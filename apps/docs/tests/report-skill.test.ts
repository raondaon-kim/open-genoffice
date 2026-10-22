import { describe, expect, it, vi } from 'vitest'
import type { DocxStyle } from '@genoffice/doc-styles'
import type { Lander } from '@genoffice/report-writer'
import { createReportSkill } from '../src/renderer/ai/report/report-skill'

const style = { id: 'x', roles: [] } as unknown as DocxStyle
const nullLander: Lander = {
  skeleton: async () => undefined,
  chapter: async () => undefined,
  chapterFailed: async () => undefined,
  summary: async () => undefined,
  gaps: async () => undefined,
  abandon: async () => undefined,
  finish: async () => undefined,
}

function setup(attachments: () => Promise<Array<{ name: string; text: string }>> = async () => []) {
  const llm = vi.fn(async () => ({ status: 'error' as const, text: '', error: 'offline' }))
  const readStyle = vi.fn(async (id: string) => ({ style: { ...style, id }, description: '규칙' }))
  const skill = createReportSkill({
    lander: () => nullLander,
    llm: () => llm,
    wiki: () => null,
    attachments,
    readStyle,
    progress: () => undefined,
  })
  const call = (input: Record<string, unknown>) =>
    skill.executeTool({ id: '1', name: 'write_report', input })
  return { skill, llm, readStyle, call }
}

describe('write_report (Word)', () => {
  it('offers one tool, write_report', () => {
    expect(setup().skill.tools.map((t) => t.name)).toEqual(['write_report'])
  })

  it('uses docx-report when no style is named', async () => {
    const s = setup()
    await s.call({ request: '유네스코 지침으로 보고서를 써 줘' })
    expect(s.readStyle).toHaveBeenCalledWith('docx-report')
  })

  it('uses docx-bid-proposal for a proposal with an attachment', async () => {
    const s = setup(async () => [{ name: 'rfp.pdf', text: '[page 1]\n제안요청서' }])
    await s.call({ request: '첨부한 제안요청서로 제안서를 써 줘' })
    expect(s.readStyle).toHaveBeenCalledWith('docx-bid-proposal')
  })

  it('uses the style the user named', async () => {
    const s = setup()
    await s.call({ request: 'r', style: 'docx-plan' })
    expect(s.readStyle).toHaveBeenCalledWith('docx-plan')
  })

  it('an unreadable attachment fails before any model call', async () => {
    const s = setup(async () => {
      throw new Error('첨부를 읽을 수 없습니다: a.hwp (locked)')
    })
    const r = await s.call({ request: 'r' })
    expect(r.isError).toBe(true)
    expect(r.output).toContain('a.hwp')
    expect(s.llm).not.toHaveBeenCalled()
  })

  it('a missing request is an error', async () => {
    const r = await setup().call({})
    expect(r.isError).toBe(true)
  })
})

describe('write_report guidance', () => {
  it('tells the assistant to keep what is already in the document', () => {
    const { skill } = setup()
    expect(skill.systemPrompt).toMatch(/after what is already in the open document/)
    expect(skill.systemPrompt).toMatch(/never delete or rewrite existing content/i)
  })
})

describe('write_report result', () => {
  it('tells the assistant to leave the document as it is and answer the user', async () => {
    const llm = vi.fn(async (req: { system: string }) =>
      req.system.includes('보고서 기획자')
        ? {
            status: 'complete' as const,
            text: JSON.stringify({
              brief: { purpose: 'p', reader: 'r', messages: [], terms: {} },
              title: 'T',
              chapters: [
                {
                  no: 1,
                  title: '장',
                  point: 'p',
                  owns: [],
                  stances: [],
                  sections: [],
                  attachmentParts: [],
                  wikiPages: [],
                },
              ],
            }),
          }
        : { status: 'complete' as const, text: '## 1. 장\n본문' },
    )
    const skill = createReportSkill({
      lander: () => nullLander,
      llm: () => llm,
      wiki: () => null,
      attachments: async () => [],
      readStyle: async (id: string) => ({ style: { ...style, id }, description: '' }),
      progress: () => undefined,
    })
    const r = await skill.executeTool({ id: '1', name: 'write_report', input: { request: 'r' } })
    expect(r.isError).toBeFalsy()
    expect(r.output).toMatch(/do not change the document further/i)
  })
})
