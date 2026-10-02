import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiCatalogCache } from '../src/main/ai-catalog-cache'
import { AiSecretStore, type SecretCipher } from '../src/main/ai-secret-store'
import { AiSettingsService } from '../src/main/ai-settings-service'

class TestCipher implements SecretCipher {
  available = true

  isAvailable(): boolean {
    return this.available
  }

  encrypt(value: string): Buffer {
    if (!this.available) throw new Error('unavailable')
    return Buffer.from(`encrypted:${value}`, 'utf8')
  }

  decrypt(value: Buffer): string {
    if (!this.available) throw new Error('unavailable')
    const decoded = value.toString('utf8')
    if (!decoded.startsWith('encrypted:')) throw new Error('invalid ciphertext')
    return decoded.slice('encrypted:'.length)
  }
}

function fixture(cipher = new TestCipher()) {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-ai-settings-'))
  const settingsPath = join(dir, 'ai-settings.json')
  const secretsPath = join(dir, 'ai-secrets.json')
  const secretStore = new AiSecretStore(secretsPath, cipher)
  const catalogs = new AiCatalogCache({
    cacheDir: join(dir, 'catalogs'),
    getApiKey: (providerId) => secretStore.get(providerId),
    fetch: vi.fn(),
  })
  const service = new AiSettingsService({
    settingsPath,
    secretStore,
    catalogs,
    isGensparkConfigured: () => false,
  })
  return { dir, settingsPath, secretsPath, secretStore, service, cipher }
}

