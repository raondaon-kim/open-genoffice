import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  firstRunAiSettings,
  isUpstreamAiSettings,
  orgDefaultsView,
  parseOrgDefaults,
  readOrgDefaults,
} from '../src/main/org-defaults'

const good = { ai: { provider: 'litellm', baseUrl: 'http://proxy.internal:4000/v1', model: 'm-1' } }

describe('organization AI defaults', () => {
  it('accepts a LiteLLM proxy with a URL and a model', () => {
    expect(parseOrgDefaults(good)).toEqual({
      provider: 'litellm',
      baseUrl: 'http://proxy.internal:4000/v1',
      model: 'm-1',
    })
  })

  it('rejects anything else: other providers, bad URLs, empty models, junk', () => {
    expect(parseOrgDefaults({ ai: { ...good.ai, provider: 'openai' } })).toBeNull()
    expect(parseOrgDefaults({ ai: { ...good.ai, baseUrl: 'file:///etc/passwd' } })).toBeNull()
    expect(parseOrgDefaults({ ai: { ...good.ai, baseUrl: 'http://a b' } })).toBeNull()
    expect(parseOrgDefaults({ ai: { ...good.ai, model: '  ' } })).toBeNull()
    expect(parseOrgDefaults(null)).toBeNull()
    expect(parseOrgDefaults('x')).toBeNull()
  })

  it('reads the file next to the resources, and tolerates a missing or broken one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'org-defaults-'))
    expect(readOrgDefaults(join(dir, 'none.json'))).toBeNull()
    writeFileSync(join(dir, 'broken.json'), '{')
    expect(readOrgDefaults(join(dir, 'broken.json'))).toBeNull()
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(good))
    expect(readOrgDefaults(join(dir, 'ok.json'))?.model).toBe('m-1')
  })

  it('seeds a first run (no file) and never with a key', () => {
    const defaults = parseOrgDefaults(good)
    expect(firstRunAiSettings(undefined, null)).toBeNull()
    expect(firstRunAiSettings(undefined, defaults)).toEqual({
      provider: 'litellm',
      providers: {
        litellm: { apiKey: '', model: 'm-1', baseUrl: 'http://proxy.internal:4000/v1' },
      },
    })
  })

  it('keeps settings in upstream format and replaces ones upstream cannot read', () => {
    const defaults = parseOrgDefaults(good)
    expect(firstRunAiSettings({ provider: 'openai', providers: {} }, defaults)).toBeNull()
    // the pre-upstream fork format: no top-level provider
    const fork = { schemaVersion: 2, globalDefault: { providerId: 'deepseek' }, providers: {} }
    expect(isUpstreamAiSettings(fork)).toBe(false)
    expect(firstRunAiSettings(fork, defaults)?.provider).toBe('litellm')
    // an unreadable file parses to null and is replaced too
    expect(firstRunAiSettings(null, defaults)?.provider).toBe('litellm')
  })
})

describe('orgDefaultsView', () => {
  it('shows the renderer the address and model only', () => {
    expect(
      orgDefaultsView({
        provider: 'litellm',
        baseUrl: 'http://proxy.test:4000/v1',
        model: 'deepseek-flash',
      }),
    ).toEqual({ baseUrl: 'http://proxy.test:4000/v1', model: 'deepseek-flash' })
  })
  it('is null for a build without defaults', () => {
    expect(orgDefaultsView(null)).toBeNull()
  })
})
