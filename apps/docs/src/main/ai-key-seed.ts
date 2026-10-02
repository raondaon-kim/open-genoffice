import type { AiSecretStore } from './ai-secret-store'
import type { AiSettingsService } from './ai-settings-service'

/** Windows user variable a developer sets to pre-load a DeepSeek test key (spec §4.6). */
export const DEEPSEEK_SEED_ENV = 'GENOFFICE_SEED_DEEPSEEK_API_KEY'

export interface SeedDeepSeekKeyOptions {
  secretStore: Pick<AiSecretStore, 'status'>
  settings: Pick<AiSettingsService, 'verifyAndSave'>
  env: Readonly<Record<string, string | undefined>>
  /** one fixed line per failure; the key and the server's reply never go in */
  warn(message: string): void
}

export type SeedOutcome = 'seeded' | 'skipped' | 'failed'

/**
 * Save the DeepSeek key from the environment through the same verify-and-encrypt path as the
 * settings screen. Only when the profile has no usable key; never touches the default AI.
 */
export async function seedDeepSeekKey(options: SeedDeepSeekKeyOptions): Promise<SeedOutcome> {
  const apiKey = options.env[DEEPSEEK_SEED_ENV]?.trim()
  if (!apiKey) return 'skipped'
  if (options.secretStore.status('deepseek') === 'ready') return 'skipped'
  try {
    const result = await options.settings.verifyAndSave({ providerId: 'deepseek', apiKey })
    if (result.saved) return 'seeded'
    options.warn('DeepSeek seed key was not accepted; nothing was saved')
    return 'failed'
  } catch {
    options.warn('DeepSeek seed key could not be saved')
    return 'failed'
  }
}
