import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  firstRunAiSettings,
  isUpstreamAiSettings,
  lockOrgLitellmModel,
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

describe('startup', () => {
  it('rewrites a stored LiteLLM model to the company build one when there is nothing to seed', async () => {
    const { readFileSync } = await import('node:fs')
    const index = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    const block = index.slice(index.indexOf('const orgDefaultsPath = app.isPackaged'))
    const head = block.slice(0, block.indexOf('\n}\n'))
    expect(head).toMatch(/lockOrgLitellmModel\(existing, orgDefaults\)/)
    expect(head).toMatch(/writeFileSync\(aiSettingsPath, JSON\.stringify\(locked, null, 2\)\)/)
  })
})

describe('lockOrgLitellmModel', () => {
  const defaults = {
    provider: 'litellm' as const,
    baseUrl: 'http://proxy.internal:4000/v1',
    model: 'm-1',
  }

  it('rewrites a stored LiteLLM model that is not the build one, keeping the rest', () => {
    const existing = {
      provider: 'litellm',
      maxOutputTokens: 9000,
      providers: {
        litellm: { apiKey: 'k', model: 'gpt-5', baseUrl: 'http://proxy.internal:4000/v1' },
        anthropic: { apiKey: 'a', model: 'claude' },
      },
    }
    expect(lockOrgLitellmModel(existing, defaults)).toEqual({
      ...existing,
      providers: {
        ...existing.providers,
        litellm: { ...existing.providers.litellm, model: 'm-1' },
      },
    })
  })

  it('leaves settings alone that already use the build model or have no LiteLLM entry', () => {
    expect(
      lockOrgLitellmModel(
        { provider: 'litellm', providers: { litellm: { apiKey: '', model: 'm-1' } } },
        defaults,
      ),
    ).toBeNull()
    expect(lockOrgLitellmModel({ provider: 'anthropic', providers: {} }, defaults)).toBeNull()
  })

  it('does nothing in an open build or for unreadable settings', () => {
    expect(
      lockOrgLitellmModel({ provider: 'litellm', providers: { litellm: { model: 'x' } } }, null),
    ).toBeNull()
    expect(lockOrgLitellmModel(undefined, defaults)).toBeNull()
    expect(lockOrgLitellmModel('junk', defaults)).toBeNull()
  })
})
