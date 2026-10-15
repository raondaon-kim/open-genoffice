import { describe, expect, it } from 'vitest'
import {
  byokProviderOf,
  chooseLitellmModel,
  connectionModeOf,
  isByokProvider,
  LITELLM_DEFAULT_MODEL,
  withConnectionMode,
} from '../src/connection-modes'
import { defaultAiSettings } from '../src/providers'

describe('connection modes', () => {
  it('derives the mode from the provider', () => {
    expect(connectionModeOf('litellm')).toBe('litellm')
    expect(connectionModeOf('codex')).toBe('codex')
    for (const p of ['anthropic', 'openai', 'deepseek', 'genspark', 'custom'] as const) {
      expect(connectionModeOf(p)).toBe('byok')
    }
    expect(isByokProvider('litellm')).toBe(false)
    expect(isByokProvider('codex')).toBe(false)
    expect(isByokProvider('gemini')).toBe(true)
  })

  it('remembers the own-key provider across a trip through the other modes', () => {
    const base = defaultAiSettings()
    base.provider = 'openai'
    base.providers.openai = { apiKey: 'k', model: 'gpt-5.6-terra' }
    const inLitellm = withConnectionMode(base, 'litellm')
    expect(inLitellm.provider).toBe('litellm')
    expect(inLitellm.byokProvider).toBe('openai')
    const inCodex = withConnectionMode(inLitellm, 'codex')
    expect(inCodex.provider).toBe('codex')
    expect(inCodex.byokProvider).toBe('openai')
    const back = withConnectionMode(inCodex, 'byok')
    expect(back.provider).toBe('openai')
    // nothing a provider holds is cleared by switching
    expect(back.providers.openai).toEqual({ apiKey: 'k', model: 'gpt-5.6-terra' })
  })

  it('picks a provider for own-key mode when none is remembered', () => {
    const s = defaultAiSettings()
    s.provider = 'litellm'
    s.providers.gemini = { apiKey: 'g', model: 'gemini-3.8-flash' }
    expect(byokProviderOf(s)).toBe('gemini')
    const none = defaultAiSettings()
    none.provider = 'codex'
    expect(byokProviderOf(none)).toBe('anthropic')
    s.byokProvider = 'litellm' // never a valid remembered own-key provider
    expect(byokProviderOf(s)).toBe('gemini')
  })

  it('keeps genspark cloud tools on when it becomes the provider', () => {
    const s = defaultAiSettings()
    s.provider = 'litellm'
    s.byokProvider = 'genspark'
    s.gskToolsEnabled = false
    expect(withConnectionMode(s, 'byok')).toMatchObject({
      provider: 'genspark',
      gskToolsEnabled: true,
    })
  })

  it('chooses the LiteLLM model: keep a valid one, else deepseek-flash, else any deepseek, else the first', () => {
    expect(LITELLM_DEFAULT_MODEL).toBe('deepseek-flash')
    const list = ['gpt-5', 'deepseek-flash', 'deepseek-v4-pro']
    expect(chooseLitellmModel(list, 'gpt-5')).toBe('gpt-5')
    expect(chooseLitellmModel(list, '')).toBe('deepseek-flash')
    expect(chooseLitellmModel(list, 'gone')).toBe('deepseek-flash')
    expect(chooseLitellmModel(['gpt-5', 'deepseek-v4-pro'], '')).toBe('deepseek-v4-pro')
    expect(chooseLitellmModel(['gpt-5', 'claude-x'], '')).toBe('gpt-5')
  })

  it('does not wipe the model when the list is empty', () => {
    expect(chooseLitellmModel([], 'typed-by-hand')).toBe('typed-by-hand')
    expect(chooseLitellmModel([], '')).toBe('deepseek-flash')
  })
})
