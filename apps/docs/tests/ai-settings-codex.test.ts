import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiCatalogCache } from '../src/main/ai-catalog-cache'
import { AiSecretStore, type SecretCipher } from '../src/main/ai-secret-store'
import { AiSettingsService } from '../src/main/ai-settings-service'
import { CodexProvider } from '../src/main/codex-provider'

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(`e:${value}`),
  decrypt: (value) => value.toString().slice(2),
}

function fixture(account: unknown, models = ['gpt-6.1-sol', 'gpt-5.6-luna']) {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-ai-codex-'))
  const settingsPath = join(dir, 'ai-settings.json')
  const codex = new CodexProvider({
    withRpc: async (_path, action) =>
      action({
        userAgent: 'genoffice/0.159.3',
        request: async () => ({ account }),
        onNotification: () => () => undefined,
      }),
    listModels: vi.fn(async () => ({ models, defaultModel: models[0] ?? '' })),
    resolveBinary: async () => ({ path: 'x', source: 'bundled' as const }),
  })
  const secretStore = new AiSecretStore(join(dir, 'ai-secrets.json'), cipher)
  const catalogs = new AiCatalogCache({
    cacheDir: join(dir, 'catalogs'),
    getApiKey: (providerId) => secretStore.get(providerId),
    fetch: vi.fn(),
    codexModels: () => codex.listModels(),
  })
  const service = new AiSettingsService({
    settingsPath,
    secretStore,
    catalogs,
    isGensparkConfigured: () => false,
    codex,
  })
  return { settingsPath, service, codex }
}

const signedIn = { type: 'chatgpt', email: 'a@b.com', planType: 'prolite' }

describe('AiSettingsService + Codex', () => {
  it('defaults a fresh install to Codex gpt-5.6-luna', () => {
    const { service } = fixture(signedIn)
    expect(service.getGlobalDefault()).toEqual({ providerId: 'codex', modelId: 'gpt-5.6-luna' })
  })

  it('keeps an existing user default untouched', () => {
    const { settingsPath, service } = fixture(signedIn)
    writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        globalDefault: { providerId: 'openai', modelId: 'gpt-4.1-mini' },
        providers: {},
      }),
    )
    expect(service.getGlobalDefault()).toEqual({ providerId: 'openai', modelId: 'gpt-4.1-mini' })
  })

  it('lists the signed-in account models and shows Codex as connected with email and plan', async () => {
    const { service } = fixture(signedIn)
    const result = await service.listModels()
    // the catalog orders models itself; only membership matters here
    expect(
      result.models
        .filter((m) => m.providerId === 'codex')
        .map((m) => m.id)
        .sort(),
    ).toEqual(['gpt-5.6-luna', 'gpt-6.1-sol'])
    expect(service.getPublicSettings().providers.find((p) => p.id === 'codex')).toMatchObject({
      status: 'connected',
      accountLabel: 'a@b.com',
      planType: 'prolite',
      hasApiKey: false,
    })
  })

  it('hides Codex models and points to Settings when the account is signed out', async () => {
    const { service } = fixture(null)
    const result = await service.listModels()
    expect(result.models.some((m) => m.providerId === 'codex')).toBe(false)
    expect(service.getPublicSettings().providers.find((p) => p.id === 'codex')?.status).toBe(
      'not-configured',
    )
    await expect(
      service.assertRouteAvailable({ providerId: 'codex', modelId: 'gpt-5.6-luna' }),
    ).rejects.toThrow(/Sign in to Codex in Settings › AI/)
  })

  it('falls back to the account default model when gpt-5.6-luna is not offered', async () => {
    const { service } = fixture(signedIn, ['gpt-6.1-sol', 'gpt-5.5'])
    await service.listModels()
    expect(service.getGlobalDefault()).toEqual({ providerId: 'codex', modelId: 'gpt-6.1-sol' })
  })

  it('gives the bridge a key-less config with the custom binary path', async () => {
    const { service, codex } = fixture(signedIn)
    service.setCodexCliPath('D:\\tools\\codex.exe')
    expect(codex.cliPath()).toBe('D:\\tools\\codex.exe')
    expect(
      service.getProviderConfig({ providerId: 'codex', modelId: 'gpt-5.6-luna' }, () => ''),
    ).toEqual({
      apiKey: '',
      model: 'gpt-5.6-luna',
      cliPath: 'D:\\tools\\codex.exe',
    })
  })

  it('persists the custom path and restores it into the shared provider', () => {
    const first = fixture(signedIn)
    first.service.setCodexCliPath('  D:\\tools\\codex.exe  ')
    const saved = JSON.parse(readFileSync(first.settingsPath, 'utf8'))
    expect(saved.providers.codex).toEqual({ cliPath: 'D:\\tools\\codex.exe' })
    first.service.setCodexCliPath('')
    expect(JSON.parse(readFileSync(first.settingsPath, 'utf8')).providers.codex).toBeUndefined()
    expect(first.codex.cliPath()).toBeUndefined()
  })

  it('rejects removing a Codex "key" — sign-out is the Codex way', () => {
    const { service } = fixture(signedIn)
    expect(() => service.removeProviderKey('codex')).toThrow(/cannot be removed/)
  })
})
