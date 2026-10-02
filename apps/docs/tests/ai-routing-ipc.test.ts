import { describe, expect, it, vi } from 'vitest'
import { AI_CHANNELS } from '../src/shared/ipc'
import {
  parseAiChatRequest,
  parseAiStreamRequest,
  parseProjectAppendArgs,
  parseProjectLoadArgs,
  parseProjectRebindArgs,
  parseProjectResolveArgs,
  parseProjectSimpleArgs,
  registerAiRoutingIpc,
} from '../src/main/ai-routing-ipc'

const codexBridge = vi.hoisted(() => ({
  streamCodexAppServer: vi.fn(),
  chatCodexAppServer: vi.fn(),
}))
vi.mock('@genoffice/ai-provider/codex-app-server', () => codexBridge)

describe('credential-safe AI request validation', () => {
  it('accepts content plus conversation identity', () => {
    expect(
      parseAiStreamRequest({
        requestId: 'request-1',
        conversation: { projectId: 'default', chatId: '0123456789abcdef' },
        system: 'system',
        messages: [{ role: 'user', text: 'hello' }],
        tools: [],
      }),
    ).toMatchObject({
      requestId: 'request-1',
      conversation: { projectId: 'default', chatId: '0123456789abcdef' },
    })
  })

  it('accepts the raw reasoning of an assistant turn so it can be sent back', () => {
    const request = parseAiStreamRequest({
      requestId: 'request-1',
      system: 'system',
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'ok', reasoning: 'plan' },
      ],
    })
    expect(request.messages[1]).toEqual({ role: 'assistant', text: 'ok', reasoning: 'plan' })
  })

  it('rejects reasoning that is not text and reasoning on other roles', () => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-1',
        system: 'system',
        messages: [{ role: 'assistant', text: 'ok', reasoning: 7 }],
      }),
    ).toThrow()
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-1',
        system: 'system',
        messages: [{ role: 'user', text: 'ok', reasoning: 'x' }],
      }),
    ).toThrow('unsupported field: reasoning')
  })

  it('rejects legacy renderer-supplied provider settings', () => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-1',
        settings: { provider: 'openrouter', providers: { openrouter: { apiKey: 'secret' } } },
        system: 'system',
        messages: [],
      }),
    ).toThrow('unsupported field: settings')
    expect(() =>
      parseAiChatRequest({
        settings: { provider: 'openrouter' },
        system: 'system',
        user: 'hello',
      }),
    ).toThrow('unsupported field: settings')
  })

  it('rejects unsupported routes and malformed identities', () => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-1',
        conversation: { projectId: '', chatId: 'chat-1' },
        system: 'system',
        messages: [],
      }),
    ).toThrow('projectId is invalid')
  })

  it.each([
    { projectId: '../secrets', chatId: '0123456789abcdef' },
    { projectId: 'proj-0123456789ab/../../x', chatId: '0123456789abcdef' },
    { projectId: 'default', chatId: '../ai-secrets' },
    { projectId: 'default', chatId: 'unsaved-../../escape' },
    { projectId: '/tmp', chatId: '0123456789abcdef' },
  ])('rejects path-traversal identity $projectId / $chatId', (conversation) => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-1',
        conversation,
        system: 'system',
        messages: [],
      }),
    ).toThrow(/(?:projectId|chatId) is invalid/)
  })

  it('accepts bounded raw base64 images with supported MIME types', () => {
    const request = parseAiStreamRequest({
      requestId: 'request-image',
      system: 'system',
      messages: [
        {
          role: 'user',
          text: 'describe this',
          images: [{ mime: 'image/png', base64: Buffer.from('png').toString('base64') }],
        },
      ],
    })

    expect(request.messages[0]).toMatchObject({
      role: 'user',
      images: [{ mime: 'image/png', base64: 'cG5n' }],
    })
  })

  it.each([
    [{ mime: 'image/svg+xml', base64: 'PHN2Zz4=' }, 'MIME type is not supported'],
    [{ mime: 'image/png', base64: 'not base64!' }, 'base64 is invalid'],
    [{ mime: 'image/png', base64: '' }, 'base64 is invalid'],
  ])('rejects a hostile image payload %#', (image, expected) => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image',
        system: 'system',
        messages: [{ role: 'user', text: '', images: [image] }],
      }),
    ).toThrow(expected)
  })

  it('rejects images on non-user messages and oversized image collections', () => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image',
        system: 'system',
        messages: [{ role: 'assistant', text: '', images: [] }],
      }),
    ).toThrow('unsupported field: images')

    const image = { mime: 'image/png', base64: Buffer.from('x').toString('base64') }
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image',
        system: 'system',
        messages: [{ role: 'user', text: '', images: Array.from({ length: 11 }, () => image) }],
      }),
    ).toThrow('AI images are invalid')

    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image',
        system: 'system',
        messages: Array.from({ length: 3 }, () => ({
          role: 'user',
          text: '',
          images: Array.from({ length: 8 }, () => image),
        })),
      }),
    ).toThrow('AI images exceed the count limit')
  })

  it('enforces per-image and aggregate decoded-byte limits', () => {
    const tooLarge = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image-size',
        system: 'system',
        messages: [{ role: 'user', text: '', images: [{ mime: 'image/png', base64: tooLarge }] }],
      }),
    ).toThrow('AI image exceeds the size limit')

    const fourMegabytes = Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image-total-size',
        system: 'system',
        messages: [
          {
            role: 'user',
            text: '',
            images: Array.from({ length: 5 }, () => ({
              mime: 'image/jpeg',
              base64: fourMegabytes,
            })),
          },
        ],
      }),
    ).toThrow('AI images exceed the aggregate size limit')
  })

  it('requires image capability at the trusted send boundary', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const assertRouteAvailable = vi.fn(async () => {
      throw new Error('text-model does not support image input; choose a vision-capable model')
    })
    const send = vi.fn()
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) =>
          handlers.set(channel, listener as (...args: unknown[]) => unknown),
      },
      settings: {
        getGlobalDefault: () => ({ providerId: 'openrouter', modelId: 'text-model' }),
        assertRouteAvailable,
      } as never,
      getProjectStore: () => ({}) as never,
      getGensparkApiKey: () => '',
    })

    await handlers.get(AI_CHANNELS.stream)!(
      { sender: { id: 77, isDestroyed: () => false, send } },
      {
        requestId: 'image-boundary-request',
        system: 'system',
        messages: [
          {
            role: 'user',
            text: 'look',
            images: [{ mime: 'image/jpeg', base64: Buffer.from('jpeg').toString('base64') }],
          },
        ],
      },
    )

    expect(assertRouteAvailable).toHaveBeenCalledWith(
      { providerId: 'openrouter', modelId: 'text-model' },
      { requireImageInput: true },
    )
    expect(send).toHaveBeenCalledWith(
      AI_CHANNELS.streamChunk,
      expect.objectContaining({
        type: 'error',
        error: expect.stringContaining('does not support image input'),
      }),
    )
  })

  it('returns a persisted unavailable route for provenance without send-time validation', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const assertRouteAvailable = vi.fn(async () => {
      throw new Error('key removed')
    })
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) => {
          handlers.set(channel, listener as (...args: unknown[]) => unknown)
        },
      },
      settings: {
        getGlobalDefault: () => ({ providerId: 'genspark', modelId: 'claude-opus-4-7' }),
        assertRouteAvailable,
      } as never,
      getProjectStore: () =>
        ({
          getOrCreateChatAiMetadata: () => ({
            schemaVersion: 1,
            route: { providerId: 'openrouter', modelId: 'anthropic/claude-test' },
            createdAt: '2026-08-03T00:00:00.000Z',
            updatedAt: '2026-08-03T00:00:00.000Z',
          }),
          setChatAiRoute: vi.fn(),
        }) as never,
      getGensparkApiKey: () => '',
    })

    const handler = handlers.get(AI_CHANNELS.getConversationRoute)!
    const route = await handler(
      { sender: { id: 1, isDestroyed: () => false, send: vi.fn() } },
      { projectId: 'default', chatId: '0123456789abcdef' },
    )

    expect(route).toEqual({ providerId: 'openrouter', modelId: 'anthropic/claude-test' })
    expect(assertRouteAvailable).not.toHaveBeenCalled()
  })
})

