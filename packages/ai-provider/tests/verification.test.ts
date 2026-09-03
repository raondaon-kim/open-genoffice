import { describe, expect, it, vi } from 'vitest'
import {
  verifyAnthropicApiKey,
  verifyDeepSeekApiKey,
  verifyGlmApiKey,
  verifyKimiApiKey,
  verifyMiniMaxApiKey,
  verifyOpenAiApiKey,
  verifyOpenRouterApiKey,
  verifyProviderApiKey,
} from '../src/verification'
import { jsonResponse } from './test-utils'

const now = new Date('2026-08-03T12:00:00.000Z')

describe('provider key verification', () => {
  it('verifies OpenRouter via key metadata without making a generation request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          label: 'GenOffice test',
          expires_at: '2027-01-01T00:00:00Z',
          limit: 20,
          limit_remaining: 18.5,
        },
      }),
    )

    const result = await verifyOpenRouterApiKey('sk-or-secret', { fetch: fetchMock, now })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/key',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer sk-or-secret' },
      }),
    )
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('body')
    expect(result).toEqual({
      ok: true,
      providerId: 'openrouter',
      verifiedAt: now.toISOString(),
      details: {
        label: 'GenOffice test',
        expiresAt: '2027-01-01T00:00:00Z',
        limit: 20,
        limitRemaining: 18.5,
      },
    })
  })

  it('verifies Anthropic through the one-item model list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'claude-opus-4-6' }] }))

    const result = await verifyAnthropicApiKey('sk-ant-secret', { fetch: fetchMock, now })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models?limit=1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-secret',
          'anthropic-version': '2023-06-01',
        }),
      }),
    )
    expect(result).toEqual({
      ok: true,
      providerId: 'anthropic',
      verifiedAt: now.toISOString(),
      details: { modelIds: ['claude-opus-4-6'] },
    })
  })

  it('verifies OpenAI through the accessible model list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: [{ id: 'gpt-5.2' }, { id: 'not-a-model' }, { missing: 'id' }] }),
      )

    const result = await verifyProviderApiKey('openai', 'sk-openai-secret', {
      fetch: fetchMock,
      now,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer sk-openai-secret' },
      }),
    )
    expect(result).toMatchObject({
      ok: true,
      providerId: 'openai',
      details: { modelIds: ['gpt-5.2', 'not-a-model'] },
    })
  })

  it('returns typed failures for missing, invalid and malformed credentials', async () => {
    const fetchMock = vi.fn()
    const missing = await verifyOpenAiApiKey('', { fetch: fetchMock, now })
    expect(missing).toMatchObject({ ok: false, error: { code: 'missing-key' } })
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(
      new Response('invalid credentials for not-secret', { status: 401 }),
    )
    const invalid = await verifyOpenRouterApiKey('not-secret', { fetch: fetchMock, now })
    expect(invalid).toMatchObject({
      ok: false,
      error: {
        code: 'invalid-key',
        status: 401,
        message: expect.stringContaining('invalid credentials for [REDACTED]'),
      },
    })
    expect(JSON.stringify(invalid)).not.toContain('not-secret')

    fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: [] }))
    const malformed = await verifyAnthropicApiKey('key', { fetch: fetchMock, now })
    expect(malformed).toMatchObject({ ok: false, error: { code: 'invalid-response' } })
  })

  it('returns a network failure instead of throwing or exposing the key', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('socket unavailable for super-secret-key'))
    const result = await verifyOpenAiApiKey('super-secret-key', { fetch: fetchMock, now })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'network-error',
        message: expect.stringContaining('socket unavailable for [REDACTED]'),
      },
    })
    expect(JSON.stringify(result)).not.toContain('super-secret-key')
  })

  it.each([
    {
      providerId: 'deepseek',
      verify: verifyDeepSeekApiKey,
      baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat',
    },
    {
      providerId: 'glm',
      verify: verifyGlmApiKey,
      baseUrl: 'https://api.z.ai/api/paas/v4',
      modelId: 'glm-5.3',
    },
    {
      providerId: 'kimi',
      verify: verifyKimiApiKey,
      baseUrl: 'https://api.moonshot.ai/v1',
      modelId: 'kimi-k3',
    },
    {
      providerId: 'minimax',
      verify: verifyMiniMaxApiKey,
      baseUrl: 'https://api.minimax.io/v1',
      modelId: 'MiniMax-M2.1',
    },
  ] as const)(
    'verifies $providerId through its OpenAI-compatible model list',
    async ({ providerId, verify, baseUrl, modelId }) => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: modelId }] }))

      const result = await verify('provider-secret', { fetch: fetchMock, now })

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/models`,
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer provider-secret' },
        }),
      )
      expect(result).toEqual({
        ok: true,
        providerId,
        verifiedAt: now.toISOString(),
        details: { modelIds: [modelId] },
      })
    },
  )

  it('rejects an invalid key for a new provider with a typed failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"error":{"message":"token expired"}}', { status: 401 }))

    const result = await verifyProviderApiKey('glm', 'glm-secret', { fetch: fetchMock, now })

    expect(result).toMatchObject({
      ok: false,
      providerId: 'glm',
      error: { code: 'invalid-key', status: 401 },
    })
    expect(JSON.stringify(result)).not.toContain('glm-secret')
  })
})
