import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIpcLlm, type AiStreamApi, type AiStreamChunkLike } from '../src/ipc-llm'

function fakeApi() {
  let listener: ((c: AiStreamChunkLike) => void) | null = null
  const started: Array<Record<string, unknown>> = []
  const cancelled: string[] = []
  const api: AiStreamApi = {
    aiStream: async (req) => {
      started.push(req as unknown as Record<string, unknown>)
    },
    aiStreamCancel: async (id) => {
      cancelled.push(id)
    },
    onAiStream: (h) => {
      listener = h
      return () => {
        listener = null
      }
    },
  }
  const emit = (c: Omit<AiStreamChunkLike, 'requestId'>) =>
    listener?.({ requestId: started.at(-1)!.requestId as string, ...c })
  return { api, started, cancelled, emit }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
afterEach(() => vi.useRealTimers())

describe('createIpcLlm', () => {
  it('joins the deltas, ignores reasoning, and sends the budget with thinking off', async () => {
    const f = fakeApi()
    const llm = createIpcLlm(f.api, () => ({ provider: 'litellm' }))
    const p = llm({ system: 'S', user: 'U', maxTokens: 32768 })
    await tick()
    f.emit({ type: 'reasoning', text: '생각' })
    f.emit({ type: 'delta', text: '## 1. ' })
    f.emit({ type: 'delta', text: '장' })
    f.emit({ type: 'done', stopReason: 'end_turn' })
    expect(await p).toEqual({ status: 'complete', text: '## 1. 장' })
    expect(f.started[0]).toMatchObject({
      system: 'S',
      messages: [{ role: 'user', text: 'U' }],
      maxTokens: 32768,
      thinking: 'off',
      settings: { provider: 'litellm' },
    })
  })

  it('reports a stop at the token limit', async () => {
    const f = fakeApi()
    const p = createIpcLlm(f.api, () => ({}))({ system: '', user: '', maxTokens: 1 })
    await tick()
    f.emit({ type: 'delta', text: '가' })
    f.emit({ type: 'done', stopReason: 'max_tokens' })
    expect(await p).toEqual({ status: 'max_tokens', text: '가' })
  })

  it('a blank answer is empty and an error chunk is an error', async () => {
    const f = fakeApi()
    const llm = createIpcLlm(f.api, () => ({}))
    const a = llm({ system: '', user: '', maxTokens: 1 })
    await tick()
    f.emit({ type: 'done' })
    expect((await a).status).toBe('empty')
    const b = llm({ system: '', user: '', maxTokens: 1 })
    await tick()
    f.emit({ type: 'error', error: 'HTTP 500' })
    expect(await b).toEqual({ status: 'error', text: '', error: 'HTTP 500' })
  })

  it('an abort cancels the stream and resolves stopped', async () => {
    const f = fakeApi()
    const ac = new AbortController()
    const p = createIpcLlm(f.api, () => ({}))({
      system: '',
      user: '',
      maxTokens: 1,
      signal: ac.signal,
    })
    await tick()
    ac.abort()
    expect((await p).status).toBe('stopped')
    expect(f.cancelled).toEqual([f.started[0]!.requestId])
  })

  it('silence past the watchdog is an error', async () => {
    vi.useFakeTimers()
    const f = fakeApi()
    const p = createIpcLlm(f.api, () => ({}), 1000)({ system: '', user: '', maxTokens: 1 })
    await vi.advanceTimersByTimeAsync(500)
    f.emit({ type: 'ping' })
    await vi.advanceTimersByTimeAsync(900)
    f.emit({ type: 'delta', text: 'a' })
    await vi.advanceTimersByTimeAsync(1001)
    expect((await p).status).toBe('error')
  })
})
