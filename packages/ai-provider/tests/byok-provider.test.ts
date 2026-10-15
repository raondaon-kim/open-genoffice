import { describe, expect, it } from 'vitest'
import { sanitizeAiSettings } from '../src/ai-settings-guard'
import { defaultAiSettings, resolveAiSettings } from '../src/providers'

const payload = (byokProvider: unknown) => ({
  provider: 'litellm',
  byokProvider,
  providers: {
    litellm: { apiKey: 'k', model: 'deepseek-flash', baseUrl: 'http://proxy.test:4000/v1' },
  },
})

describe('byokProvider', () => {
  it('is kept by the schema check when it names an own-key provider', () => {
    expect(sanitizeAiSettings(payload('openai'))?.byokProvider).toBe('openai')
  })

  it('is dropped when it is litellm, codex, unknown or not a string', () => {
    for (const bad of ['litellm', 'codex', 'nope', 7, null, {}]) {
      expect(sanitizeAiSettings(payload(bad))?.byokProvider).toBeUndefined()
    }
  })

  it('is read back from a stored file, with the same rule', () => {
    const ok = resolveAiSettings(payload('gemini'), defaultAiSettings())
    expect(ok.byokProvider).toBe('gemini')
    const bad = resolveAiSettings(payload('codex'), defaultAiSettings())
    expect(bad.byokProvider).toBeUndefined()
  })
})
