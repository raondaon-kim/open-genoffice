import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiCatalogCache, parseCatalogMaxAge } from '../src/main/ai-catalog-cache'

const OPENROUTER_RESPONSE = {
  data: [
    {
      id: 'anthropic/claude-test',
      name: 'Claude Test',
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools'],
      context_length: 200000,
      top_provider: { max_completion_tokens: 8192 },
      pricing: { prompt: '0.000001', completion: '0.000002' },
    },
    {
      id: 'no-tools/model',
      name: 'No tools',
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: [],
    },
  ],
}

describe('AiCatalogCache', () => {
  it('honors provider max-age and serves a fresh disk/memory cache without another request', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(OPENROUTER_RESPONSE), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
        }),
    )
    const now = new Date('2026-08-03T12:00:00.000Z')
    const cache = new AiCatalogCache({
      cacheDir: join(mkdtempSync(join(tmpdir(), 'genoffice-catalog-')), 'models'),
      getApiKey: () => 'sk-or-v1-test',
      fetch: fetchMock,
      now: () => now,
    })

    const first = await cache.list(['openrouter'])
    const second = await cache.list(['openrouter'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.models.map((model) => model.id)).toEqual(['anthropic/claude-test'])
    expect(second.catalogs[0]).toMatchObject({ stale: false, fetchedAt: now.toISOString() })
  })

  it('returns stale data immediately and deduplicates background refreshes', async () => {
    let now = new Date('2026-08-03T12:00:00.000Z')
    let resolveRefresh!: (response: Response) => void
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(OPENROUTER_RESPONSE), {
          status: 200,
          headers: { 'cache-control': 'max-age=1' },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRefresh = resolve
          }),
      )
    const cache = new AiCatalogCache({
      cacheDir: join(mkdtempSync(join(tmpdir(), 'genoffice-catalog-')), 'models'),
      getApiKey: () => 'sk-or-v1-test',
      fetch: fetchMock,
      now: () => now,
    })
    await cache.list(['openrouter'])
    now = new Date('2026-08-03T12:00:02.000Z')

    const staleA = await cache.list(['openrouter'])
    const staleB = await cache.list(['openrouter'])
    expect(staleA.catalogs[0]?.stale).toBe(true)
    expect(staleB.models).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    resolveRefresh(
      new Response(JSON.stringify(OPENROUTER_RESPONSE), {
        status: 200,
        headers: { 'cache-control': 'max-age=300' },
      }),
    )
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('parses max-age and uses a five-minute fallback', () => {
    expect(parseCatalogMaxAge('public, max-age=90, stale-while-revalidate=3600')).toBe(90)
    expect(parseCatalogMaxAge()).toBe(300)
  })

  it.each([
    {
      providerId: 'deepseek',
      modelsUrl: 'https://api.deepseek.com/v1/models',
      remote: { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] },
      expected: ['deepseek-chat', 'deepseek-reasoner'],
    },
    {
      providerId: 'glm',
      modelsUrl: 'https://api.z.ai/api/paas/v4/models',
      remote: { data: [{ id: 'glm-5.3' }, { id: 'glm-4.6' }, { id: 'glm-unknown-future' }] },
      expected: ['glm-4.6', 'glm-5.3'],
    },
    {
      providerId: 'kimi',
      modelsUrl: 'https://api.moonshot.ai/v1/models',
      remote: { data: [{ id: 'kimi-k3' }, { id: 'kimi-k2.6' }] },
      expected: ['kimi-k2.6', 'kimi-k3'],
    },
    {
      providerId: 'minimax',
      modelsUrl: 'https://api.minimax.io/v1/models',
      remote: { data: [{ id: 'MiniMax-M2.1' }, { id: 'MiniMax-M3' }] },
      expected: ['MiniMax-M2.1', 'MiniMax-M3'],
    },
  ] as const)(
    '$providerId: discovers models via its OpenAI-compatible list narrowed to the registry allowlist',
    async ({ providerId, modelsUrl, remote, expected }) => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify(remote), { status: 200 }),
      )
      const cache = new AiCatalogCache({
        cacheDir: join(mkdtempSync(join(tmpdir(), 'genoffice-catalog-')), 'models'),
        getApiKey: () => 'provider-key',
        fetch: fetchMock,
        now: () => new Date('2026-08-03T12:00:00.000Z'),
      })

      const result = await cache.list([providerId])

      expect(fetchMock).toHaveBeenCalledWith(
        modelsUrl,
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer provider-key' },
        }),
      )
      expect(result.models.map((model) => model.id)).toEqual(expected)
      expect(result.catalogs[0]).toMatchObject({ providerId, stale: false })
    },
  )

  it('falls back to the accessible model list when the registry allowlist matches nothing', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 'glm-brand-new' }] }), { status: 200 }),
    )
    const cache = new AiCatalogCache({
      cacheDir: join(mkdtempSync(join(tmpdir(), 'genoffice-catalog-')), 'models'),
      getApiKey: () => 'provider-key',
      fetch: fetchMock,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
    })

    const result = await cache.list(['glm'])

    expect(result.models.map((model) => model.id)).toEqual(['glm-brand-new'])
  })
})
