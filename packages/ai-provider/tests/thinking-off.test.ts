import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputCaps } from '../src/output-cap'
import { streamForProvider } from '../src/stream'
import { okResponse, sseStream } from './test-utils'

beforeEach(() => resetOutputCaps())
afterEach(() => vi.unstubAllGlobals())

describe('streamForProvider: per-request thinking off', () => {
  const okTurn = () =>
    okResponse(sseStream(['data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}']))
  const cb = (thinking?: 'off') => ({
    ...(thinking ? { thinking } : {}),
    signal: new AbortController().signal,
    onDelta: () => {},
    onToolCall: () => {},
  })
  const sentBody = async (
    provider: string,
    model: string,
    thinking?: 'off',
    baseUrl?: string,
  ): Promise<Record<string, unknown>> => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okTurn()))
    vi.stubGlobal('fetch', fetchMock)
    const config = { apiKey: 'k', model, ...(baseUrl ? { baseUrl } : {}) }
    await streamForProvider(provider, config, 'sys', [], [], 4096, cb(thinking))
    return JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
  }

  it('asks a DeepSeek model to skip thinking', async () => {
    const body = await sentBody('deepseek', 'deep-seek-v4.1-flash', 'off')
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('also asks through an OpenAI-compatible proxy serving a DeepSeek model', async () => {
    const body = await sentBody('litellm', 'deepseek-v4-flash', 'off', 'http://proxy.test/v1')
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('leaves the body alone without the flag or for other models', async () => {
    expect((await sentBody('deepseek', 'deep-seek-v4.1-flash')).thinking).toBeUndefined()
    expect((await sentBody('kimi', 'kimi-k3', 'off')).thinking).toBeUndefined()
  })
})
