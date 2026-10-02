// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../src/renderer/ai/transport'

type Chunk = { requestId: string; type: string; text?: string; thinkingKind?: string }

describe('HWP AI transport: thinking chunks', () => {
  it('forwards them as thinking and keeps the stream open', () => {
    let listener: ((chunk: Chunk) => void) | undefined
    const aiStream = vi.fn(async () => undefined)
    const unsubscribe = vi.fn()
    ;(window as unknown as { hwpApi: unknown }).hwpApi = {
      aiStream,
      aiStreamCancel: vi.fn(),
      onAiStream: (next: (chunk: Chunk) => void) => {
        listener = next
        return unsubscribe
      },
    }
    const transport = createElectronTransport(() => ({
      projectId: 'default',
      chatId: '0123456789abcdef',
    }))
    const cb = {
      onDelta: vi.fn(),
      onThinking: vi.fn(),
      onToolCall: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    transport.stream({ system: 's', messages: [], tools: [] }, cb)
    const requestId = (aiStream.mock.calls[0] as unknown as [{ requestId: string }])[0].requestId

    listener?.({ requestId, type: 'thinking', thinkingKind: 'summary', text: 'Reading' })
    listener?.({ requestId, type: 'thinking', thinkingKind: 'reasoning', text: 'raw' })
    expect(cb.onThinking.mock.calls).toEqual([
      ['Reading', 'summary'],
      ['raw', 'reasoning'],
    ])
    expect(cb.onError).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()

    listener?.({ requestId, type: 'done' })
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })
})
