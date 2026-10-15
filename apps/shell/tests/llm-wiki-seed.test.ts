import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getProviderAdapter } from '@genoffice/ai-provider'
import type { AiSettings } from '@genoffice/ai-provider'
import { describe, expect, it } from 'vitest'
import {
  ensureProjectId,
  llmWikiLlmFromAiSettings,
  readAppState,
  seedAppState,
  writeAppState,
} from '../src/main/llm-wiki-seed'

const settings = (provider: string, config: Record<string, unknown>): AiSettings =>
  ({ provider, providers: { [provider]: config } }) as unknown as AiSettings

describe('llmWikiLlmFromAiSettings', () => {
  it("maps an OpenAI-compatible provider to LLM Wiki's custom endpoint", () => {
    const cfg = { apiKey: 'k', model: 'deep-seek-v4.1-flash' }
    const r = llmWikiLlmFromAiSettings(settings('deepseek', cfg))
    const base = getProviderAdapter('deepseek').resolveEndpoint(cfg as never).baseUrl
    expect(r).toMatchObject({
      ok: true,
      llm: {
        provider: 'custom',
        apiKey: 'k',
        model: 'deep-seek-v4.1-flash',
        customEndpoint: base,
        apiMode: 'chat_completions',
      },
    })
  })

  it('uses the configured base URL of a custom or LiteLLM endpoint', () => {
    const r = llmWikiLlmFromAiSettings(
      settings('litellm', {
        apiKey: 'k',
        model: 'deepseek-v4-flash',
        baseUrl: 'http://proxy.test:4000/v1',
      }),
    )
    expect(r).toMatchObject({
      ok: true,
      llm: { provider: 'custom', customEndpoint: 'http://proxy.test:4000/v1' },
    })
  })

  it('maps Anthropic and Gemini to their own providers', () => {
    expect(
      llmWikiLlmFromAiSettings(settings('anthropic', { apiKey: 'k', model: 'claude-x' })),
    ).toMatchObject({ ok: true, llm: { provider: 'anthropic', apiMode: 'anthropic_messages' } })
    expect(
      llmWikiLlmFromAiSettings(settings('gemini', { apiKey: 'k', model: 'gemini-x' })),
    ).toMatchObject({ ok: true, llm: { provider: 'google' } })
  })

  it('refuses what LLM Wiki cannot use: the Codex bridge, a missing key or model', () => {
    expect(llmWikiLlmFromAiSettings(settings('codex', { apiKey: '', model: 'x' }))).toMatchObject({
      ok: false,
    })
    expect(
      llmWikiLlmFromAiSettings(settings('deepseek', { apiKey: '', model: 'm' })),
    ).toMatchObject({ ok: false })
    expect(
      llmWikiLlmFromAiSettings(settings('deepseek', { apiKey: 'k', model: '' })),
    ).toMatchObject({ ok: false })
  })
})

describe('seedAppState', () => {
  const llm = {
    provider: 'custom',
    apiKey: 'k',
    model: 'm',
    customEndpoint: 'http://x/v1',
    ollamaUrl: 'http://localhost:11434',
    maxContextSize: 64000,
    apiMode: 'chat_completions',
  } as const
  const input = {
    projectId: 'p-1',
    wikiRoot: 'C:\\Users\\u\\Documents\\GenOffice 업무위키',
    projectName: '업무 위키',
    llm,
    now: 1700000000000,
  }

  it('points LLM Wiki at the wiki folder and the GenOffice model, and keeps every other key', () => {
    const existing = {
      proxyConfig: { enabled: false },
      embeddingConfig: { enabled: true },
      apiConfig: { token: 'old', enabled: false, allowUnauthenticated: true },
      recentProjects: [{ id: 'other', name: 'o', path: 'D:/o' }],
      sourceWatchConfig: { other: { enabled: false } },
      activePresetId: 'deepseek',
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = seedAppState(existing, input) as Record<string, any>
    expect(s.proxyConfig).toEqual({ enabled: false })
    expect(s.embeddingConfig).toEqual({ enabled: true })
    expect(s.lastProject).toEqual({
      id: 'p-1',
      name: '업무 위키',
      path: 'C:/Users/u/Documents/GenOffice 업무위키',
    })
    expect(s.projectRegistry['p-1']).toMatchObject({
      id: 'p-1',
      path: 'C:/Users/u/Documents/GenOffice 업무위키',
      lastOpened: 1700000000000,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(s.recentProjects.map((p: any) => p.id)).toEqual(['p-1', 'other'])
    expect(s.llmConfig).toMatchObject({
      provider: 'custom',
      apiKey: 'k',
      customEndpoint: 'http://x/v1',
    })
    expect(s.activePresetId).toBeNull()
    expect(s.apiConfig).toMatchObject({ enabled: true, allowUnauthenticated: false, token: 'old' })
    expect(s.sourceWatchConfig['p-1']).toMatchObject({ enabled: true, autoIngest: true })
    expect(s.sourceWatchConfig.other).toEqual({ enabled: false })
    expect(s.projectOutputLanguages['p-1']).toBe('Korean')
  })

  it('does not duplicate the project in the recent list, and leaves llmConfig alone without a usable model', () => {
    const first = seedAppState({}, input)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const again = seedAppState(first, { ...input, llm: null }) as Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(again.recentProjects.filter((p: any) => p.id === 'p-1')).toHaveLength(1)
    expect(again.llmConfig).toMatchObject({ apiKey: 'k' })
  })
})

describe('project id and app-state files', () => {
  it('creates the project id once and keeps it', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    const a = ensureProjectId(root)
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(ensureProjectId(root)).toBe(a)
    expect(JSON.parse(readFileSync(join(root, '.llm-wiki', 'project.json'), 'utf8')).id).toBe(a)
  })

  it('repairs an unreadable project.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    mkdirSync(join(root, '.llm-wiki'))
    writeFileSync(join(root, '.llm-wiki', 'project.json'), '{broken')
    expect(ensureProjectId(root)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('writes app-state.json atomically and reads it back; a missing or broken file reads as empty', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ww-')), 'com.opengenoffice.llmwiki')
    expect(readAppState(dir)).toEqual({})
    writeAppState(dir, { a: 1 })
    expect(readAppState(dir)).toEqual({ a: 1 })
    writeFileSync(join(dir, 'app-state.json'), 'nope')
    expect(readAppState(dir)).toEqual({})
  })
})