describe('project IPC trusted-boundary validation', () => {
  it('accepts valid project requests and normalizes bounded values', () => {
    expect(
      parseProjectResolveArgs({
        filePath: null,
        tempChatId: 'unsaved-123',
        sessionId: 'session-1',
      }),
    ).toEqual({ filePath: null, tempChatId: 'unsaved-123', sessionId: 'session-1' })
    expect(parseProjectLoadArgs({ projectId: 'default', chatId: '0123456789abcdef' })).toEqual({
      projectId: 'default',
      chatId: '0123456789abcdef',
      limit: 200,
    })
    expect(parseProjectSimpleArgs('create', { name: '  Research  ' })).toEqual({
      name: 'Research',
    })
  })

  it.each([
    () => parseProjectResolveArgs({ filePath: '../outside.docx' }),
    () => parseProjectResolveArgs({ filePath: '/tmp/../outside.docx' }),
    () => parseProjectResolveArgs({ filePath: null, tempChatId: '../secrets' }),
    () =>
      parseProjectLoadArgs({
        projectId: 'proj-0123456789ab/../../outside',
        chatId: '0123456789abcdef',
      }),
    () =>
      parseProjectRebindArgs({
        projectId: 'default',
        tempChatId: 'unsaved-1',
        newChatId: '0123456789abcdef',
        newFilePath: '/tmp/file.docx',
      }),
    () =>
      parseProjectSimpleArgs('moveFile', { filePath: '/tmp/../etc/passwd', projectId: 'default' }),
    () => parseProjectSimpleArgs('timeline', { projectId: 'default', limit: 50_000 }),
    () => parseProjectSimpleArgs('delete', { id: 'default', extra: true }),
  ])('rejects hostile project payload %# before it reaches project-store', (parse) => {
    expect(parse).toThrow()
  })

  it('rejects malformed or secret-bearing provenance', () => {
    expect(() =>
      parseProjectAppendArgs({
        projectId: 'default',
        chatId: '0123456789abcdef',
        role: 'assistant',
        text: 'done',
        ai: {
          requested: {
            providerId: 'openrouter',
            modelId: 'openai/gpt-test',
            apiKey: 'must-not-cross-ipc',
          },
        },
      }),
    ).toThrow('unsupported field: apiKey')

    expect(() =>
      parseProjectAppendArgs({
        projectId: 'default',
        chatId: '0123456789abcdef',
        role: 'user',
        text: 'hello',
        ai: { requested: { providerId: 'openrouter', modelId: 'model' } },
      }),
    ).toThrow('AI provenance is invalid')
  })

  it('rejects malformed tools and attachment metadata', () => {
    expect(() =>
      parseProjectAppendArgs({
        projectId: 'default',
        chatId: '0123456789abcdef',
        role: 'assistant',
        text: 'done',
        tools: [{ name: 'tool', summary: 'ok', isError: 'yes' }],
      }),
    ).toThrow('isError must be a boolean')
    expect(() =>
      parseProjectAppendArgs({
        projectId: 'default',
        chatId: '0123456789abcdef',
        role: 'user',
        text: 'hello',
        attachments: [{ name: 'secret', path: '../../etc/passwd' }],
      }),
    ).toThrow('Attachment path is invalid')
  })
})

