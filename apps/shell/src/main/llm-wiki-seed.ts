import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getProviderAdapter } from '@genoffice/ai-provider'
import type { AiSettings } from '@genoffice/ai-provider'

export interface LlmWikiLlm {
  provider: 'custom' | 'anthropic' | 'google'
  apiKey: string
  model: string
  customEndpoint: string
  ollamaUrl: string
  maxContextSize: number
  apiMode: 'chat_completions' | 'anthropic_messages'
}

const MAX_CONTEXT = 64000

/** GenOffice's AI settings as LLM Wiki's llmConfig, or why it cannot use them */
export function llmWikiLlmFromAiSettings(
  settings: AiSettings,
): { ok: true; llm: LlmWikiLlm } | { ok: false; reason: string } {
  const provider = settings.provider
  const config = settings.providers?.[provider]
  if (!config) return { ok: false, reason: 'no AI provider is configured' }
  const endpoint = getProviderAdapter(provider).resolveEndpoint(config)
  if (endpoint.protocol === 'codex-app-server') {
    return { ok: false, reason: 'the Codex bridge cannot be used by LLM Wiki' }
  }
  if (!config.apiKey) return { ok: false, reason: 'no API key is set' }
  if (!config.model) return { ok: false, reason: 'no model is set' }
  const base = {
    apiKey: config.apiKey,
    // the id the vendor serves (e.g. deepseek-flash), not GenOffice's display spelling
    model: endpoint.model ?? config.model,
    ollamaUrl: 'http://localhost:11434',
    maxContextSize: MAX_CONTEXT,
  }
  if (endpoint.protocol === 'anthropic') {
    return {
      ok: true,
      llm: { ...base, provider: 'anthropic', customEndpoint: '', apiMode: 'anthropic_messages' },
    }
  }
  if (endpoint.protocol === 'gemini') {
    return {
      ok: true,
      llm: { ...base, provider: 'google', customEndpoint: '', apiMode: 'chat_completions' },
    }
  }
  return {
    ok: true,
    llm: {
      ...base,
      provider: 'custom',
      customEndpoint: endpoint.baseUrl,
      apiMode: 'chat_completions',
    },
  }
}

export interface SeedInput {
  projectId: string
  wikiRoot: string
  projectName: string
  llm: LlmWikiLlm | null
  now: number
}

const slashes = (p: string) => p.replace(/\\/g, '/')
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** LLM Wiki's settings pointed at the wiki folder and the GenOffice model; every other key stays as it was */
export function seedAppState(
  existing: Record<string, unknown>,
  input: SeedInput,
): Record<string, unknown> {
  const path = slashes(input.wikiRoot)
  const project = { id: input.projectId, name: input.projectName, path }
  const others = (Array.isArray(existing.recentProjects) ? existing.recentProjects : []).filter(
    (p) => obj(p).id !== input.projectId,
  )
  const watch = obj(existing.sourceWatchConfig)
  const languages = obj(existing.projectOutputLanguages)
  const next: Record<string, unknown> = {
    ...existing,
    lastProject: project,
    recentProjects: [project, ...others].slice(0, 10),
    projectRegistry: {
      ...obj(existing.projectRegistry),
      [input.projectId]: { ...project, lastOpened: input.now },
    },
    apiConfig: { ...obj(existing.apiConfig), enabled: true, allowUnauthenticated: false },
    sourceWatchConfig: {
      ...watch,
      [input.projectId]: { ...obj(watch[input.projectId]), enabled: true, autoIngest: true },
    },
    projectOutputLanguages: { ...languages, [input.projectId]: 'Korean' },
  }
  if (input.llm) {
    next.llmConfig = { ...obj(existing.llmConfig), ...input.llm }
    next.activePresetId = null
  }
  return next
}

/** the id LLM Wiki keeps in <project>/.llm-wiki/project.json; created once */
export function ensureProjectId(wikiRoot: string): string {
  const file = join(wikiRoot, '.llm-wiki', 'project.json')
  try {
    const id = obj(JSON.parse(readFileSync(file, 'utf8'))).id
    if (typeof id === 'string' && id) return id
  } catch {
    // missing or unreadable: written below
  }
  const id = randomUUID()
  mkdirSync(join(wikiRoot, '.llm-wiki'), { recursive: true })
  writeFileSync(file, JSON.stringify({ id, createdAt: Date.now() }), 'utf8')
  return id
}

export function readAppState(dir: string): Record<string, unknown> {
  try {
    return obj(JSON.parse(readFileSync(join(dir, 'app-state.json'), 'utf8')))
  } catch {
    return {}
  }
}

export function writeAppState(dir: string, state: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'app-state.json')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, file)
}
