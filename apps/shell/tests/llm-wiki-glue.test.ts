import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desiredSignature, llmWikiExePath } from '../src/main/llm-wiki'

describe('llmWikiExePath', () => {
  it('finds the installed copy under resources, then the dev build, else null', () => {
    const res = mkdtempSync(join(tmpdir(), 'res-'))
    const dev = mkdtempSync(join(tmpdir(), 'dev-'))
    expect(llmWikiExePath(res, dev)).toBeNull()
    mkdirSync(join(dev, 'llm-wiki'), { recursive: true })
    writeFileSync(join(dev, 'llm-wiki', 'llm-wiki.exe'), 'x')
    expect(llmWikiExePath(undefined, dev)).toBe(join(dev, 'llm-wiki', 'llm-wiki.exe'))
    mkdirSync(join(res, 'llm-wiki'), { recursive: true })
    writeFileSync(join(res, 'llm-wiki', 'llm-wiki.exe'), 'x')
    expect(llmWikiExePath(res, dev)).toBe(join(res, 'llm-wiki', 'llm-wiki.exe'))
  })
})

describe('desiredSignature', () => {
  const llm = {
    provider: 'custom',
    apiKey: 'sk-secret-123',
    model: 'm',
    customEndpoint: 'http://x/v1',
    ollamaUrl: '',
    maxContextSize: 64000,
    apiMode: 'chat_completions',
  } as const
  it('changes with the model, key, endpoint and wiki folder, not with anything else', () => {
    const base = desiredSignature(llm, 'D:/wiki')
    expect(desiredSignature({ ...llm }, 'D:/wiki')).toBe(base)
    expect(desiredSignature({ ...llm, apiKey: 'sk-other-456' }, 'D:/wiki')).not.toBe(base)
    expect(desiredSignature({ ...llm, model: 'm2' }, 'D:/wiki')).not.toBe(base)
    expect(desiredSignature({ ...llm, customEndpoint: 'http://y/v1' }, 'D:/wiki')).not.toBe(base)
    expect(desiredSignature(llm, 'D:/other')).not.toBe(base)
    expect(desiredSignature(null, 'D:/wiki')).not.toBe(base)
  })
  it('does not contain the API key in clear text', () => {
    expect(desiredSignature(llm, 'D:/wiki')).not.toContain('sk-secret-123')
  })
})
