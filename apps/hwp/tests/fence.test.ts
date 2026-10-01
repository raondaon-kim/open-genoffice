import { describe, expect, it, vi } from 'vitest'
import { withFence } from '../src/renderer/ai/fence'

const editorSeq = (...shas: string[]) => {
  let i = 0
  return {
    getDocumentState: vi.fn(async () => ({ documentSha256: shas[Math.min(i++, shas.length - 1)] })),
  }
}

describe('withFence', () => {
  it('returns the value when the document is unchanged around the run', async () => {
    const outcome = await withFence(editorSeq('s0', 's0'), async (sha) => `ran on ${sha}`)
    expect(outcome).toEqual({ ok: true, sha: 's0', value: 'ran on s0' })
  })

  it('reports before/after when the user edited meanwhile and discards the value', async () => {
    const outcome = await withFence(editorSeq('s0', 's1'), async () => 'ignored')
    expect(outcome).toEqual({ ok: false, before: 's0', after: 's1' })
  })

  it('propagates errors from the run', async () => {
    await expect(
      withFence(editorSeq('s0'), async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})