describe('Codex dispatch', () => {
  function registerWithCodexRoute(send = vi.fn()) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) =>
          handlers.set(channel, listener as (...args: unknown[]) => unknown),
      },
      settings: {
        getGlobalDefault: () => ({ providerId: 'codex', modelId: 'gpt-5.6-luna' }),
        assertRouteAvailable: vi.fn(async () => undefined),
        getProviderConfig: () => ({ apiKey: '', model: 'gpt-5.6-luna' }),
      } as never,
      getProjectStore: () =>
        ({
          getOrCreateChatAiMetadata: () => ({
            schemaVersion: 1,
            route: { providerId: 'codex', modelId: 'gpt-5.6-luna' },
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          }),
        }) as never,
      getGensparkApiKey: () => '',
    })
    return { handlers, send }
  }

  it('streams a codex route through the app-server bridge with the conversation as its session', async () => {
    codexBridge.streamCodexAppServer.mockImplementation(async (...args: unknown[]) => {
      const cb = args[5] as { onDelta(text: string): void }
      cb.onDelta('안녕하세요')
    })
    const { handlers, send } = registerWithCodexRoute()
    await handlers.get(AI_CHANNELS.stream)!(
      { sender: { id: 5, isDestroyed: () => false, send } },
      {
        requestId: 'codex-1',
        conversation: { projectId: 'default', chatId: '0123456789abcdef' },
        system: 'system',
        messages: [{ role: 'user', text: 'hi' }],
      },
    )
    expect(codexBridge.streamCodexAppServer).toHaveBeenCalledTimes(1)
    const [config, system, , , maxTokens, cb] = codexBridge.streamCodexAppServer.mock.calls[0]!
    expect(config).toEqual({ apiKey: '', model: 'gpt-5.6-luna' })
    expect(system).toBe('system')
    expect(maxTokens).toBe(8192)
    expect(cb).toMatchObject({ sessionId: 'default:0123456789abcdef' })
    expect(send).toHaveBeenCalledWith(AI_CHANNELS.streamChunk, {
      requestId: 'codex-1',
      type: 'delta',
      text: '안녕하세요',
    })
    expect(send).toHaveBeenLastCalledWith(AI_CHANNELS.streamChunk, {
      requestId: 'codex-1',
      type: 'done',
    })
  })

  it('forwards reasoning and reasoning summaries to the renderer as thinking chunks', async () => {
    codexBridge.streamCodexAppServer.mockImplementation(async (...args: unknown[]) => {
      const cb = args[5] as {
        onReasoningDelta(text: string): void
        onReasoningSummaryDelta(text: string): void
      }
      cb.onReasoningSummaryDelta('Reading the file')
      cb.onReasoningDelta('raw thought')
    })
    const { handlers, send } = registerWithCodexRoute()
    await handlers.get(AI_CHANNELS.stream)!(
      { sender: { id: 5, isDestroyed: () => false, send } },
      {
        requestId: 'codex-think',
        conversation: { projectId: 'default', chatId: '0123456789abcdef' },
        system: 'system',
        messages: [{ role: 'user', text: 'hi' }],
      },
    )
    expect(send).toHaveBeenCalledWith(AI_CHANNELS.streamChunk, {
      requestId: 'codex-think',
      type: 'thinking',
      thinkingKind: 'summary',
      text: 'Reading the file',
    })
    expect(send).toHaveBeenCalledWith(AI_CHANNELS.streamChunk, {
      requestId: 'codex-think',
      type: 'thinking',
      thinkingKind: 'reasoning',
      text: 'raw thought',
    })
  })

  it('answers one-shot chat for a codex route through the bridge', async () => {
    codexBridge.chatCodexAppServer.mockResolvedValue({ ok: true, content: '요약' })
    const { handlers } = registerWithCodexRoute()
    const response = await handlers.get(AI_CHANNELS.chat)!(
      { sender: { id: 5 } },
      { system: 's', user: 'u' },
    )
    expect(response).toEqual({ ok: true, content: '요약' })
    expect(codexBridge.chatCodexAppServer.mock.calls[0]!.slice(0, 3)).toEqual([
      { apiKey: '', model: 'gpt-5.6-luna' },
      's',
      'u',
    ])
  })
})

