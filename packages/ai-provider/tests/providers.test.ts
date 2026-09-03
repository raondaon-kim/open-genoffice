import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  OPENAI_COMPATIBLE_BASE_URLS,
  defaultAiSettings,
  resolveAiSettings,
} from '../src/providers'

describe('defaultAiSettings', () => {
  it('gives every provider its default model and an empty key by default', () => {
    const settings = defaultAiSettings()
    expect(settings.provider).toBe('genspark')
    for (const meta of AI_PROVIDERS) {
      expect(settings.providers[meta.id].apiKey).toBe('')
      expect(settings.providers[meta.id].model).toBe(meta.defaultModel)
    }
    expect(settings.providers.custom.baseUrl).toBe('')
    expect(settings.providers.anthropic.baseUrl).toBeUndefined()
  })

  it('applies caller-supplied default keys only to the listed providers', () => {
    const settings = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(settings.providers.anthropic.apiKey).toBe('sk-ant-preset')
    expect(settings.providers.gemini.apiKey).toBe('')
  })

  it('defines OpenRouter as a first-class remote OpenAI-compatible provider', () => {
    const openRouter = AI_PROVIDERS.find((provider) => provider.id === 'openrouter')
    expect(openRouter).toMatchObject({
      label: 'OpenRouter',
      protocol: 'openai-compatible',
      auth: 'bearer-key',
      modelSource: 'remote',
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      models: [],
      defaultModel: '',
    })
    expect(defaultAiSettings().providers.openrouter).toEqual({
      apiKey: '',
      model: '',
      baseUrl: undefined,
    })
  })
})

describe('resolveAiSettings', () => {
  it('returns fresh defaults when nothing is stored', () => {
    const defaults = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(resolveAiSettings({}, defaults)).toEqual(defaults)
  })

  it('migrates the pre-provider single-endpoint shape into the custom provider', () => {
    const defaults = defaultAiSettings()
    const resolved = resolveAiSettings(
      { apiKey: 'legacy-key', model: 'legacy-model', baseUrl: 'https://legacy.example.com/v1' },
      defaults,
    )
    expect(resolved.providers.custom).toEqual({
      apiKey: 'legacy-key',
      model: 'legacy-model',
      baseUrl: 'https://legacy.example.com/v1',
    })
    // untouched providers keep their defaults
    expect(resolved.providers.anthropic).toEqual(defaults.providers.anthropic)
  })

  it('defaults the legacy base URL to the OpenAI endpoint when omitted', () => {
    const resolved = resolveAiSettings({ apiKey: 'legacy-key' }, defaultAiSettings())
    expect(resolved.providers.custom.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('merges stored multi-provider settings over the defaults, provider by provider', () => {
    const defaults = defaultAiSettings({ anthropic: 'preset-key' })
    const resolved = resolveAiSettings(
      {
        provider: 'gemini',
        providers: {
          gemini: { apiKey: 'stored-gemini-key', model: 'gemini-2.5-pro' },
        } as never,
      },
      defaults,
    )
    expect(resolved.provider).toBe('gemini')
    expect(resolved.providers.gemini).toEqual({
      apiKey: 'stored-gemini-key',
      model: 'gemini-2.5-pro',
    })
    // provider not mentioned in stored.providers keeps the computed default
    expect(resolved.providers.anthropic.apiKey).toBe('preset-key')
  })
})

describe('bring-your-own-key OpenAI-compatible providers', () => {
  it.each([
    {
      id: 'deepseek',
      label: 'DeepSeek',
      defaultBaseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
    },
    {
      id: 'glm',
      label: 'GLM',
      defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
      defaultModel: 'glm-5.3',
    },
    {
      id: 'kimi',
      label: 'Kimi',
      defaultBaseUrl: 'https://api.moonshot.ai/v1',
      defaultModel: 'kimi-k3',
    },
    {
      id: 'minimax',
      label: 'MiniMax',
      defaultBaseUrl: 'https://api.minimax.io/v1',
      defaultModel: 'MiniMax-M2.1',
    },
  ] as const)('registers $id as a static bearer-key provider', (meta) => {
    const provider = AI_PROVIDERS.find((candidate) => candidate.id === meta.id)
    expect(provider).toMatchObject({
      label: meta.label,
      protocol: 'openai-compatible',
      auth: 'bearer-key',
      modelSource: 'static',
      defaultBaseUrl: meta.defaultBaseUrl,
      defaultModel: meta.defaultModel,
    })
    expect(provider!.models.length).toBeGreaterThan(0)
    expect(provider!.models).toContain(meta.defaultModel)
    expect(defaultAiSettings().providers[meta.id].apiKey).toBe('')
  })

  it('exposes every fixed OpenAI-compatible provider base URL from one map', () => {
    expect(OPENAI_COMPATIBLE_BASE_URLS).toMatchObject({
      deepseek: 'https://api.deepseek.com/v1',
      glm: 'https://api.z.ai/api/paas/v4',
      kimi: 'https://api.moonshot.ai/v1',
      minimax: 'https://api.minimax.io/v1',
      openai: 'https://api.openai.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
    })
    // the manual base-URL provider is deliberately absent
    expect(OPENAI_COMPATIBLE_BASE_URLS.custom).toBeUndefined()
  })
})
