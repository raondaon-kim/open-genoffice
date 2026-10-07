import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { firstRunAiSettings, parseOrgDefaults, readOrgDefaults } from '../src/main/org-defaults'

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

  it('seeds only a first run, and never with a key', () => {
    const defaults = parseOrgDefaults(good)
    expect(firstRunAiSettings(true, defaults)).toBeNull()
    expect(firstRunAiSettings(false, null)).toBeNull()
    expect(firstRunAiSettings(false, defaults)).toEqual({
      provider: 'litellm',
      providers: {
        litellm: { apiKey: '', model: 'm-1', baseUrl: 'http://proxy.internal:4000/v1' },
      },
    })
  })
})