describe('Codex custom path channel', () => {
  it('forwards the path to the settings service and returns the public settings', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const setCodexCliPath = vi.fn(() => ({ schemaVersion: 1 }))
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) =>
          handlers.set(channel, listener as (...args: unknown[]) => unknown),
      },
      settings: { setCodexCliPath } as never,
      getProjectStore: () => ({}) as never,
      getGensparkApiKey: () => '',
    })
    const result = await handlers.get(AI_CHANNELS.setCodexCliPath)!({}, 'D:\\tools\\codex.exe')
    expect(setCodexCliPath).toHaveBeenCalledWith('D:\\tools\\codex.exe')
    expect(result).toEqual({ schemaVersion: 1 })
  })
})

describe('public settings channel', () => {
  it('checks the Codex account before answering, so a signed-in Codex is not shown as missing', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const order: string[] = []
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) =>
          handlers.set(channel, listener as (...args: unknown[]) => unknown),
      },
      settings: {
        ensureCodexStatus: vi.fn(async () => {
          order.push('ensureCodexStatus')
        }),
        getPublicSettings: vi.fn(() => {
          order.push('getPublicSettings')
          return { schemaVersion: 1 }
        }),
      } as never,
      getProjectStore: () => ({}) as never,
      getGensparkApiKey: () => '',
    })
    await expect(handlers.get(AI_CHANNELS.getPublicSettings)!({})).resolves.toEqual({
      schemaVersion: 1,
    })
    expect(order).toEqual(['ensureCodexStatus', 'getPublicSettings'])
  })
})

describe('retired DeepSeek model names in a conversation route', () => {
  it('answers a stored deepseek-chat route as deepseek-flash', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const stored = { providerId: 'deepseek', modelId: 'deepseek-chat' }
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) =>
          handlers.set(channel, listener as (...args: unknown[]) => unknown),
      },
      settings: { getGlobalDefault: () => stored } as never,
      getProjectStore: () =>
        ({
          getOrCreateChatAiMetadata: () => ({
            schemaVersion: 1,
            route: stored,
            createdAt: '2026-10-02T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
          }),
        }) as never,
      getGensparkApiKey: () => '',
    })
    const route = await handlers.get(AI_CHANNELS.getConversationRoute)!(
      {},
      { projectId: 'default', chatId: '0123456789abcdef' },
    )
    expect(route).toEqual({ providerId: 'deepseek', modelId: 'deepseek-flash' })
  })
})
