import { describe, expect, it, vi } from 'vitest'
import { createFilesSkill } from '../src/renderer/ai/files-skill'

const rfp = { path: 'C:/rfp/제안요청서.hwp', name: '제안요청서.hwp', ext: 'hwp', sizeBytes: 4096 }
const call = (input: Record<string, unknown>) => ({ id: 'c1', name: 'read_attachment', input })

describe('Hangul assistant attachments', () => {
  it('lists the attachments in the context and says nothing without them', () => {
    expect(
      createFilesSkill(
        () => [],
        () => ({ readAttachment: vi.fn() }),
      ).buildContext(),
    ).toBe('')
    const ctx = createFilesSkill(
      () => [rfp],
      () => ({ readAttachment: vi.fn() }),
    ).buildContext()
    expect(ctx).toContain('0 | 제안요청서.hwp | .hwp | 4KB')
  })

  it('reads a chunk and tells where to continue', async () => {
    const readAttachment = vi.fn(async () => ({
      ok: true as const,
      name: rfp.name,
      totalChars: 50_000,
      offset: 0,
      text: '제안서 작성 요령',
    }))
    const skill = createFilesSkill(
      () => [rfp],
      () => ({ readAttachment }),
    )
    const r = await skill.executeTool(call({ index: 0 }) as never)
    expect(readAttachment).toHaveBeenCalledWith(rfp.path, 0, 24_000)
    expect(r.output).toMatch(/continue with offset=9/)
    expect(r.output).toContain('제안서 작성 요령')
    expect(r.mutated).toBe(false)
  })

  it('rejects a bad index and passes read errors on', async () => {
    const skill = createFilesSkill(
      () => [rfp],
      () => ({ readAttachment: async () => ({ ok: false as const, error: 'engine failed' }) }),
    )
    expect((await skill.executeTool(call({ index: 3 }) as never)).isError).toBe(true)
    const r = await skill.executeTool(call({ index: 0 }) as never)
    expect(r).toMatchObject({ isError: true, output: 'engine failed' })
  })

  it('tells the model how to turn an RFP into a proposal', () => {
    const prompt = createFilesSkill(
      () => [],
      () => ({ readAttachment: vi.fn() }),
    ).systemPrompt
    expect(prompt).toMatch(/제안서 목차/)
    expect(prompt).toMatch(/평가항목|evaluation items/)
    expect(prompt).toMatch(/never invent facts about the bidder/)
  })
})
