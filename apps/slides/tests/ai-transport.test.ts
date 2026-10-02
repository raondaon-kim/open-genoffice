import { describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../src/renderer/ai/transport'

describe('Slides secure AI transport', () => {
  it('sends only conversation identity and model-turn content', () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const cancel = vi.fn().mockResolvedValue(undefined)
    Object.assign(window, {
      slidesApi: {
        onAiStream: () => () => {},
        aiStream: start,
        aiStreamCancel: cancel,
      },
    })
    const identity = { projectId: 'project-1', chatId: 'chat-1' }
    const transport = createElectronTransport(() => identity)

    transport.stream(
      { system: 'system', messages: [{ role: 'user', text: 'hello' }], tools: [] },
      {
        onDelta: () => {},
        onToolCall: () => {},
        onDone: () => {},
        onError: () => {},
      },
    )

    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      conversation: identity,
      system: 'system',
      messages: [{ role: 'user', text: 'hello' }],
      tools: [],
    })
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty('settings')
  })

  it('forwards thinking chunks with their kind and keeps the stream open', () => {
    type Chunk = { requestId: string; type: string; text?: string; thinkingKind?: string }
    let listener: ((chunk: Chunk) => void) | undefined
    const start = vi.fn().mockResolvedValue(undefined)
    const unsubscribe = vi.fn()
    Object.assign(window, {
      slidesApi: {
        onAiStream: (next: (chunk: Chunk) => void) => {
          listener = next
          return unsubscribe
        },
        aiStream: start,
        aiStreamCancel: vi.fn(),
      },
    })
    const transport = createElectronTransport(() => ({ projectId: 'p', chatId: 'c' }))
    const callbacks = {
      onDelta: vi.fn(),
      onThinking: vi.fn(),
      onToolCall: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    transport.stream({ system: 's', messages: [], tools: [] }, callbacks)
    const requestId = (start.mock.calls[0]![0] as { requestId: string }).requestId

    listener?.({ requestId, type: 'thinking', thinkingKind: 'summary', text: 'Reading' })
    listener?.({ requestId, type: 'thinking', thinkingKind: 'reasoning', text: 'raw' })
    expect(callbacks.onThinking.mock.calls).toEqual([
      ['Reading', 'summary'],
      ['raw', 'reasoning'],
    ])
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()
  })
})
