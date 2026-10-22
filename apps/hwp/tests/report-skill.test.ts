/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import type { Lander } from '@genoffice/report-writer'
import type { DocStyle } from '../src/shared/doc-style'
import { createReportSkill } from '../src/renderer/ai/report/report-skill'

const nullLander: Lander = {
  skeleton: async () => undefined,
  chapter: async () => undefined,
  chapterFailed: async () => undefined,
  summary: async () => undefined,
  gaps: async () => undefined,
  abandon: async () => undefined,
  finish: async () => undefined,
}

function setup(attachments: Array<{ name: string; text: string }> = []) {
  const readStyle = vi.fn(async (id: string) => ({
    style: { id, roles: [] } as unknown as DocStyle,
    description: '규칙',
  }))
  const lander = vi.fn(async () => nullLander)
  const skill = createReportSkill({
    lander,
    llm: () => async () => ({ status: 'error' as const, text: '', error: 'offline' }),
    wiki: () => null,
    attachments: async () => attachments,
    readStyle,
    progress: () => undefined,
  })
  const call = (input: Record<string, unknown>) =>
    skill.executeTool({ id: '1', name: 'write_report', input })
  return { readStyle, lander, call }
}

describe('write_report (Hangul)', () => {
  it('uses the narrative report style when no style is named', async () => {
    const s = setup()
    await s.call({ request: '보고서를 써 줘' })
    expect(s.readStyle).toHaveBeenCalledWith('report')
    expect(s.lander).toHaveBeenCalledWith(expect.anything(), 'report')
  })

  it('uses bid-proposal for a proposal with an attachment', async () => {
    const s = setup([{ name: 'rfp.hwp', text: '[page 1]\n제안요청서' }])
    await s.call({ request: '제안서를 써 줘' })
    expect(s.readStyle).toHaveBeenCalledWith('bid-proposal')
  })

  it('a style the lander cannot fill is an error naming the supported styles', async () => {
    const s = setup()
    s.lander.mockRejectedValueOnce(new Error('use report, bid-proposal'))
    const r = await s.call({ request: 'r', style: 'press-release' })
    expect(r).toMatchObject({ isError: true, output: expect.stringContaining('report') })
  })
})
