/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeProvider, defaultAiSettings } from '@genoffice/ai-provider'
import type { AiSettings, CodexModelCatalog } from '@genoffice/ai-provider'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let saved: AiSettings | null
const catalogEntry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  models: [],
  defaultModel: '',
  keyPlaceholder: 'k',
  defaultBaseUrl: '',
  ...extra,
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  saved = null
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function install(
  settings: AiSettings,
  opts: { org?: { baseUrl: string; model: string } | null; models?: string[] } = {},
): void {
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAnalyticsEnabled: async () => true,
    setAnalyticsEnabled: async () => true,
    getAiPanelPrefs: async () => ({ fontSize: 'medium', customFontSize: 14, spellcheck: true }),
    setAiPanelPrefs: async (p: unknown) => p,
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    githubStars: async () => null,
    getAiProviders: () => [
      catalogEntry('genspark'),
      catalogEntry('codex', { needsCliPath: true }),
      catalogEntry('anthropic', { models: ['claude-sonnet-5'], defaultModel: 'claude-sonnet-5' }),
      catalogEntry('litellm', { needsBaseUrl: true }),
      catalogEntry('custom', { needsBaseUrl: true }),
    ],
    getAiSettings: async () => settings,
    setAiSettings: vi.fn(async (s: AiSettings) => {
      saved = s
    }),
    getOrgAiDefaults: async () => opts.org ?? null,
    getCodexModels: async (): Promise<CodexModelCatalog> => ({ models: [], defaultModel: '' }),
    getCustomModels: async (): Promise<CodexModelCatalog> => ({
      models: opts.models ?? [],
      defaultModel: '',
    }),
  } as unknown as HomeApi
}

async function openAiPane(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SettingsModal, {
          status: null,
          loggingOut: false,
          loginWaiting: false,
          loginUrl: null,
          urlCopied: false,
          onOpenLoginUrl: vi.fn(),
          onCopyLoginUrl: vi.fn(),
          onClose: vi.fn(),
          onLogin: vi.fn(),
          onLogout: vi.fn(),
        }),
      ),
    )
    await Promise.resolve()
  })
  const nav = Array.from(host.querySelectorAll<HTMLButtonElement>('.set-nav-item')).find((b) =>
    b.textContent?.includes('AI Model'),
  )
  await act(async () => {
    nav!.click()
    await Promise.resolve()
  })
}

const card = (label: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('[role="radio"]')).find((e) =>
    e.textContent?.includes(label),
  )!
const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
const saveButton = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === 'Save',
  )!

describe('AI connection modes', () => {
  it('shows the three cards in order, with the mode of the stored provider selected', async () => {
    const s = defaultAiSettings()
    s.provider = 'codex'
    install(s)
    await openAiPane()
    const radios = Array.from(host.querySelectorAll<HTMLElement>('[role="radio"]'))
    expect(radios).toHaveLength(3)
    expect(radios[0]!.textContent).toContain('LiteLLM')
    expect(radios[1]!.textContent).toContain('Codex')
    expect(radios[2]!.textContent).toContain('Own API keys')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  it('LiteLLM card: fills the address and model from the build, lists the proxy models, defaults to DeepSeek', async () => {
    const s = defaultAiSettings()
    s.provider = 'anthropic'
    install(s, {
      org: { baseUrl: 'http://proxy.test:4000/v1', model: 'deepseek-flash' },
      models: ['gpt-5', 'deepseek-flash'],
    })
    await openAiPane()
    await act(async () => {
      card('LiteLLM').click()
      await Promise.resolve()
    })
    await flush()
    const url = host.querySelector<HTMLInputElement>('#set-ai-base-url')
    expect(url?.value).toBe('http://proxy.test:4000/v1')
    await act(async () => {
      saveButton().click()
      await Promise.resolve()
    })
    expect(saved?.provider).toBe('litellm')
    expect(saved?.providers.litellm?.model).toBe('deepseek-flash')
    expect(saved?.byokProvider).toBe('anthropic')
  })

  it('LiteLLM on a proxy without deepseek-flash picks the listed DeepSeek model', async () => {
    const s = defaultAiSettings()
    s.provider = 'litellm'
    s.providers.litellm = { apiKey: 'k', model: '', baseUrl: 'http://proxy.test:4000/v1' }
    install(s, { org: null, models: ['gpt-5', 'deepseek-chat'] })
    await openAiPane()
    // the model list is asked for after a short debounce
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    await flush()
    await act(async () => {
      saveButton().click()
      await Promise.resolve()
    })
    expect(saved?.providers.litellm?.model).toBe('deepseek-chat')
  })

  it('an incomplete LiteLLM setup reopens as LiteLLM and Save keeps it (main process resolves a fallback)', async () => {
    const stored = defaultAiSettings()
    stored.provider = 'litellm'
    stored.providers.litellm = { apiKey: 'k', model: 'deepseek-flash', baseUrl: '' }
    // what ai:get-settings sends: the usable-provider fallback plus the stored choice
    const resolved = {
      ...stored,
      provider: activeProvider(stored),
      storedProvider: stored.provider,
    }
    expect(resolved.provider).toBe('genspark')
    install(resolved as AiSettings, { org: null })
    await openAiPane()
    expect(card('LiteLLM').getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('#set-ai-base-url')).not.toBeNull()
    // any edit (here: the key) and Save must keep the LiteLLM choice
    const key = host.querySelector<HTMLInputElement>('#set-ai-key')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(key, 'k2')
      key.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      saveButton().click()
      await Promise.resolve()
    })
    expect(saved?.provider).toBe('litellm')
    expect(saved?.providers.litellm?.apiKey).toBe('k2')
  })

  it('keeps the key of every provider when the mode changes and comes back to the same provider', async () => {
    const s = defaultAiSettings()
    s.provider = 'anthropic'
    s.providers.anthropic = { apiKey: 'sk-ant', model: 'claude-sonnet-5' }
    install(s, { org: null })
    await openAiPane()
    await act(async () => {
      card('Codex').click()
      await Promise.resolve()
    })
    await act(async () => {
      card('Own API').click()
      await Promise.resolve()
    })
    await act(async () => {
      saveButton().click()
      await Promise.resolve()
    })
    expect(saved?.provider).toBe('anthropic')
    expect(saved?.providers.anthropic?.apiKey).toBe('sk-ant')
  })

  it('shows the address input and does not throw when an open build has no address', async () => {
    const s = defaultAiSettings()
    s.provider = 'litellm'
    s.providers.litellm = { apiKey: '', model: '' }
    install(s, { org: null })
    await openAiPane()
    expect(host.querySelector('#set-ai-base-url')).not.toBeNull()
  })

  it('own-key mode does not list LiteLLM or Codex as providers', async () => {
    const s = defaultAiSettings()
    s.provider = 'anthropic'
    install(s)
    await openAiPane()
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')
    expect(trigger).not.toBeNull()
    await act(async () => {
      trigger!.click()
      await Promise.resolve()
    })
    const options = Array.from(document.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent,
    )
    expect(options).toContain('anthropic')
    expect(options).toContain('genspark')
    expect(options).toContain('custom')
    expect(options).not.toContain('litellm')
    expect(options).not.toContain('codex')
  })
})
