import { existsSync, readFileSync } from 'node:fs'

/**
 * Organization defaults for a company build: the in-house LiteLLM proxy as the AI provider of a
 * new install. The values are not in the source: a build writes them to org-defaults.json next to
 * the app resources (OPEN_GENOFFICE_LITELLM_URL / _MODEL at packaging time), so the same code
 * ships without any internal address.
 *
 * Only a first run is seeded: when ai-settings.json already exists the user's choices win.
 * The per-user virtual key is never part of the defaults; the user enters it in Settings › AI.
 */

export interface OrgAiDefaults {
  provider: 'litellm'
  baseUrl: string
  model: string
}

const MAX_FIELD = 300

/** org-defaults.json -> the AI defaults it carries, or null when absent or unusable */
export function parseOrgDefaults(raw: unknown): OrgAiDefaults | null {
  if (!raw || typeof raw !== 'object') return null
  const ai = (raw as { ai?: unknown }).ai
  if (!ai || typeof ai !== 'object') return null
  const { provider, baseUrl, model } = ai as Record<string, unknown>
  if (provider !== 'litellm') return null
  if (typeof baseUrl !== 'string' || typeof model !== 'string') return null
  const url = baseUrl.trim()
  if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > MAX_FIELD) return null
  const id = model.trim()
  if (!id || id.length > MAX_FIELD) return null
  return { provider, baseUrl: url, model: id }
}

export function readOrgDefaults(path: string): OrgAiDefaults | null {
  if (!existsSync(path)) return null
  try {
    return parseOrgDefaults(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

/**
 * The ai-settings.json a first run starts from, or null when nothing should be written
 * (settings already exist, or the build carries no defaults). The settings readers merge this
 * partial file over their own defaults.
 */
export function firstRunAiSettings(
  settingsExist: boolean,
  defaults: OrgAiDefaults | null,
): Record<string, unknown> | null {
  if (settingsExist || !defaults) return null
  return {
    provider: defaults.provider,
    providers: {
      [defaults.provider]: { apiKey: '', model: defaults.model, baseUrl: defaults.baseUrl },
    },
  }
}
