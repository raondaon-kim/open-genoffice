import type { AiProviderId, AiProviderMeta, AiSettings, LegacyAiSettings } from './types'

/**
 * Genspark server-side LLM proxy endpoints. All three protocols share the
 * api_key from the gsk login; model ids follow the proxy's own naming scheme,
 * which differs from the official vendor ids.
 */
export const GENSPARK_LLM_BASE_URLS = {
  anthropic: 'https://www.genspark.ai/api/anthropic',
  gemini: 'https://www.genspark.ai/api/llm_proxy/gemini/v1beta',
  openai: 'https://www.genspark.ai/api/llm_proxy/v1',
} as const

export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1'

export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    id: 'genspark',
    label: 'Genspark',
    protocol: 'genspark',
    auth: 'genspark-login',
    modelSource: 'static',
    models: [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'gpt-5.2',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
    ],
    defaultModel: 'claude-opus-4-7',
    keyPlaceholder: 'Not required - sign in to Genspark',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai-compatible',
    auth: 'bearer-key',
    modelSource: 'remote',
    defaultBaseUrl: OPENROUTER_API_BASE_URL,
    models: [],
    defaultModel: '',
    keyPlaceholder: 'sk-or-v1-...',
  },
  {
    id: 'anthropic',
    label: 'Claude',
    protocol: 'anthropic',
    auth: 'anthropic-key',
    modelSource: 'remote',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: [
      'claude-sonnet-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929',
    ],
    defaultModel: 'claude-opus-4-7',
    keyPlaceholder: 'sk-ant-api03-...',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    protocol: 'gemini',
    auth: 'gemini-key',
    modelSource: 'static',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-compatible',
    auth: 'bearer-key',
    modelSource: 'static',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'glm',
    label: 'GLM',
    protocol: 'openai-compatible',
    auth: 'bearer-key',
    modelSource: 'static',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    models: [
      'glm-5.3',
      'glm-5.1',
      'glm-4.7',
      'glm-4.6',
      'glm-4.5',
      'glm-4.5-air',
      'glm-4.5-flash',
    ],
    defaultModel: 'glm-5.3',
    keyPlaceholder: '<id>.<secret>',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    protocol: 'openai-compatible',
    auth: 'bearer-key',
    modelSource: 'static',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    models: [
      'kimi-k3',
      'kimi-k2.7-code-highspeed',
      'kimi-k2.6',
      'kimi-k2.5',
      'kimi-k2-0905-preview',
    ],
    defaultModel: 'kimi-k3',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    protocol: 'openai-compatible',
    auth: 'bearer-key',
    modelSource: 'static',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    models: [
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    defaultModel: 'MiniMax-M2.1',
    keyPlaceholder: 'eyJ…',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    auth: 'bearer-key',
    modelSource: 'remote',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    defaultModel: 'gpt-4.1-mini',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'custom',
    label: 'Custom',
    protocol: 'openai-compatible',
    auth: 'bearer-key',
    modelSource: 'manual',
    models: [],
    defaultModel: '',
    keyPlaceholder: 'API Key',
    needsBaseUrl: true,
  },
]

/**
 * Base URLs for providers that speak the OpenAI chat-completions protocol
 * directly (derived from AI_PROVIDERS so the registry stays the single
 * source of truth for chat, streaming, and verification).
 */
export const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<AiProviderId, string>> =
  Object.fromEntries(
    AI_PROVIDERS.filter(
      (meta) => meta.protocol === 'openai-compatible' && !meta.needsBaseUrl && meta.defaultBaseUrl,
    ).map((meta) => [meta.id, meta.defaultBaseUrl]),
  )

/**
 * Fresh settings with every provider's default model and an empty key,
 * except providers listed in `defaultApiKeys` (e.g. an app-specific
 * preconfigured Anthropic key). Callers own that policy; this package
 * has no hardcoded keys.
 */
export function defaultAiSettings(
  defaultApiKeys?: Partial<Record<AiProviderId, string>>,
): AiSettings {
  const providers = {} as AiSettings['providers']
  for (const meta of AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: defaultApiKeys?.[meta.id] ?? '',
      model: meta.defaultModel,
      baseUrl: meta.needsBaseUrl ? '' : undefined,
    }
  }
  return { provider: 'genspark', providers }
}

/**
 * Merge on-disk settings over freshly computed defaults, migrating the
 * pre-provider shape (a single OpenAI-compatible endpoint) into the
 * "custom" provider slot. `stored` is whatever the caller read from its
 * settings file (already JSON-parsed); this function does no file I/O.
 */
export function resolveAiSettings(
  stored: Partial<AiSettings> & LegacyAiSettings,
  defaults: AiSettings,
): AiSettings {
  if (!stored.providers) {
    if (stored.apiKey) {
      defaults.providers.custom = {
        apiKey: stored.apiKey,
        model: stored.model ?? '',
        baseUrl: stored.baseUrl ?? 'https://api.openai.com/v1',
      }
    }
    return defaults
  }
  return {
    provider: stored.provider ?? defaults.provider,
    providers: { ...defaults.providers, ...stored.providers },
  }
}