describe('AiSettingsService migration and public boundary', () => {
  it('encrypts legacy keys, validates the rewrite, and leaves no plaintext backup', () => {
    const { settingsPath, secretsPath, secretStore, service } = fixture()
    const secret = 'synthetic-legacy-key'
    writeFileSync(
      settingsPath,
      JSON.stringify({
        provider: 'openrouter',
        providers: {
          openrouter: { apiKey: secret, model: 'anthropic/claude-sonnet-4' },
        },
      }),
    )

    const settings = service.getPublicSettings()

    expect(settings.globalDefault).toEqual({
      providerId: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4',
    })
    expect(secretStore.get('openrouter')).toBe(secret)
    expect(readFileSync(settingsPath, 'utf8')).not.toContain(secret)
    expect(readFileSync(secretsPath, 'utf8')).not.toContain(secret)
    expect(existsSync(`${settingsPath}.legacy-backup`)).toBe(false)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).schemaVersion).toBe(2)
  })

  it('removes a stale plaintext backup left by an older migration implementation', () => {
    const { settingsPath, service } = fixture()
    const backupPath = `${settingsPath}.legacy-backup`
    writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        globalDefault: { providerId: 'genspark', modelId: 'claude-opus-4-7' },
        providers: {},
      }),
    )
    writeFileSync(backupPath, 'sk-plaintext-from-old-version')

    service.getPublicSettings()

    expect(existsSync(backupPath)).toBe(false)
  })

  it('fails closed before rewriting or creating a plaintext backup when encryption is unavailable', () => {
    const cipher = new TestCipher()
    cipher.available = false
    const { settingsPath, secretsPath, service } = fixture(cipher)
    const secret = 'sk-or-v1-cannot-migrate'
    const legacy = JSON.stringify({
      provider: 'openrouter',
      providers: { openrouter: { apiKey: secret, model: 'openai/gpt-4.1' } },
    })
    writeFileSync(settingsPath, legacy)

    expect(() => service.getPublicSettings()).toThrow('Secure credential storage is unavailable')
    expect(readFileSync(settingsPath, 'utf8')).toBe(legacy)
    expect(existsSync(`${settingsPath}.legacy-backup`)).toBe(false)
    expect(existsSync(secretsPath)).toBe(false)
  })

  it('does not expose unavailable Genspark models when the user is signed out', async () => {
    const { service } = fixture()
    const settings = service.getPublicSettings()
    expect(settings.providers.find((provider) => provider.id === 'genspark')?.status).toBe(
      'unavailable',
    )
    await expect(service.listModels()).resolves.toEqual({ models: [], catalogs: [] })
  })

  it('returns keyless legacy compatibility settings', () => {
    const { service } = fixture()
    const settings = service.getLegacyPublicSettings()
    expect(settings.provider).toBe('codex') // fresh installs default to Codex (spec 2026-10-01 §5.3)
    expect(Object.values(settings.providers).every((provider) => provider.apiKey === '')).toBe(true)
  })

  it('requires reconnection instead of exposing a raw decryption failure', async () => {
    const { settingsPath, secretsPath, service } = fixture()
    writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        globalDefault: { providerId: 'openrouter', modelId: 'openai/gpt-test' },
        providers: {
          openrouter: { verifiedAt: '2026-08-03T00:00:00.000Z', usable: true },
        },
      }),
    )
    writeFileSync(
      secretsPath,
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          openrouter: Buffer.from('wrong-ciphertext', 'utf8').toString('base64'),
        },
      }),
    )

    const publicSettings = service.getPublicSettings()
    expect(publicSettings.providers.find((provider) => provider.id === 'openrouter')).toEqual(
      expect.objectContaining({
        status: 'not-configured',
        hasApiKey: false,
        verifiedAt: '2026-08-03T00:00:00.000Z',
      }),
    )
    await expect(service.listModels()).resolves.toEqual({ models: [], catalogs: [] })
    await expect(
      service.assertRouteAvailable({ providerId: 'openrouter', modelId: 'openai/gpt-test' }),
    ).rejects.toThrow('Re-enter your OpenRouter API key in AI settings')
  })

  it('rejects removing the provider used by the global default without deleting its key', () => {
    const { settingsPath, secretStore, service } = fixture()
    const secret = 'sk-or-global-default'
    writeFileSync(
      settingsPath,
      JSON.stringify({
        provider: 'openrouter',
        providers: {
          openrouter: { apiKey: secret, model: 'openai/gpt-test' },
        },
      }),
    )
    service.getPublicSettings()

    expect(() => service.removeProviderKey('openrouter')).toThrow(
      'Choose another global default before removing the OpenRouter API key',
    )
    expect(secretStore.get('openrouter')).toBe(secret)
    expect(readFileSync(settingsPath, 'utf8')).not.toContain(secret)
  })

  it('enforces image capability when validating a send route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-ai-image-route-'))
    const cipher = new TestCipher()
    const secretStore = new AiSecretStore(join(dir, 'ai-secrets.json'), cipher)
    secretStore.set('openrouter', 'sk-or-image-capability')
    const settingsPath = join(dir, 'ai-settings.json')
    writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        globalDefault: { providerId: 'openrouter', modelId: 'text-model' },
        providers: {
          openrouter: { verifiedAt: '2026-08-03T00:00:00.000Z', usable: true },
        },
      }),
    )
    const service = new AiSettingsService({
      settingsPath,
      secretStore,
      catalogs: {
        list: vi.fn(async () => ({
          catalogs: [],
          models: [
            {
              id: 'text-model',
              canonicalId: 'text-model',
              providerId: 'openrouter',
              name: 'Text model',
              expiresAt: null,
              available: true,
              capabilities: {
                inputModalities: ['text'],
                outputModalities: ['text'],
                supportsTools: true,
                contextWindow: 128_000,
                maxOutputTokens: 16_384,
              },
            },
          ],
        })),
      } as never,
      isGensparkConfigured: () => false,
    })

    await expect(
      service.assertRouteAvailable(
        { providerId: 'openrouter', modelId: 'text-model' },
        { requireImageInput: true },
      ),
    ).rejects.toThrow('does not support image input')
  })

  it('verifies and stores a GLM key and exposes its compatible models', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-ai-glm-'))
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 'glm-5.3' }, { id: 'glm-4.6' }] }), {
          status: 200,
        }),
    )
    const cipher = new TestCipher()
    const secretStore = new AiSecretStore(join(dir, 'ai-secrets.json'), cipher)
    const settingsPath = join(dir, 'ai-settings.json')
    const service = new AiSettingsService({
      settingsPath,
      secretStore,
      catalogs: new AiCatalogCache({
        cacheDir: join(dir, 'catalogs'),
        getApiKey: (providerId) => secretStore.get(providerId),
        fetch: fetchMock,
      }),
      isGensparkConfigured: () => false,
      fetch: fetchMock,
    })

    const result = await service.verifyAndSave({ providerId: 'glm', apiKey: 'glm-key' })

    expect(result.verification).toMatchObject({ ok: true, providerId: 'glm' })
    expect(result.saved).toBe(true)
    expect(result.compatibleModelCount).toBe(2)
    expect(result.settings.providers.find((provider) => provider.id === 'glm')).toMatchObject({
      id: 'glm',
      label: 'GLM',
      status: 'connected',
      hasApiKey: true,
    })
    expect(secretStore.get('glm')).toBe('glm-key')
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('glm-key')

    const models = await service.listModels()
    expect(models.models.map((model) => model.id)).toEqual(['glm-4.6', 'glm-5.3'])
  })

  it('removes a stored Kimi key that is not the global default', async () => {
    const { settingsPath, secretStore, service } = fixture()
    writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        globalDefault: { providerId: 'genspark', modelId: 'claude-opus-4-7' },
        providers: { kimi: { verifiedAt: '2026-08-03T00:00:00.000Z', usable: true } },
      }),
    )
    secretStore.set('kimi', 'kimi-key')

    const settings = service.removeProviderKey('kimi')

    expect(settings.providers.find((provider) => provider.id === 'kimi')).toMatchObject({
      status: 'not-configured',
      hasApiKey: false,
    })
    expect(secretStore.get('kimi')).toBeNull()
    expect(() => service.removeProviderKey('not-a-provider')).toThrow(
      'Provider key cannot be removed',
    )
  })
})

