import type { AiProviderId, AiSettings } from './types'

/** the three ways Settings offers to connect: the in-house proxy, a Codex login, own API keys */
export type ConnectionMode = 'litellm' | 'codex' | 'byok'

/** the model a LiteLLM connection calls unless the user or the build says otherwise */
export const LITELLM_DEFAULT_MODEL = 'deepseek-flash'

export function connectionModeOf(provider: AiProviderId): ConnectionMode {
  return provider === 'litellm' ? 'litellm' : provider === 'codex' ? 'codex' : 'byok'
}

export function isByokProvider(provider: AiProviderId): boolean {
  return provider !== 'litellm' && provider !== 'codex'
}

/** the provider own-key mode shows: the remembered one, the current one, one with a key, else Claude */
export function byokProviderOf(settings: AiSettings): AiProviderId {
  const remembered = settings.byokProvider
  if (remembered && isByokProvider(remembered)) return remembered
  if (isByokProvider(settings.provider)) return settings.provider
  const withKey = (Object.keys(settings.providers) as AiProviderId[]).find(
    (id) => isByokProvider(id) && id !== 'genspark' && !!settings.providers[id]?.apiKey?.trim(),
  )
  return withKey ?? 'anthropic'
}

/** settings with another mode selected; no provider's own config is touched */
export function withConnectionMode(settings: AiSettings, mode: ConnectionMode): AiSettings {
  const remembered = isByokProvider(settings.provider) ? settings.provider : settings.byokProvider
  const next: AiSettings = {
    ...settings,
    provider: mode === 'litellm' ? 'litellm' : mode === 'codex' ? 'codex' : settings.provider,
  }
  if (remembered && isByokProvider(remembered)) next.byokProvider = remembered
  if (mode === 'byok') next.provider = byokProviderOf(next)
  // cloud tools cannot be off with genspark (chat runs through gsk anyway)
  if (next.provider === 'genspark') next.gskToolsEnabled = true
  return next
}

/**
 * The model for a LiteLLM connection once the proxy's list is known: a model that is on the list
 * stays, else DeepSeek (`deepseek-flash`), else any DeepSeek id, else the first id. An empty list
 * (not loaded yet, or the proxy did not answer) changes nothing: a guess made then would be pinned
 * into the picker and survive the real list.
 */
export function chooseLitellmModel(models: string[], current: string): string {
  if (models.length === 0) return current
  if (current && models.includes(current)) return current
  if (models.includes(LITELLM_DEFAULT_MODEL)) return LITELLM_DEFAULT_MODEL
  return models.find((m) => /deepseek/i.test(m)) ?? models[0]!
}
