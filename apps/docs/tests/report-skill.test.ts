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