describe('retired DeepSeek model names', () => {
  it('reads a stored deepseek-chat default as deepseek-flash', () => {
    const { settingsPath, service } = fixture()
    writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        globalDefault: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        providers: {},
      }),
    )
    expect(service.getGlobalDefault()).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
    })
  })
})

describe('route availability against a stale model catalog', () => {
  const model = (id: string) => ({
    id,
    canonicalId: id,
    providerId: 'deepseek' as const,
    name: id,
    expiresAt: null,
    available: true,
    capabilities: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      contextWindow: null,
      maxOutputTokens: null,
    },
  })
  const build = (list: ReturnType<typeof vi.fn>) =>
    new AiSettingsService({
      settingsPath: join(mkdtempSync(join(tmpdir(), 'genoffice-ai-stale-')), 'ai-settings.json'),
      secretStore: { status: () => 'ready' } as never,
      catalogs: { list } as never,
      isGensparkConfigured: () => false,
    })

  it('refreshes the catalog once before calling a model unavailable', async () => {
    // a catalog cached before V4 still lists only the retired names until it is refreshed
    const list = vi.fn(async (_ids: unknown, _requirements: unknown, force?: boolean) => ({
      models: [model(force ? 'deepseek-flash' : 'deepseek-chat')],
      catalogs: [],
    }))
    const service = build(list)
    await expect(
      service.assertRouteAvailable({ providerId: 'deepseek', modelId: 'deepseek-flash' }),
    ).resolves.toBeUndefined()
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[1]![2]).toBe(true)
  })

  it('still reports a model that is missing after the refresh, and does not refresh a found one', async () => {
    const missing = vi.fn(async () => ({ models: [model('deepseek-flash')], catalogs: [] }))
    await expect(
      build(missing).assertRouteAvailable({ providerId: 'deepseek', modelId: 'nope' }),
    ).rejects.toThrow('nope is unavailable')
    expect(missing).toHaveBeenCalledTimes(2)

    const found = vi.fn(async () => ({ models: [model('deepseek-flash')], catalogs: [] }))
    await build(found).assertRouteAvailable({ providerId: 'deepseek', modelId: 'deepseek-flash' })
    expect(found).toHaveBeenCalledTimes(1)
  })
})
