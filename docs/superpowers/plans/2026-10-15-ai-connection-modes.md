# AI connection modes (LiteLLM, Codex, own API keys) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → AI model offers three ways to connect (LiteLLM first with DeepSeek `deepseek-flash` as its default, Codex with the CLI bundled in the installer, own API keys), and the bundled LLM Wiki can learn through Codex.

**Architecture:** The mode is derived from `AiSettings.provider` (`litellm` / `codex` / anything else), so no stored data migrates; pure helpers live in `packages/ai-provider`, the Settings pane becomes three cards plus per-mode fields, Codex login and status go through main-process IPC, and a loopback OpenAI-compatible adapter lets LLM Wiki use Codex.

**Tech Stack:** TypeScript, React (Settings renderer), Electron main/preload IPC, vitest (+ jsdom), the existing `@genoffice/ai-provider` Codex app-server client, a Node `http` server, electron-builder `extraResources`.

**Spec:** `docs/superpowers/specs/2026-10-15-ai-connection-modes-design.md`

## Global Constraints

- No internal address or key in the repository: the LiteLLM address comes only from `OPEN_GENOFFICE_LITELLM_URL` at build time, the key from the user. Tests use `http://127.0.0.1:…` or `http://proxy.test:4000/v1`.
- LiteLLM default model id: `deepseek-flash`. Preference when the proxy list lacks it: the first `deepseek*` id, then the first id.
- Codex CLI pinned to `@openai/codex@0.162.1-win32-x64` (npm integrity `sha512-dfl4MhHuEi0ARKyNmrTxk+RQmsWNCQAoVLUtrYq+yrW1C8P2sg5ziwgHUUACHjYLKuACV7ARH5Nq5pnCz3GlaQ==`), Apache-2.0. Bundled files only: `bin/codex.exe`, `bin/codex-code-mode-host.exe`, `codex-resources/*.exe`, `codex-path/rg.exe`, `codex-package.json`. The voice resources are left out. The installer grows by about 130–150 MB; say so to the user at the end.
- Codex executable lookup order: the user's `cliPath`, then the bundled copy, then the Codex desktop app's folder, then PATH.
- Windows x64 installers only ship Codex and LLM Wiki; other platforms are unchanged.
- Existing `ai-settings.json` files keep working; switching mode never clears a provider's key, model or address. `provider` stays the stored source of truth.
- Strings exist in all 21 languages (Korean, Chinese, Japanese native; English elsewhere).
- Comments in source are English (`npm run check:english-comments`); no new raw CSS colors (`npm run check:theme-colors`); Prettier on every changed file.
- A commit message goes in its own `git commit -F <file>` command with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never combine `git commit` with other commands in one shell call (a repo hook misreads it).
- Push only to the private remote `private`; never to `origin`.

## Review Focus

1. A stored `provider: 'litellm'` with an empty address or key (an open build): the pane shows the address input and the missing-field message, never throws; saving still works.
2. Codex login: a second click while one runs, Cancel, the app quitting mid-login (the child is killed), login when already signed in, the login child exiting non-zero.
3. Mode round trip: 3 → 1 → 3 returns to the same provider; a stored `byokProvider` of `litellm`, `codex` or an unknown id is dropped.
4. LiteLLM model list: empty (proxy down) must not wipe a typed model; a list without `deepseek-flash` falls back to another DeepSeek id, then the first id; a model the user picked is never replaced.
5. Bundled Codex folder absent (a dev run, a broken install): status `missing`, lookup falls through to PATH, the pane lets the user pick another mode.
6. Bridge: a request without the token (401), with a foreign `Host` (403), a body over the limit (413), two requests at once (served one after the other), the client closing mid-stream (Codex call aborted), a Codex failure before and after streaming started.
7. Paths with Hangul (this PC's user folder is Hangul): the bundled Codex starts from, and reads its login in, a Hangul path.

---

## File Structure

**Part A (modes and UI)**

- Create: `packages/ai-provider/src/connection-modes.ts` — pure mode helpers and the LiteLLM default-model choice.
- Modify: `packages/ai-provider/src/types.ts`, `src/ai-settings-guard.ts`, `src/providers.ts` (`resolveAiSettings`), `src/index.ts` — the `byokProvider` field and exports.
- Modify: `apps/shell/src/main/org-defaults.ts`, `src/main/index.ts` — a renderer-safe view of the org defaults and its IPC.
- Modify: `apps/shell/src/shared/home-api.ts`, `src/preload/index.ts` — `getOrgAiDefaults`.
- Create: `apps/shell/src/renderer/src/ConnectionCards.tsx` — the three-card selector.
- Modify: `apps/shell/src/renderer/src/SettingsModal.tsx` (`AiModelPane`), `strings.ts` — per-mode fields and strings.
- Modify: `apps/shell/electron-builder.cjs` is untouched in A; the build wiring is a doc step in Task 5.

**Part B (Codex bundled, login)**

- Modify: `packages/ai-provider/src/codex-app-server.ts` — bundled lookup, `readCodexAccount`.
- Create: `tools/fetch-codex-cli.mjs`, `tools/codex-cli.pin.json`.
- Modify: `apps/shell/electron-builder.cjs`, `package.json`, `.gitignore`, `ACKNOWLEDGMENTS.md`, `MODIFICATIONS.md`.
- Create: `apps/shell/src/main/codex-connection.ts` — status + login manager + IPC registration.
- Modify: `apps/shell/src/main/index.ts`, `src/shared/home-api.ts`, `src/preload/index.ts`, `SettingsModal.tsx`, `strings.ts`.

**Part C (Codex → LLM Wiki)**

- Create: `apps/shell/src/main/codex-bridge.ts`.
- Modify: `apps/shell/src/main/llm-wiki-seed.ts`, `src/main/llm-wiki.ts` (signature), `src/main/work-wiki.ts`.

---

# Part A: Modes and Settings UI

### Task 1: Connection-mode helpers

**Files:**

- Create: `packages/ai-provider/src/connection-modes.ts`
- Create: `packages/ai-provider/tests/connection-modes.test.ts`
- Modify: `packages/ai-provider/src/index.ts` (export)

**Interfaces:**

- Produces:
  - `type ConnectionMode = 'litellm' | 'codex' | 'byok'`
  - `connectionModeOf(provider: AiProviderId): ConnectionMode`
  - `isByokProvider(provider: AiProviderId): boolean`
  - `byokProviderOf(settings: AiSettings): AiProviderId`
  - `withConnectionMode(settings: AiSettings, mode: ConnectionMode): AiSettings`
  - `LITELLM_DEFAULT_MODEL = 'deepseek-flash'`, `chooseLitellmModel(models: string[], current: string): string`

- [ ] **Step 1: Write the failing test** `packages/ai-provider/tests/connection-modes.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  byokProviderOf,
  chooseLitellmModel,
  connectionModeOf,
  isByokProvider,
  LITELLM_DEFAULT_MODEL,
  withConnectionMode,
} from '../src/connection-modes'
import { defaultAiSettings } from '../src/providers'

describe('connection modes', () => {
  it('derives the mode from the provider', () => {
    expect(connectionModeOf('litellm')).toBe('litellm')
    expect(connectionModeOf('codex')).toBe('codex')
    for (const p of ['anthropic', 'openai', 'deepseek', 'genspark', 'custom'] as const) {
      expect(connectionModeOf(p)).toBe('byok')
    }
    expect(isByokProvider('litellm')).toBe(false)
    expect(isByokProvider('codex')).toBe(false)
    expect(isByokProvider('gemini')).toBe(true)
  })

  it('remembers the own-key provider across a trip through the other modes', () => {
    const base = defaultAiSettings()
    base.provider = 'openai'
    base.providers.openai = { apiKey: 'k', model: 'gpt-5.6-terra' }
    const inLitellm = withConnectionMode(base, 'litellm')
    expect(inLitellm.provider).toBe('litellm')
    expect(inLitellm.byokProvider).toBe('openai')
    const inCodex = withConnectionMode(inLitellm, 'codex')
    expect(inCodex.provider).toBe('codex')
    expect(inCodex.byokProvider).toBe('openai')
    const back = withConnectionMode(inCodex, 'byok')
    expect(back.provider).toBe('openai')
    // nothing a provider holds is cleared by switching
    expect(back.providers.openai).toEqual({ apiKey: 'k', model: 'gpt-5.6-terra' })
  })

  it('picks a provider for own-key mode when none is remembered', () => {
    const s = defaultAiSettings()
    s.provider = 'litellm'
    s.providers.gemini = { apiKey: 'g', model: 'gemini-3.8-flash' }
    expect(byokProviderOf(s)).toBe('gemini')
    const none = defaultAiSettings()
    none.provider = 'codex'
    expect(byokProviderOf(none)).toBe('anthropic')
    s.byokProvider = 'litellm' // never a valid remembered own-key provider
    expect(byokProviderOf(s)).toBe('gemini')
  })

  it('keeps genspark cloud tools on when it becomes the provider', () => {
    const s = defaultAiSettings()
    s.provider = 'litellm'
    s.byokProvider = 'genspark'
    s.gskToolsEnabled = false
    expect(withConnectionMode(s, 'byok')).toMatchObject({
      provider: 'genspark',
      gskToolsEnabled: true,
    })
  })

  it('chooses the LiteLLM model: keep a valid one, else deepseek-flash, else any deepseek, else the first', () => {
    expect(LITELLM_DEFAULT_MODEL).toBe('deepseek-flash')
    const list = ['gpt-5', 'deepseek-flash', 'deepseek-v4-pro']
    expect(chooseLitellmModel(list, 'gpt-5')).toBe('gpt-5')
    expect(chooseLitellmModel(list, '')).toBe('deepseek-flash')
    expect(chooseLitellmModel(list, 'gone')).toBe('deepseek-flash')
    expect(chooseLitellmModel(['gpt-5', 'deepseek-v4-pro'], '')).toBe('deepseek-v4-pro')
    expect(chooseLitellmModel(['gpt-5', 'claude-x'], '')).toBe('gpt-5')
  })

  it('does not wipe the model when the list is empty', () => {
    expect(chooseLitellmModel([], 'typed-by-hand')).toBe('typed-by-hand')
    expect(chooseLitellmModel([], '')).toBe('deepseek-flash')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/ai-provider/tests/connection-modes.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Add the field to the types** — in `packages/ai-provider/src/types.ts`, inside `interface AiSettings`, after `provider: AiProviderId`:

```ts
  /**
   * The provider own-key mode (mode 3) shows. Remembered while LiteLLM or Codex is selected so a
   * round trip through them returns to it. Never `litellm` or `codex`.
   */
  byokProvider?: AiProviderId | undefined
```

- [ ] **Step 4: Implement** `packages/ai-provider/src/connection-modes.ts`

```ts
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
 * (the proxy did not answer) never changes what the user has.
 */
export function chooseLitellmModel(models: string[], current: string): string {
  if (models.length === 0) return current || LITELLM_DEFAULT_MODEL
  if (current && models.includes(current)) return current
  if (models.includes(LITELLM_DEFAULT_MODEL)) return LITELLM_DEFAULT_MODEL
  return models.find((m) => /deepseek/i.test(m)) ?? models[0]!
}
```

- [ ] **Step 5: Export** — in `packages/ai-provider/src/index.ts` add:

```ts
export {
  byokProviderOf,
  chooseLitellmModel,
  connectionModeOf,
  isByokProvider,
  LITELLM_DEFAULT_MODEL,
  withConnectionMode,
} from './connection-modes'
export type { ConnectionMode } from './connection-modes'
```

- [ ] **Step 6: Run tests and typecheck, commit**

Run: `npx vitest run packages/ai-provider/tests/connection-modes.test.ts && npm run typecheck -w @genoffice/ai-provider`
Expected: PASS (6 tests), no type errors.

```bash
git add packages/ai-provider
git commit -F <message file>   # "feat(ai-provider): derive the connection mode from the provider, remember the own-key provider, choose the LiteLLM model"
```

---

### Task 2: `byokProvider` survives storage

**Files:**

- Modify: `packages/ai-provider/src/ai-settings-guard.ts` (`sanitizeAiSettings`)
- Modify: `packages/ai-provider/src/providers.ts` (`resolveAiSettings`)
- Create: `packages/ai-provider/tests/byok-provider.test.ts`

**Interfaces:**

- Consumes: `isByokProvider` (Task 1).
- Produces: `sanitizeAiSettings` and `resolveAiSettings` keep a valid `byokProvider` and drop an invalid one.

- [ ] **Step 1: Write the failing test** `packages/ai-provider/tests/byok-provider.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { sanitizeAiSettings } from '../src/ai-settings-guard'
import { defaultAiSettings, resolveAiSettings } from '../src/providers'

const payload = (byokProvider: unknown) => ({
  provider: 'litellm',
  byokProvider,
  providers: {
    litellm: { apiKey: 'k', model: 'deepseek-flash', baseUrl: 'http://proxy.test:4000/v1' },
  },
})

describe('byokProvider', () => {
  it('is kept by the schema check when it names an own-key provider', () => {
    expect(sanitizeAiSettings(payload('openai'))?.byokProvider).toBe('openai')
  })

  it('is dropped when it is litellm, codex, unknown or not a string', () => {
    for (const bad of ['litellm', 'codex', 'nope', 7, null, {}]) {
      expect(sanitizeAiSettings(payload(bad))?.byokProvider).toBeUndefined()
    }
  })

  it('is read back from a stored file, with the same rule', () => {
    const ok = resolveAiSettings(payload('gemini'), defaultAiSettings())
    expect(ok.byokProvider).toBe('gemini')
    const bad = resolveAiSettings(payload('codex'), defaultAiSettings())
    expect(bad.byokProvider).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/ai-provider/tests/byok-provider.test.ts`
Expected: FAIL (the field is dropped).

- [ ] **Step 3: Implement** — in `sanitizeAiSettings`, after the `gskToolsEnabled` line:

```ts
if (
  typeof raw.byokProvider === 'string' &&
  PROVIDER_IDS.includes(raw.byokProvider as AiProviderId) &&
  isByokProvider(raw.byokProvider as AiProviderId)
) {
  settings.byokProvider = raw.byokProvider as AiProviderId
}
```

and add `import { isByokProvider } from './connection-modes'` to the file's imports. In `resolveAiSettings`, in the returned object after `provider: settings.provider ?? defaults.provider,`:

```ts
    ...(typeof settings.byokProvider === 'string' &&
    AI_PROVIDERS.some((m) => m.id === settings.byokProvider) &&
    isByokProvider(settings.byokProvider)
      ? { byokProvider: settings.byokProvider }
      : {}),
```

with `import { isByokProvider } from './connection-modes'` at the top of `providers.ts`. (`connection-modes.ts` imports only types, so there is no import cycle.)

- [ ] **Step 3b: Run tests, typecheck, commit**

Run: `npx vitest run packages/ai-provider && npm run typecheck -w @genoffice/ai-provider`
Expected: PASS.

```bash
git add packages/ai-provider
git commit -F <message file>   # "feat(ai-provider): keep the remembered own-key provider in stored settings"
```

---

### Task 3: Org defaults reach the Settings screen

**Files:**

- Modify: `apps/shell/src/main/org-defaults.ts` (`orgDefaultsView`)
- Modify: `apps/shell/tests/org-defaults.test.ts`
- Modify: `apps/shell/src/shared/home-api.ts`, `src/preload/index.ts`, `src/main/index.ts`

**Interfaces:**

- Produces:
  - `orgDefaultsView(defaults: OrgAiDefaults | null): { baseUrl: string; model: string } | null`
  - `HOME_CHANNELS.getOrgAiDefaults = 'home:get-org-ai-defaults'`; `HomeApi.getOrgAiDefaults(): Promise<{ baseUrl: string; model: string } | null>`

- [ ] **Step 1: Write the failing test** — append to `apps/shell/tests/org-defaults.test.ts` (add `orgDefaultsView` to its import from `../src/main/org-defaults`):

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/shell/tests/org-defaults.test.ts`
Expected: FAIL (`orgDefaultsView` is not exported).

- [ ] **Step 3: Implement** — in `org-defaults.ts` add:

```ts
/** what the Settings screen may see of the build's defaults: no provider id, never a key */
export function orgDefaultsView(
  defaults: OrgAiDefaults | null,
): { baseUrl: string; model: string } | null {
  return defaults ? { baseUrl: defaults.baseUrl, model: defaults.model } : null
}
```

In `home-api.ts`: add to `interface HomeApi` (next to `getAiProviders`) `getOrgAiDefaults(): Promise<{ baseUrl: string; model: string } | null>` and to `HOME_CHANNELS` `getOrgAiDefaults: 'home:get-org-ai-defaults',`. In `preload/index.ts` (next to `getAiSettings`):

```ts
  async getOrgAiDefaults() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.getOrgAiDefaults)) as {
      baseUrl: string
      model: string
    } | null
  },
```

In `main/index.ts`, hoist the path out of the first-run block so both use it: replace `const orgDefaultsPath = app.isPackaged ? … : (process.env.OPEN_GENOFFICE_ORG_DEFAULTS ?? '')` inside the block with a module-level `const orgDefaultsPath = …` declared just above the block (same expression), and register once next to the other `ipcMain.handle(HOME_CHANNELS…)` calls in `registerWorkWikiIpc`'s neighbour (search `registerWorkWikiIpc()` in `index.ts` and put right after it):

```ts
ipcMain.handle(HOME_CHANNELS.getOrgAiDefaults, () =>
  orgDefaultsView(orgDefaultsPath ? readOrgDefaults(orgDefaultsPath) : null),
)
```

importing `orgDefaultsView` beside `firstRunAiSettings, readOrgDefaults`.

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run apps/shell/tests/org-defaults.test.ts && npm run typecheck -w @genoffice/shell`
Expected: PASS.

```bash
git add apps/shell
git commit -F <message file>   # "feat(shell): let Settings read the build's LiteLLM address and model"
```

---

### Task 4: The three cards and per-mode fields

**Files:**

- Create: `apps/shell/src/renderer/src/ConnectionCards.tsx`
- Modify: `apps/shell/src/renderer/src/SettingsModal.tsx` (`AiModelPane`)
- Modify: `apps/shell/src/renderer/src/strings.ts`
- Create: `apps/shell/tests/settings-ai-modes.test.ts`

**Interfaces:**

- Consumes: `connectionModeOf`, `withConnectionMode`, `isByokProvider`, `chooseLitellmModel`, `LITELLM_DEFAULT_MODEL` (Task 1); `window.aiOffice.getOrgAiDefaults` (Task 3, optional).
- Produces: `ConnectionCards({ mode, onPick, t })` with `onPick: (mode: ConnectionMode) => void`; string keys `setAiMode`, `setAiModeLitellm`, `setAiModeLitellmDesc`, `setAiModeCodex`, `setAiModeCodexDesc`, `setAiModeByok`, `setAiModeByokDesc`, `setAiLitellmManaged`, `setAiCodexAdvanced`.

- [ ] **Step 1: Write the failing test** `apps/shell/tests/settings-ai-modes.test.ts`. It reuses the mounting pattern of `settings-custom-models.test.ts` (read it first: `installApi`, `openAiPane`, `click`):

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
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
    const save = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Save',
    )!
    await act(async () => {
      save.click()
      await Promise.resolve()
    })
    expect(saved?.provider).toBe('litellm')
    expect(saved?.providers.litellm?.model).toBe('deepseek-flash')
    expect(saved?.byokProvider).toBe('anthropic')
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
    const save = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Save',
    )!
    await act(async () => {
      save.click()
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
    const dd = host.querySelector('[aria-label="Provider"]') ?? host.querySelector('.set-dd')
    expect(dd?.textContent).not.toContain('LiteLLM')
  })
})
```

(The label strings above are the English ones added in Step 4; `'Provider'` is the existing `setAiProvider` English text — confirm it with `grep -n "setAiProvider:" apps/shell/src/renderer/src/strings.ts` and adjust the selector if it differs.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/shell/tests/settings-ai-modes.test.ts`
Expected: FAIL (no `[role="radio"]` cards).

- [ ] **Step 3: Add `ConnectionCards.tsx`**

```tsx
import type { ConnectionMode } from '@genoffice/ai-provider'
import type { TFunc } from './locale'

const CARDS: Array<{ mode: ConnectionMode; title: string; desc: string }> = [
  { mode: 'litellm', title: 'setAiModeLitellm', desc: 'setAiModeLitellmDesc' },
  { mode: 'codex', title: 'setAiModeCodex', desc: 'setAiModeCodexDesc' },
  { mode: 'byok', title: 'setAiModeByok', desc: 'setAiModeByokDesc' },
]

/** the three ways to connect, in the order the product recommends them */
export function ConnectionCards({
  mode,
  onPick,
  t,
}: {
  mode: ConnectionMode
  onPick: (mode: ConnectionMode) => void
  t: TFunc
}) {
  return (
    <div className="set-ai-modes" role="radiogroup" aria-label={t('setAiMode')}>
      {CARDS.map((c) => (
        <button
          key={c.mode}
          type="button"
          role="radio"
          aria-checked={mode === c.mode}
          className={`set-ai-mode${mode === c.mode ? ' selected' : ''}`}
          onClick={() => onPick(c.mode)}
        >
          <span className="set-ai-mode-title">{t(c.title as never)}</span>
          <span className="set-ai-mode-desc">{t(c.desc as never)}</span>
        </button>
      ))}
    </div>
  )
}
```

Add CSS next to the other `.set-*` rules (find them with `grep -rn "\.set-field {" apps/shell/src/renderer/src/*.css`), using the theme variables the file already uses (`var(--border)`, `var(--surface)`, `var(--border-hover)`; add no raw colors):

```css
.set-ai-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 8px 0 14px;
}
.set-ai-mode {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.set-ai-mode:hover {
  border-color: var(--border-hover);
}
.set-ai-mode.selected {
  border-color: var(--accent, var(--border-hover));
  box-shadow: 0 0 0 1px var(--accent, var(--border-hover));
}
.set-ai-mode-title {
  font-weight: 600;
}
.set-ai-mode-desc {
  font-size: 12px;
  opacity: 0.75;
}
```

- [ ] **Step 4: Strings (21 languages)** — insert after each language block's `setWikiAddMaterial:` line (present in all 21 blocks) with a script like the one used for `setLlmWiki*` (it keys on `^  ('zh-TW'|[a-z]{2}): \{$` block headers, appends the new keys after the anchor line, and uses the Korean / Chinese / Japanese / English tables below; write the script to a file and avoid backslashes in the strings). Keys:

| key                    | en                                                   | ko                                        |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------- |
| `setAiMode`            | Connection                                           | 연결 방식                                 |
| `setAiModeLitellm`     | LiteLLM                                              | LiteLLM                                   |
| `setAiModeLitellmDesc` | Connect with the key your company gave you           | 회사에서 받은 키로 연결                   |
| `setAiModeCodex`       | Codex                                                | Codex                                     |
| `setAiModeCodexDesc`   | ChatGPT account — one login connects it              | ChatGPT 계정 — 로그인 한 번으로 자동 연결 |
| `setAiModeByok`        | Own API keys                                         | API 키 직접 입력                          |
| `setAiModeByokDesc`    | Claude, OpenAI, Gemini, DeepSeek … with your own key | 여러 회사 모델을 내 키로 사용             |
| `setAiLitellmManaged`  | Set by your company's build                          | 회사 빌드에서 설정됨                      |
| `setAiCodexAdvanced`   | Advanced: executable path                            | 고급: 실행 파일 경로                      |

(zh: 连接方式 / LiteLLM / 使用公司提供的密钥连接 / Codex / ChatGPT 账号，登录一次即可连接 / 自己的 API 密钥 / 用你自己的密钥使用多家模型 / 由公司版本设置 / 高级：可执行文件路径; zh-TW: 連線方式 / LiteLLM / 使用公司提供的金鑰連線 / Codex / ChatGPT 帳號，登入一次即可連線 / 自己的 API 金鑰 / 用你自己的金鑰使用多家模型 / 由公司版本設定 / 進階：執行檔路徑; ja: 接続方式 / LiteLLM / 会社から受け取ったキーで接続 / Codex / ChatGPT アカウント — 一度のログインで接続 / 自分の API キー / 自分のキーで複数社のモデルを使う / 会社のビルドで設定済み / 詳細設定：実行ファイルのパス; every other language: the English text.)

- [ ] **Step 5: Rework `AiModelPane`** in `SettingsModal.tsx`.

Imports: add `chooseLitellmModel`, `connectionModeOf`, `isByokProvider`, `withConnectionMode` and `type ConnectionMode` to the existing `@genoffice/ai-provider` import, and `import { ConnectionCards } from './ConnectionCards'`.

After `const isCodex = provider === 'codex'` add:

```tsx
const mode = connectionModeOf(provider)
const isLitellm = mode === 'litellm'
```

Replace `selectProvider` and add `selectMode`:

```tsx
const selectProvider = (id: AiSettings['provider']) => {
  // cloud tools cannot be off with genspark (chat runs through gsk anyway)
  setSettings({
    ...settings,
    provider: id,
    byokProvider: id,
    ...(id === 'genspark' ? { gskToolsEnabled: true } : {}),
  })
  touch()
}
const selectMode = (next: ConnectionMode) => {
  const switched = withConnectionMode(settings, next)
  setSettings(switched)
  touch()
  if (next === 'litellm') void prefillLitellm()
  if (next === 'codex') {
    const codex = switched.providers.codex
    void refreshCodexModels(codex?.cliPath ?? '', codex?.model ?? '').catch(() => undefined)
  }
}
/** the build's address and model fill the LiteLLM config where the user has none yet */
const prefillLitellm = async () => {
  const org = await window.aiOffice.getOrgAiDefaults?.()
  if (!org) return
  setSettings((cur) => {
    if (!cur) return cur
    const own = cur.providers.litellm ?? { apiKey: '', model: '' }
    return {
      ...cur,
      providers: {
        ...cur.providers,
        litellm: {
          ...own,
          baseUrl: own.baseUrl || org.baseUrl,
          model: own.model || org.model,
        },
      },
    }
  })
}
```

Replace the provider `<div className="set-field">…Dropdown…</div>` block (the one labelled `setAiProvider`) and the note below it with:

```tsx
;<ConnectionCards mode={mode} onPick={selectMode} t={t} />
{
  mode === 'byok' && (
    <div className="set-field">
      <div className="set-field-text">
        <label className="set-field-label">{t('setAiProvider')}</label>
      </div>
      <Dropdown
        className="set-dd"
        value={provider}
        ariaLabel={t('setAiProvider')}
        options={catalog
          .filter((c) => isByokProvider(c.id))
          .map((c) => ({
            value: c.id,
            label: c.label,
            render: (
              <>
                <ProviderLogo id={c.id} />
                {c.label}
              </>
            ),
          }))}
        onPick={(v) => selectProvider(v as AiSettings['provider'])}
      />
    </div>
  )
}
;<div className="set-field-desc set-ai-note">
  {isGenspark ? t('setAiGensparkHint') : isCodex ? t('setAiCodexHint') : t('setAiByokNote')}
</div>
```

In the Codex branch wrap the existing `cliPath` field in a collapsed section: `<details className="set-ai-advanced"><summary>{t('setAiCodexAdvanced')}</summary> …existing cliPath field… </details>`. In the key/address branch, the base-URL input becomes read-only when the build supplied it:

```tsx
const [orgBaseUrl, setOrgBaseUrl] = useState('')
useEffect(() => {
  void window.aiOffice.getOrgAiDefaults?.().then((o) => setOrgBaseUrl(o?.baseUrl ?? ''))
}, [])
```

(placed with the other hooks above the early `if (!settings) return null`), and on the `#set-ai-base-url` input: `readOnly={isLitellm && !!orgBaseUrl && (config.baseUrl ?? '') === orgBaseUrl}` plus, below the label, `{isLitellm && orgBaseUrl && <div className="set-field-desc">{t('setAiLitellmManaged')}</div>}`.

LiteLLM default model: add an effect next to the custom-models effect that applies `chooseLitellmModel` once a list is folded in, using a functional update so it never reverts what the user typed meanwhile:

```tsx
useEffect(() => {
  if (provider !== 'litellm') return
  const models = catalog.find((c) => c.id === 'litellm')?.models ?? []
  setSettings((cur) => {
    if (!cur || cur.provider !== 'litellm') return cur
    const own = cur.providers.litellm ?? { apiKey: '', model: '' }
    const next = chooseLitellmModel(models, own.model)
    if (next === own.model) return cur
    return { ...cur, providers: { ...cur.providers, litellm: { ...own, model: next } } }
  })
  // the choice is a default the user can change: only a new list or a new mode re-runs it
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [provider, catalog])
```

(An edit from the effect makes the pane `dirty`; call `touch()` only when `next !== own.model` — move that into the updater callback via a ref flag, or accept that the Save button lights up after the first load, which is the correct signal that the default was applied.)

- [ ] **Step 6: Run tests and checks**

Run: `npx vitest run apps/shell/tests/settings-ai-modes.test.ts apps/shell/tests/settings-custom-models.test.ts apps/shell/tests/settings-ai-panel.test.ts && npm run typecheck -w @genoffice/shell && npm run check:english-comments && npm run check:theme-colors`
Expected: PASS. The existing custom-models test still passes (the `custom` provider is an own-key provider and keeps its list).

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/shell/src/renderer/src apps/shell/tests/settings-ai-modes.test.ts
git add apps/shell
git commit -F <message file>   # "feat(shell): AI model settings as three connection modes"
```

---

### Task 5: LiteLLM build wiring and a check against the proxy

**Files:**

- Modify: `apps/shell/src/main/org-defaults.ts` (doc comment only), `MODIFICATIONS.md`, `README.md`
- Create (local, not tracked): `scripts/drivers/check-litellm.mjs`

**Interfaces:**

- Consumes: the existing build path (`OPEN_GENOFFICE_LITELLM_URL`, `OPEN_GENOFFICE_LITELLM_MODEL` → `build/org-defaults.json` in `electron-builder.cjs`).

- [ ] **Step 1: Document the company build** — in `README.md` replace the "Company build (Windows)" paragraph's model line so it names the default:

```
> Company build (Windows): set `OPEN_GENOFFICE_LITELLM_URL=<proxy>/v1`,
> `OPEN_GENOFFICE_LITELLM_MODEL=deepseek-flash` (the default model) and
> `OPEN_GENOFFICE_WIN_SIDECAR_TARGET=x86_64-pc-windows-msvc`, then run
> `npm run dist:win`. The LiteLLM card in Settings › AI model is selected first; a user enters only
> the virtual key.
```

and add one bullet to the `LiteLLM provider and organization defaults` item in `MODIFICATIONS.md`: "Settings offers LiteLLM, Codex and own API keys as three connection modes; the LiteLLM card prefills the build's address and defaults to `deepseek-flash`."

- [ ] **Step 2: Local check against the real proxy** — `scripts/drivers/check-litellm.mjs` (untracked; `scripts/drivers/` is excluded by the repo's local exclude list). It reads the address and key from `LITELLM_URL` and `LITELLM_KEY` (the key from a file outside the repo), prints only model ids and the first reply words, never the key:

```js
const base = process.env.LITELLM_URL
const key = process.env.LITELLM_KEY
if (!base || !key) throw new Error('set LITELLM_URL and LITELLM_KEY')
const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const models = (await (await fetch(`${base}/models`, { headers: h })).json()).data.map((m) => m.id)
console.log(
  'deepseek models:',
  models.filter((m) => /deepseek/i.test(m)),
)
const r = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: h,
  body: JSON.stringify({
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: 'Say hi in Korean, one word.' }],
    max_tokens: 200,
  }),
})
const j = await r.json()
console.log(
  'status',
  r.status,
  'reply',
  JSON.stringify(j.choices?.[0]?.message?.content),
  'reasoning',
  !!j.choices?.[0]?.message?.reasoning_content,
)
```

Run: `LITELLM_URL=<address from the user> LITELLM_KEY=$(cat <key file>) node scripts/drivers/check-litellm.mjs`
Expected: `deepseek-flash` is in the list and the reply is non-empty. (Verified once already: `deepseek-flash` answers and returns `reasoning_content`; `deepseek-flash-nothink` also exists. LLM Wiki's learning runs use the chat model as it is; if an ingest turns out too slow because of thinking, Task 13 measures it and decides whether to point LLM Wiki at the `-nothink` variant.)

- [ ] **Step 3: Commit**

```bash
git add README.md MODIFICATIONS.md apps/shell/src/main/org-defaults.ts
git commit -F <message file>   # "docs: the company build defaults to deepseek-flash; three connection modes"
```

---

# Part B: Codex bundled, login

### Task 6: Find the bundled Codex, read the account

**Files:**

- Modify: `packages/ai-provider/src/codex-app-server.ts`
- Modify: `packages/ai-provider/src/index.ts` (exports)
- Test: `packages/ai-provider/tests/codex-bundled.test.ts`

**Interfaces:**

- Produces:
  - `configureBundledCodex(path: string | null): void` — the bundled `codex.exe` path (null = none); module state read by `resolveCodexCliPath`.
  - `resolveCodexCliPath(configuredPath?, options?)` gains the bundled step: configured → bundled (when the file exists) → desktop-managed → PATH. `CodexCliResolutionOptions` gains `bundledPath?: string | null`.
  - `type CodexAccountState = { state: 'connected'; account: string } | { state: 'needs-login' } | { state: 'missing'; reason: string } | { state: 'error'; reason: string }`
  - `readCodexAccount(cliPath?: string): Promise<CodexAccountState>`

- [ ] **Step 1: Write the failing test** `packages/ai-provider/tests/codex-bundled.test.ts`

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accountStateOf, resolveCodexCliPath } from '../src/codex-app-server'

const file = (dir: string, name: string) => {
  const p = join(dir, name)
  writeFileSync(p, 'x')
  return p
}

describe('resolveCodexCliPath with a bundled copy', () => {
  const win = { platform: 'win32' as const, env: { PATH: '' } }

  it('uses the bundled copy before the desktop app and PATH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-'))
    const bundled = file(dir, 'codex.exe')
    const r = await resolveCodexCliPath(undefined, {
      ...win,
      bundledPath: bundled,
      managedInstallRoot: join(dir, 'none'),
    })
    expect(r).toBe(bundled)
  })

  it('still prefers the path the user set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-'))
    const bundled = file(dir, 'codex.exe')
    const mine = file(dir, 'mine.exe')
    expect(await resolveCodexCliPath(mine, { ...win, bundledPath: bundled })).toBe(mine)
  })

  it('falls through to PATH when the bundled file is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-'))
    const onPath = join(dir, 'bin')
    mkdirSync(onPath)
    const exe = file(onPath, 'codex.exe')
    const r = await resolveCodexCliPath(undefined, {
      platform: 'win32',
      env: { PATH: onPath },
      bundledPath: join(dir, 'missing', 'codex.exe'),
      managedInstallRoot: join(dir, 'none'),
    })
    expect(r).toBe(exe)
  })
})

describe('accountStateOf', () => {
  it('maps the app-server account/read answer', () => {
    expect(accountStateOf({ account: null, requiresOpenaiAuth: true })).toEqual({
      state: 'needs-login',
    })
    expect(accountStateOf({ account: { email: 'a@b.test' }, requiresOpenaiAuth: true })).toEqual({
      state: 'connected',
      account: 'a@b.test',
    })
    expect(accountStateOf({ account: { type: 'chatgpt' } })).toEqual({
      state: 'connected',
      account: 'ChatGPT',
    })
    expect(accountStateOf(undefined)).toEqual({ state: 'error', reason: 'no account answer' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/ai-provider/tests/codex-bundled.test.ts`
Expected: FAIL (`accountStateOf` and the option are missing).

- [ ] **Step 3: Implement** in `codex-app-server.ts`:

Add to `interface CodexCliResolutionOptions`: `bundledPath?: string | null | undefined`. Add module state and setter near the top-level helpers:

```ts
let bundledCodexPath: string | null = null

/** the Codex executable shipped inside the installer; null when this run has none */
export function configureBundledCodex(path: string | null): void {
  bundledCodexPath = path
}
```

In `resolveCodexCliPath`, after the `if (configured) { … }` block and before `if (managedRoot)`:

```ts
const bundled = options.bundledPath === undefined ? bundledCodexPath : options.bundledPath
if (bundled && (await fileExists(bundled))) return bundled
```

Add the account helpers after `listCodexModels`:

```ts
export type CodexAccountState =
  | { state: 'connected'; account: string }
  | { state: 'needs-login' }
  | { state: 'missing'; reason: string }
  | { state: 'error'; reason: string }

/** the app-server's account/read answer as a connection state */
export function accountStateOf(answer: unknown): CodexAccountState {
  const a = objectValue(answer)
  if (!a) return { state: 'error', reason: 'no account answer' }
  const account = objectValue(a.account)
  if (!account)
    return a.requiresOpenaiAuth === false
      ? { state: 'connected', account: 'API key' }
      : { state: 'needs-login' }
  const email = typeof account.email === 'string' && account.email ? account.email : ''
  return { state: 'connected', account: email || 'ChatGPT' }
}

/** whether Codex is signed in, asked of the app-server (no login is started) */
export async function readCodexAccount(cliPath?: string): Promise<CodexAccountState> {
  let resolved: string
  try {
    resolved = await resolveCodexCliPath(cliPath)
  } catch (err) {
    return { state: 'missing', reason: err instanceof Error ? err.message : String(err) }
  }
  try {
    return accountStateOf(
      await withClient(cliPath, (client) =>
        client.request('account/read', { refreshToken: false }),
      ),
    )
  } catch (err) {
    return {
      state: 'error',
      reason: `${resolved}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
    }
  }
}
```

(`withClient` is the existing helper `listCodexModels` uses; `objectValue` is the existing file-local helper.) Export `configureBundledCodex`, `readCodexAccount`, `accountStateOf` and `type CodexAccountState` from `index.ts` next to the other `codex-app-server` exports.

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run packages/ai-provider && npm run typecheck -w @genoffice/ai-provider`
Expected: PASS (existing codex tests stay green: the bundled step is skipped when no bundled path is configured).

```bash
git add packages/ai-provider
git commit -F <message file>   # "feat(ai-provider): look for a bundled Codex first and read its account state"
```

---

### Task 7: Fetch and ship Codex in the installer

**Files:**

- Create: `tools/fetch-codex-cli.mjs`, `tools/codex-cli.pin.json`
- Modify: `apps/shell/electron-builder.cjs`, `package.json`, `.gitignore`, `ACKNOWLEDGMENTS.md`, `MODIFICATIONS.md`

**Interfaces:**

- Produces: `apps/shell/build/codex/{bin/codex.exe, bin/codex-code-mode-host.exe, codex-resources/*.exe, codex-path/rg.exe, codex-package.json, LICENSE, SOURCE.txt}` and the same tree under `resources/codex/` in the installer.

- [ ] **Step 1: The pin** `tools/codex-cli.pin.json`

```json
{
  "package": "@openai/codex",
  "version": "0.162.1-win32-x64",
  "integrity": "sha512-dfl4MhHuEi0ARKyNmrTxk+RQmsWNCQAoVLUtrYq+yrW1C8P2sg5ziwgHUUACHjYLKuACV7ARH5Nq5pnCz3GlaQ==",
  "tarball": "https://registry.npmjs.org/@openai/codex/-/codex-0.162.1-win32-x64.tgz",
  "licenseUrl": "https://raw.githubusercontent.com/openai/codex/rust-v0.162.1/LICENSE"
}
```

- [ ] **Step 2: The fetch script** `tools/fetch-codex-cli.mjs` (Windows x64 only; elsewhere it prints a notice and exits 0; `tar` ships with Windows 10+ and Git for Windows):

```js
// Stage the Codex CLI for the Windows x64 installer.
//   node tools/fetch-codex-cli.mjs [--force]
// Downloads the pinned npm tarball, checks its integrity hash, and keeps only what chat needs
// (the voice resources are most of the size and are not used).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'shell', 'build', 'codex')
const pin = JSON.parse(readFileSync(join(ROOT, 'tools', 'codex-cli.pin.json'), 'utf8'))
const FORCE = process.argv.includes('--force')
const TARGET = 'x86_64-pc-windows-msvc'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('codex: only Windows x64 builds ship it; skipping')
  process.exit(0)
}
const stamp = join(OUT, '.version')
if (
  !FORCE &&
  existsSync(join(OUT, 'bin', 'codex.exe')) &&
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8') === pin.version
) {
  console.log(`codex: up to date (${pin.version}), skipping`)
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'codex-fetch-'))
try {
  const res = await fetch(pin.tarball)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (integrity !== pin.integrity) throw new Error(`integrity mismatch: got ${integrity}`)
  const tgz = join(work, 'codex.tgz')
  writeFileSync(tgz, bytes)
  const vendor = `package/vendor/${TARGET}`
  execFileSync(
    'tar',
    [
      '-xzf',
      tgz,
      '-C',
      work,
      `${vendor}/bin`,
      `${vendor}/codex-path`,
      `${vendor}/codex-package.json`,
      `${vendor}/codex-resources/codex-command-runner.exe`,
      `${vendor}/codex-resources/codex-windows-sandbox-setup.exe`,
    ],
    { stdio: 'inherit' },
  )
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  execFileSync('tar', ['-cf', join(work, 'stage.tar'), '-C', join(work, vendor), '.'])
  execFileSync('tar', ['-xf', join(work, 'stage.tar'), '-C', OUT])
  const license = await fetch(pin.licenseUrl)
  if (!license.ok) throw new Error(`license download failed: HTTP ${license.status}`)
  writeFileSync(join(OUT, 'LICENSE'), await license.text())
  writeFileSync(
    join(OUT, 'SOURCE.txt'),
    [
      'Codex CLI (Apache-2.0), unmodified.',
      '',
      `Package: ${pin.package}@${pin.version}`,
      `Integrity: ${pin.integrity}`,
      'Source: https://github.com/openai/codex',
      'Only the files chat needs are included; the voice resources are left out.',
      '',
    ].join('\n'),
  )
  writeFileSync(stamp, pin.version)
  console.log(`codex: staged ${pin.version} in ${OUT}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
```

- [ ] **Step 3: Run it**

Run: `node tools/fetch-codex-cli.mjs`
Expected: prints `codex: staged 0.162.1-win32-x64 …`; `apps/shell/build/codex/bin/codex.exe --version` prints `codex-cli 0.162.1`; running it again prints `up to date`. If the tar extraction of the nested folders fails on this machine, extract the whole `vendor/<target>` directory except `codex-resources/voice` with `--exclude` instead.

- [ ] **Step 4: Installer config** — `apps/shell/electron-builder.cjs`: in the Windows `extraResources` list, after the `llm-wiki` entry, add

```js
      // Codex CLI (Apache-2.0): the ChatGPT-login connection mode (tools/fetch-codex-cli.mjs)
      {
        from: 'build/codex',
        to: 'codex',
        filter: ['**/*', '!.version'],
      },
```

and next to `assertLlmWikiStaged`:

```js
function assertCodexStaged() {
  if (!existsSync(join(__dirname, 'build/codex/bin/codex.exe'))) {
    throw new Error('Codex is not staged: run npm run fetch:codex-cli (build/codex/bin/codex.exe)')
  }
}
```

called in `beforePack` beside `assertLlmWikiStaged()` under the same `win32 && !winArm64` condition. `package.json`: `"fetch:codex-cli": "node tools/fetch-codex-cli.mjs"` and `dist:win` becomes `npm run fetch:llm-wiki && npm run fetch:codex-cli && npm run notices && …`. `.gitignore`: `/apps/shell/build/codex/`.

- [ ] **Step 5: Notices** — `ACKNOWLEDGMENTS.md`: a paragraph "The Codex connection mode ships the unmodified Codex CLI by OpenAI (Apache-2.0) in `resources/codex/`, with its license and `SOURCE.txt`." `MODIFICATIONS.md`: a bullet "**Codex connection:** the installer carries the Codex CLI; Settings can sign in and connect it, and the work wiki can learn through it."

- [ ] **Step 6: Verify and commit**

Run: `npx prettier --check tools/fetch-codex-cli.mjs tools/codex-cli.pin.json apps/shell/electron-builder.cjs ACKNOWLEDGMENTS.md MODIFICATIONS.md && npm run check:english-comments && node -e "require('./apps/shell/electron-builder.cjs'); console.log('config loads')"`
Expected: OK.

```bash
git add tools apps/shell/electron-builder.cjs package.json .gitignore ACKNOWLEDGMENTS.md MODIFICATIONS.md
git commit -F <message file>   # "build: ship the Codex CLI with the Windows installer (Apache-2.0, pinned and checked)"
```

---

### Task 8: Codex status and login in the main process

**Files:**

- Create: `apps/shell/src/main/codex-connection.ts`
- Create: `apps/shell/tests/codex-connection.test.ts`
- Modify: `apps/shell/src/main/index.ts` (register), `src/shared/home-api.ts`, `src/preload/index.ts`

**Interfaces:**

- Consumes: `readCodexAccount`, `configureBundledCodex`, `CodexAccountState` (Task 6).
- Produces:
  - `bundledCodexExe(resourcesPath: string | undefined, devDir: string): string | null` — `<resources>/codex/bin/codex.exe`, else `<devDir>/codex/bin/codex.exe`, else null.
  - `class CodexLogin` with `start(): Promise<void>`, `cancel(): void`, `status(): CodexLoginStatus`, where `CodexLoginStatus = { state: 'idle' | 'waiting' | 'done' | 'failed'; url?: string; reason?: string }`; options `{ exePath: () => Promise<string>; spawn: (exe: string, args: string[]) => LoginChild; readAccount: () => Promise<CodexAccountState>; pollMs?: number; timeoutMs?: number }`, `LoginChild { stdout: { on(e: 'data', cb: (b: Buffer) => void): unknown }; on(e: 'exit', cb: (code: number | null) => void): unknown; kill(): boolean }`.
  - IPC: `home:get-codex-status` → `CodexAccountState & { loginable: boolean }`; `home:start-codex-login` → `CodexLoginStatus`; `home:get-codex-login` → `CodexLoginStatus`; `home:cancel-codex-login` → `void`. `HomeApi`: `getCodexStatus()`, `startCodexLogin()`, `getCodexLogin()`, `cancelCodexLogin()`.

- [ ] **Step 1: Write the failing test** `apps/shell/tests/codex-connection.test.ts`

```ts
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { bundledCodexExe, CodexLogin } from '../src/main/codex-connection'
import type { LoginChild } from '../src/main/codex-connection'

class FakeLogin extends EventEmitter implements LoginChild {
  stdout = new EventEmitter()
  killed = false
  kill() {
    this.killed = true
    this.emit('exit', null)
    return true
  }
}

const make = (over: Partial<ConstructorParameters<typeof CodexLogin>[0]> = {}) => {
  const children: FakeLogin[] = []
  let signedIn = false
  const login = new CodexLogin({
    exePath: async () => 'C:/res/codex/bin/codex.exe',
    spawn: vi.fn(() => {
      const c = new FakeLogin()
      children.push(c)
      return c
    }),
    readAccount: async () =>
      signedIn ? { state: 'connected', account: 'a@b.test' } : { state: 'needs-login' },
    pollMs: 5,
    timeoutMs: 400,
    ...over,
  })
  return { login, children, signIn: () => (signedIn = true) }
}

describe('bundledCodexExe', () => {
  it('prefers the installed copy, then the dev build, else null', () => {
    const res = mkdtempSync(join(tmpdir(), 'res-'))
    const dev = mkdtempSync(join(tmpdir(), 'dev-'))
    expect(bundledCodexExe(res, dev)).toBeNull()
    mkdirSync(join(dev, 'codex', 'bin'), { recursive: true })
    writeFileSync(join(dev, 'codex', 'bin', 'codex.exe'), 'x')
    expect(bundledCodexExe(undefined, dev)).toBe(join(dev, 'codex', 'bin', 'codex.exe'))
    mkdirSync(join(res, 'codex', 'bin'), { recursive: true })
    writeFileSync(join(res, 'codex', 'bin', 'codex.exe'), 'x')
    expect(bundledCodexExe(res, dev)).toBe(join(res, 'codex', 'bin', 'codex.exe'))
  })
})

describe('CodexLogin', () => {
  it('starts codex login, reports the page address it prints, and finishes when the account shows up', async () => {
    const { login, children, signIn } = make()
    await login.start()
    expect(login.status().state).toBe('waiting')
    children[0]!.stdout.emit(
      'data',
      Buffer.from('Open https://auth.test/oauth/authorize?x=1 to sign in\n'),
    )
    expect(login.status().url).toBe('https://auth.test/oauth/authorize?x=1')
    signIn()
    await new Promise((r) => setTimeout(r, 40))
    expect(login.status().state).toBe('done')
    expect(children[0]!.killed).toBe(true) // the child is stopped once signed in
  })

  it('ignores a second start while one is running', async () => {
    const { login, children } = make()
    await login.start()
    await login.start()
    expect(children).toHaveLength(1)
  })

  it('cancel stops the child and goes back to idle', async () => {
    const { login, children } = make()
    await login.start()
    login.cancel()
    expect(children[0]!.killed).toBe(true)
    expect(login.status().state).toBe('idle')
  })

  it('fails with the exit code when the child exits before anyone signed in', async () => {
    const { login, children } = make()
    await login.start()
    children[0]!.emit('exit', 2)
    await new Promise((r) => setTimeout(r, 20))
    expect(login.status()).toMatchObject({ state: 'failed' })
    expect(login.status().reason).toMatch(/2/)
  })

  it('times out with a reason and stops the child', async () => {
    const { login, children } = make({ timeoutMs: 60 })
    await login.start()
    await new Promise((r) => setTimeout(r, 120))
    expect(login.status()).toMatchObject({ state: 'failed' })
    expect(children[0]!.killed).toBe(true)
  })

  it('a spawn that throws is a failed state, not an exception', async () => {
    const { login } = make({
      spawn: () => {
        throw new Error('ENOENT')
      },
    })
    await expect(login.start()).resolves.toBeUndefined()
    expect(login.status()).toMatchObject({ state: 'failed', reason: 'ENOENT' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/shell/tests/codex-connection.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `apps/shell/src/main/codex-connection.ts`

```ts
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import {
  configureBundledCodex,
  readCodexAccount,
  resolveCodexCliPath,
  validCliPath,
} from '@genoffice/ai-provider'
import type { CodexAccountState } from '@genoffice/ai-provider'
import { HOME_CHANNELS } from '../shared/home-api'

/** <resources>/codex/bin/codex.exe, else the dev build (apps/shell/build/codex); null when absent */
export function bundledCodexExe(resourcesPath: string | undefined, devDir: string): string | null {
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'codex', 'bin', 'codex.exe')] : []),
    join(devDir, 'codex', 'bin', 'codex.exe'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

export interface LoginChild {
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): unknown }
  on(event: 'exit', cb: (code: number | null) => void): unknown
  kill(): boolean
}

export interface CodexLoginStatus {
  state: 'idle' | 'waiting' | 'done' | 'failed'
  url?: string
  reason?: string
}

export interface CodexLoginOptions {
  exePath: () => Promise<string>
  spawn: (exe: string, args: string[]) => LoginChild
  readAccount: () => Promise<CodexAccountState>
  pollMs?: number
  timeoutMs?: number
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/

/** runs `codex login` (browser OAuth) and watches the account until it is signed in */
export class CodexLogin {
  private child: LoginChild | null = null
  private current: CodexLoginStatus = { state: 'idle' }
  private timer: ReturnType<typeof setInterval> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly o: CodexLoginOptions) {}

  status(): CodexLoginStatus {
    return { ...this.current }
  }

  async start(): Promise<void> {
    if (this.current.state === 'waiting') return
    this.current = { state: 'waiting' }
    try {
      const exe = await this.o.exePath()
      const child = this.o.spawn(exe, ['login'])
      this.child = child
      child.stdout.on('data', (chunk) => {
        const m = URL_PATTERN.exec(String(chunk))
        if (m && this.current.state === 'waiting') this.current = { ...this.current, url: m[0] }
      })
      child.on('exit', (code) => {
        if (this.child !== child) return
        this.child = null
        // an exit while still waiting is a failure unless the account is already there
        void this.o.readAccount().then((a) => {
          if (this.current.state !== 'waiting') return
          if (a.state === 'connected') this.finish({ state: 'done' })
          else this.finish({ state: 'failed', reason: `codex login exited (${code ?? 'none'})` })
        })
      })
      this.timer = setInterval(() => void this.poll(), this.o.pollMs ?? 1500)
      this.deadline = setTimeout(
        () => this.finish({ state: 'failed', reason: 'sign-in timed out' }),
        this.o.timeoutMs ?? 5 * 60_000,
      )
    } catch (err) {
      this.finish({ state: 'failed', reason: err instanceof Error ? err.message : String(err) })
    }
  }

  private async poll(): Promise<void> {
    if (this.current.state !== 'waiting') return
    const a = await this.o.readAccount().catch(() => null)
    if (a?.state === 'connected') this.finish({ state: 'done' })
  }

  private finish(next: CodexLoginStatus): void {
    if (this.timer) clearInterval(this.timer)
    if (this.deadline) clearTimeout(this.deadline)
    this.timer = this.deadline = null
    const child = this.child
    this.child = null
    this.current = next
    child?.kill()
  }

  cancel(): void {
    if (this.current.state !== 'waiting') return
    this.finish({ state: 'idle' })
  }
}

let login: CodexLogin | null = null

/** the Settings screen's view of Codex: whether it can be signed in, and who is */
export async function codexStatus(
  cliPath?: string,
): Promise<CodexAccountState & { loginable: boolean }> {
  const state = await readCodexAccount(cliPath)
  return { ...state, loginable: state.state !== 'missing' }
}

export function registerCodexIpc(): void {
  const resources = app.isPackaged ? process.resourcesPath : undefined
  configureBundledCodex(bundledCodexExe(resources, join(app.getAppPath(), 'build')))
  login = new CodexLogin({
    exePath: () => resolveCodexCliPath(),
    spawn: (exe, args) =>
      spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: loginEnv() }),
    readAccount: () => readCodexAccount(),
  })
  ipcMain.handle(HOME_CHANNELS.getCodexStatus, (_e, cliPath: unknown) =>
    codexStatus(validCliPath(cliPath) ? cliPath.trim() : undefined),
  )
  ipcMain.handle(HOME_CHANNELS.startCodexLogin, async () => {
    await login!.start()
    return login!.status()
  })
  ipcMain.handle(HOME_CHANNELS.getCodexLogin, () => login!.status())
  ipcMain.handle(HOME_CHANNELS.cancelCodexLogin, () => login!.cancel())
}

/** the login child reads the same home as the app-server (the Hangul user folder included) */
function loginEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.platform === 'win32' && !env.HOME && env.USERPROFILE) env.HOME = env.USERPROFILE
  return env
}

/** the app is quitting: a pending sign-in must not leave a login child behind */
export function stopCodexLoginForQuit(): void {
  login?.cancel()
}
```

`home-api.ts`: channels `getCodexStatus: 'home:get-codex-status'`, `startCodexLogin: 'home:start-codex-login'`, `getCodexLogin: 'home:get-codex-login'`, `cancelCodexLogin: 'home:cancel-codex-login'`; types and members:

```ts
export type CodexStatusView =
  | { state: 'connected'; account: string; loginable: boolean }
  | { state: 'needs-login'; loginable: boolean }
  | { state: 'missing'; reason: string; loginable: boolean }
  | { state: 'error'; reason: string; loginable: boolean }
export interface CodexLoginView {
  state: 'idle' | 'waiting' | 'done' | 'failed'
  url?: string
  reason?: string
}
// in HomeApi:
  getCodexStatus(cliPath?: string): Promise<CodexStatusView>
  startCodexLogin(): Promise<CodexLoginView>
  getCodexLogin(): Promise<CodexLoginView>
  cancelCodexLogin(): Promise<void>
```

`preload/index.ts`: four wrappers in the style of `getLlmWikiStatus`. `main/index.ts`: `registerCodexIpc()` next to `registerWorkWikiIpc()`, and `stopCodexLoginForQuit()` inside the existing quit path (`stopWorkWikiForQuit` is async; call `stopCodexLoginForQuit()` first thing inside `before-quit`'s first branch).

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run apps/shell/tests/codex-connection.test.ts && npm run typecheck -w @genoffice/shell`
Expected: PASS (7 tests).

```bash
git add apps/shell
git commit -F <message file>   # "feat(shell): Codex status and browser sign-in from the main process"
```

---

### Task 9: The Codex card shows status and signs in

**Files:**

- Create: `apps/shell/src/renderer/src/CodexConnectionRow.tsx`
- Modify: `apps/shell/src/renderer/src/SettingsModal.tsx`, `strings.ts`
- Test: `apps/shell/tests/codex-connection-ui.test.ts`

**Interfaces:**

- Consumes: `window.aiOffice.getCodexStatus/startCodexLogin/getCodexLogin/cancelCodexLogin` (Task 8).
- Produces: `CodexConnectionRow({ t, cliPath, onConnected })`; string keys `setCodexConnected` (`{account}`), `setCodexNeedsLogin`, `setCodexMissing`, `setCodexError` (`{reason}`), `setCodexLogin`, `setCodexLoginWaiting`, `setCodexLoginCancel`, `setCodexCheck`, `setCodexLoginUrl`, `setCodexLoginFailed` (`{reason}`).

- [ ] **Step 1: Write the failing test** `apps/shell/tests/codex-connection-ui.test.ts` (jsdom; mounts `CodexConnectionRow` directly, with the `t` stub from `work-wiki-settings-ui.test.ts` that returns the key, and `window.aiOffice` stubs):

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexLoginView, CodexStatusView, HomeApi } from '../src/shared/home-api'
import { CodexConnectionRow } from '../src/renderer/src/CodexConnectionRow'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const t = ((key: string, p?: Record<string, string>) =>
  p ? `${key}:${Object.values(p).join(',')}` : key) as never

async function render(status: CodexStatusView, login: CodexLoginView = { state: 'idle' }) {
  const start = vi.fn(async (): Promise<CodexLoginView> => ({
    state: 'waiting',
    url: 'https://auth.test/x',
  }))
  const cancel = vi.fn(async () => undefined)
  window.aiOffice = {
    getCodexStatus: async () => status,
    getCodexLogin: async () => login,
    startCodexLogin: start,
    cancelCodexLogin: cancel,
  } as unknown as HomeApi
  await act(async () => {
    root.render(createElement(CodexConnectionRow, { t, cliPath: '', onConnected: vi.fn() }))
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return { start, cancel }
}

const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label) as
    HTMLButtonElement | undefined

describe('Codex connection row', () => {
  it('shows who is connected and no login button', async () => {
    await render({ state: 'connected', account: 'a@b.test', loginable: true })
    expect(host.textContent).toContain('setCodexConnected:a@b.test')
    expect(button('setCodexLogin')).toBeUndefined()
  })

  it('offers Login when sign-in is needed and starts it', async () => {
    const { start } = await render({ state: 'needs-login', loginable: true })
    expect(host.textContent).toContain('setCodexNeedsLogin')
    await act(async () => {
      button('setCodexLogin')!.click()
      await Promise.resolve()
    })
    expect(start).toHaveBeenCalled()
    expect(host.textContent).toContain('https://auth.test/x')
    expect(button('setCodexLoginCancel')).toBeDefined()
  })

  it('says the component is missing and offers no login', async () => {
    await render({ state: 'missing', reason: 'x', loginable: false })
    expect(host.textContent).toContain('setCodexMissing')
    expect(button('setCodexLogin')).toBeUndefined()
  })

  it('cancels a running sign-in', async () => {
    const { cancel } = await render({ state: 'needs-login', loginable: true }, { state: 'waiting' })
    await act(async () => {
      button('setCodexLoginCancel')!.click()
      await Promise.resolve()
    })
    expect(cancel).toHaveBeenCalled()
  })

  it('shows why a sign-in failed', async () => {
    await render(
      { state: 'needs-login', loginable: true },
      { state: 'failed', reason: 'timed out' },
    )
    expect(host.textContent).toContain('setCodexLoginFailed:timed out')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/shell/tests/codex-connection-ui.test.ts`
Expected: FAIL (component missing).

- [ ] **Step 3: Implement** `CodexConnectionRow.tsx`

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { CodexLoginView, CodexStatusView } from '../../shared/home-api'
import type { TFunc } from './locale'

const POLL_MS = 1500

/** Settings → AI model → Codex: who is signed in, and a browser sign-in when nobody is */
export function CodexConnectionRow({
  t,
  cliPath,
  onConnected,
}: {
  t: TFunc
  cliPath: string
  onConnected: () => void
}) {
  const [status, setStatus] = useState<CodexStatusView | null>(null)
  const [login, setLogin] = useState<CodexLoginView>({ state: 'idle' })

  const refresh = useCallback(async () => {
    const [s, l] = await Promise.all([
      window.aiOffice.getCodexStatus?.(cliPath),
      window.aiOffice.getCodexLogin?.(),
    ])
    if (s) setStatus(s)
    if (l) setLogin(l)
    if (s?.state === 'connected') onConnected()
  }, [cliPath, onConnected])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // while a sign-in runs the answer can change at any moment
  useEffect(() => {
    if (login.state !== 'waiting') return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [login.state, refresh])

  if (!status) return null
  const text =
    status.state === 'connected'
      ? t('setCodexConnected', { account: status.account })
      : status.state === 'needs-login'
        ? t('setCodexNeedsLogin')
        : status.state === 'missing'
          ? t('setCodexMissing')
          : t('setCodexError', { reason: status.reason })

  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-stack">
          <div className="set-field-label">{text}</div>
          {login.state === 'waiting' && (
            <div className="set-field-desc">
              {t('setCodexLoginWaiting')}
              {login.url && (
                <>
                  {' '}
                  {t('setCodexLoginUrl')} <span className="set-code">{login.url}</span>
                </>
              )}
            </div>
          )}
          {login.state === 'failed' && (
            <div className="set-field-desc">
              {t('setCodexLoginFailed', { reason: login.reason ?? '' })}
            </div>
          )}
        </div>
      </div>
      <div>
        {status.state === 'needs-login' && status.loginable && login.state !== 'waiting' && (
          <button
            className="set-btn primary"
            onClick={() => void window.aiOffice.startCodexLogin?.().then((l) => l && setLogin(l))}
          >
            {t('setCodexLogin')}
          </button>
        )}
        {login.state === 'waiting' && (
          <button
            className="set-btn"
            onClick={() =>
              void window.aiOffice.cancelCodexLogin?.().then(() => setLogin({ state: 'idle' }))
            }
          >
            {t('setCodexLoginCancel')}
          </button>
        )}{' '}
        <button className="set-btn" onClick={() => void refresh()}>
          {t('setCodexCheck')}
        </button>
      </div>
    </div>
  )
}
```

In `AiModelPane`'s Codex branch (above the model dropdown, inside the `isCodex` rendering), render `<CodexConnectionRow t={t} cliPath={config.cliPath ?? ''} onConnected={() => void refreshCodexModels(config.cliPath ?? '', config.model).catch(() => undefined)} />`. Strings (21 languages, after `setAiCodexAdvanced`): en `Connected · {account}` / `Sign-in needed` / `The bundled Codex component is missing` / `Codex could not be checked: {reason}` / `Sign in` / `Waiting for the browser sign-in…` / `Cancel` / `Check connection` / `If the browser did not open, open this address:` / `Sign-in failed: {reason}`; ko `연결됨 · {account}` / `로그인이 필요합니다` / `포함된 Codex 구성 요소가 없습니다` / `Codex를 확인하지 못했습니다: {reason}` / `로그인` / `브라우저에서 로그인하기를 기다리는 중…` / `취소` / `연결 확인` / `브라우저가 열리지 않으면 이 주소를 여세요:` / `로그인하지 못했습니다: {reason}`; zh and zh-TW and ja natively, English elsewhere (same insertion script as Task 4).

- [ ] **Step 4: Run tests and checks, commit**

Run: `npx vitest run apps/shell/tests/codex-connection-ui.test.ts apps/shell/tests/settings-ai-modes.test.ts && npm run typecheck -w @genoffice/shell && npm run check:english-comments && npm run check:theme-colors`
Expected: PASS. (`.set-code` may not exist; if `check:theme-colors` or the look needs it, add `.set-code { font-family: ui-monospace, monospace; word-break: break-all; }` with no colors.)

```bash
npx prettier --write apps/shell/src/renderer/src apps/shell/tests/codex-connection-ui.test.ts
git add apps/shell
git commit -F <message file>   # "feat(shell): Codex card shows who is signed in and starts the browser sign-in"
```

---

# Part C: Codex → LLM Wiki

### Task 10: The loopback adapter

**Files:**

- Create: `apps/shell/src/main/codex-bridge.ts`
- Create: `apps/shell/tests/codex-bridge.test.ts`

**Interfaces:**

- Produces:
  - `interface BridgeCompleteRequest { system: string; messages: AgentMessage[]; model: string; maxTokens: number; signal: AbortSignal; onDelta: (text: string) => void }`
  - `interface CodexBridgeOptions { complete: (req: BridgeCompleteRequest) => Promise<void>; model: () => string; token?: string; requestTimeoutMs?: number; maxBodyBytes?: number }`
  - `class CodexBridge { start(): Promise<{ baseUrl: string; token: string }>; stop(): Promise<void> }` — `baseUrl` is `http://127.0.0.1:<port>/v1`.

- [ ] **Step 1: Write the failing test** `apps/shell/tests/codex-bridge.test.ts`

```ts
import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexBridge } from '../src/main/codex-bridge'
import type { BridgeCompleteRequest } from '../src/main/codex-bridge'

let bridge: CodexBridge | null = null
afterEach(async () => {
  await bridge?.stop()
  bridge = null
})

async function boot(
  complete: (r: BridgeCompleteRequest) => Promise<void>,
  over: Partial<ConstructorParameters<typeof CodexBridge>[0]> = {},
) {
  bridge = new CodexBridge({ complete, model: () => 'gpt-test', requestTimeoutMs: 500, ...over })
  return bridge.start()
}

const call = (
  baseUrl: string,
  path: string,
  init: { token?: string; host?: string; body?: unknown; method?: string } = {},
) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const u = new URL(baseUrl + path)
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: {
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          ...(init.host ? { Host: init.host } : {}),
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let text = ''
        res.on('data', (d) => (text += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      },
    )
    req.on('error', reject)
    if (init.body !== undefined) req.write(JSON.stringify(init.body))
    req.end()
  })

const chat = (stream: boolean) => ({
  model: 'whatever',
  stream,
  messages: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  ],
})

describe('CodexBridge', () => {
  it('refuses a request without the token and one with a foreign Host', async () => {
    const { baseUrl, token } = await boot(async () => undefined)
    expect((await call(baseUrl, '/models')).status).toBe(401)
    expect((await call(baseUrl, '/models', { token: 'wrong' })).status).toBe(401)
    expect((await call(baseUrl, '/models', { token, host: 'evil.test' })).status).toBe(403)
    expect((await call(baseUrl, '/models', { token })).status).toBe(200)
  })

  it('lists the one model it serves', async () => {
    const { baseUrl, token } = await boot(async () => undefined)
    const r = JSON.parse((await call(baseUrl, '/models', { token })).text)
    expect(r.data.map((m: { id: string }) => m.id)).toEqual(['gpt-test'])
  })

  it('answers a plain chat completion from the Codex call', async () => {
    let seen: BridgeCompleteRequest | null = null
    const { baseUrl, token } = await boot(async (r) => {
      seen = r
      r.onDelta('안녕')
      r.onDelta('하세요')
    })
    const r = await call(baseUrl, '/chat/completions', { token, body: chat(false) })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text).choices[0].message).toEqual({
      role: 'assistant',
      content: '안녕하세요',
    })
    expect(seen!.system).toBe('be brief')
    expect(seen!.messages).toEqual([{ role: 'user', text: 'hello' }])
  })

  it('streams the reply as server-sent events ending with [DONE]', async () => {
    const { baseUrl, token } = await boot(async (r) => {
      r.onDelta('a')
      r.onDelta('b')
    })
    const r = await call(baseUrl, '/chat/completions', { token, body: chat(true) })
    const lines = r.text.split('\n').filter((l) => l.startsWith('data: '))
    expect(lines.at(-1)).toBe('data: [DONE]')
    const deltas = lines
      .slice(0, -1)
      .map((l) => JSON.parse(l.slice(6)).choices[0].delta.content ?? '')
    expect(deltas.join('')).toBe('ab')
  })

  it('serves two requests one after the other', async () => {
    const order: string[] = []
    const { baseUrl, token } = await boot(async (r) => {
      order.push(`start ${r.messages[0] && 'text' in r.messages[0] ? r.messages[0].text : ''}`)
      await new Promise((res) => setTimeout(res, 40))
      order.push('end')
      r.onDelta('x')
    })
    const body = (text: string) => ({ messages: [{ role: 'user', content: text }] })
    await Promise.all([
      call(baseUrl, '/chat/completions', { token, body: body('one') }),
      call(baseUrl, '/chat/completions', { token, body: body('two') }),
    ])
    expect(order).toEqual(['start one', 'end', 'start two', 'end'])
  })

  it('aborts the Codex call when the client goes away', async () => {
    let aborted = false
    const { baseUrl, token } = await boot(
      (r) =>
        new Promise<void>((resolve) => {
          r.signal.addEventListener('abort', () => {
            aborted = true
            resolve()
          })
        }),
    )
    const u = new URL(baseUrl + '/chat/completions')
    await new Promise<void>((resolve) => {
      const req = request(
        {
          host: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        },
        () => undefined,
      )
      req.on('error', () => resolve())
      req.write(JSON.stringify(chat(false)))
      req.end()
      setTimeout(() => {
        req.destroy()
        resolve()
      }, 50)
    })
    await new Promise((r) => setTimeout(r, 80))
    expect(aborted).toBe(true)
  })

  it('answers 502 with the reason when Codex fails before any text', async () => {
    const { baseUrl, token } = await boot(async () => {
      throw new Error('Codex CLI is not signed in')
    })
    const r = await call(baseUrl, '/chat/completions', { token, body: chat(false) })
    expect(r.status).toBe(502)
    expect(JSON.parse(r.text).error.message).toContain('not signed in')
  })

  it('refuses a body over the limit and a bad body', async () => {
    const { baseUrl, token } = await boot(async () => undefined, { maxBodyBytes: 200 })
    const big = await call(baseUrl, '/chat/completions', {
      token,
      body: { messages: [{ role: 'user', content: 'x'.repeat(500) }] },
    })
    expect(big.status).toBe(413)
    const bad = await call(baseUrl, '/chat/completions', { token, body: { messages: 'no' } })
    expect(bad.status).toBe(400)
  })

  it('times a request out with 504', async () => {
    const { baseUrl, token } = await boot(() => new Promise<void>(() => undefined), {
      requestTimeoutMs: 60,
    })
    const r = await call(baseUrl, '/chat/completions', { token, body: chat(false) })
    expect(r.status).toBe(504)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/shell/tests/codex-bridge.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `apps/shell/src/main/codex-bridge.ts`

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentMessage } from '@genoffice/agent-core'

export interface BridgeCompleteRequest {
  system: string
  messages: AgentMessage[]
  model: string
  maxTokens: number
  signal: AbortSignal
  onDelta: (text: string) => void
}

export interface CodexBridgeOptions {
  /** one turn through Codex; text arrives through onDelta, a failure is a throw */
  complete: (req: BridgeCompleteRequest) => Promise<void>
  /** the model id this adapter reports */
  model: () => string
  token?: string
  requestTimeoutMs?: number
  maxBodyBytes?: number
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_MAX_BODY = 8 * 1024 * 1024
const DEFAULT_MAX_TOKENS = 8192

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((p) =>
      p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
        ? (p as { text: string }).text
        : '',
    )
    .join('')
}

/** the OpenAI-style messages as a system prompt and agent messages */
function toAgentMessages(body: unknown): {
  system: string
  messages: AgentMessage[]
  maxTokens: number
  stream: boolean
} {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'body must be an object')
  const b = body as {
    messages?: unknown
    max_tokens?: unknown
    max_completion_tokens?: unknown
    stream?: unknown
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0)
    throw new HttpError(400, 'messages must be a non-empty array')
  const systems: string[] = []
  const messages: AgentMessage[] = []
  for (const m of b.messages) {
    if (!m || typeof m !== 'object') throw new HttpError(400, 'bad message')
    const { role, content } = m as { role?: unknown; content?: unknown }
    const text = textOf(content)
    if (role === 'system' || role === 'developer') systems.push(text)
    else if (role === 'user') messages.push({ role: 'user', text })
    else if (role === 'assistant') messages.push({ role: 'assistant', text })
  }
  if (messages.length === 0) throw new HttpError(400, 'no user message')
  const cap = Number(b.max_completion_tokens ?? b.max_tokens)
  return {
    system: systems.join('\n\n'),
    messages,
    maxTokens: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_MAX_TOKENS,
    stream: b.stream === true,
  }
}

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new HttpError(413, 'body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'body is not JSON'))
      }
    })
    req.on('error', reject)
  })
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * A loopback OpenAI-compatible server in front of the Codex call, so LLM Wiki (which speaks chat
 * completions, not Codex) can learn through the user's ChatGPT sign-in. One request at a time.
 */
export class CodexBridge {
  private server: Server | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private readonly token: string

  constructor(private readonly o: CodexBridgeOptions) {
    this.token = o.token ?? randomBytes(24).toString('hex')
  }

  async start(): Promise<{ baseUrl: string; token: string }> {
    const server = createServer((req, res) => void this.handle(req, res))
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    return { baseUrl: `http://127.0.0.1:${port}/v1`, token: this.token }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '')
      if (host !== '127.0.0.1' && host !== 'localhost') throw new HttpError(403, 'loopback only')
      const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
      if (!sameToken(given, this.token)) throw new HttpError(401, 'unauthorized')
      const path = (req.url ?? '').split('?')[0]
      if (req.method === 'GET' && path === '/v1/models') {
        return sendJson(res, 200, {
          object: 'list',
          data: [{ id: this.o.model(), object: 'model', owned_by: 'codex' }],
        })
      }
      if (req.method === 'POST' && path === '/v1/chat/completions') {
        const parsed = toAgentMessages(await readBody(req, this.o.maxBodyBytes ?? DEFAULT_MAX_BODY))
        return await this.serialized(() => this.completion(res, parsed))
      }
      throw new HttpError(404, 'not found')
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      sendJson(res, status, {
        error: { message: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  /** requests wait for the one before them; a failure never blocks the queue */
  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job)
    this.tail = run.catch(() => undefined)
    return run
  }

  private async completion(
    res: ServerResponse,
    parsed: ReturnType<typeof toAgentMessages>,
  ): Promise<void> {
    const controller = new AbortController()
    let finished = false
    res.on('close', () => {
      if (!finished) controller.abort()
    })
    const timeout = setTimeout(
      () => controller.abort(new HttpError(504, 'Codex did not answer in time')),
      this.o.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    const id = `chatcmpl-${randomBytes(8).toString('hex')}`
    const model = this.o.model()
    let text = ''
    let streaming = false
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    try {
      await this.o.complete({
        system: parsed.system,
        messages: parsed.messages,
        model,
        maxTokens: parsed.maxTokens,
        signal: controller.signal,
        onDelta: (d) => {
          text += d
          if (!parsed.stream) return
          if (!streaming) {
            streaming = true
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
            res.write(chunk({ role: 'assistant' }, null))
          }
          res.write(chunk({ content: d }, null))
        },
      })
      if (controller.signal.aborted)
        throw controller.signal.reason instanceof HttpError
          ? controller.signal.reason
          : new HttpError(499, 'client closed')
      finished = true
      if (parsed.stream) {
        if (!streaming) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
          res.write(chunk({ role: 'assistant' }, null))
        }
        res.write(chunk({}, 'stop'))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      sendJson(res, 200, {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
    } catch (err) {
      finished = true
      if (res.headersSent) {
        res.destroy() // a stream already started: the client sees the connection drop
        return
      }
      const status = err instanceof HttpError ? err.status : 502
      sendJson(res, status, {
        error: { message: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run apps/shell/tests/codex-bridge.test.ts && npm run typecheck -w @genoffice/shell`
Expected: PASS (9 tests). If the abort test is flaky on the 50 ms timer, raise both waits to 150 ms rather than loosening the assertion.

```bash
npx prettier --write apps/shell/src/main/codex-bridge.ts apps/shell/tests/codex-bridge.test.ts
git add apps/shell
git commit -F <message file>   # "feat(shell): a loopback OpenAI-compatible adapter in front of Codex"
```

---

### Task 11: LLM Wiki learns through the adapter

**Files:**

- Modify: `apps/shell/src/main/llm-wiki-seed.ts`, `apps/shell/src/main/llm-wiki.ts`, `apps/shell/src/main/work-wiki.ts`, `apps/shell/src/main/index.ts`
- Modify: `apps/shell/tests/llm-wiki-seed.test.ts`, `apps/shell/tests/llm-wiki-glue.test.ts`

**Interfaces:**

- Consumes: `CodexBridge` (Task 10); `streamForProvider` (existing).
- Produces:
  - `llmWikiLlmFromAiSettings(settings: AiSettings, bridge?: { baseUrl: string; token: string; model: string })` — for the Codex provider with a bridge it returns a `custom` endpoint at the bridge; without one it still refuses.
  - `desiredSignature(llm, wikiRoot)` already includes the endpoint, so a new bridge address restarts LLM Wiki (no change needed; pinned by a test).

- [ ] **Step 1: Write the failing tests** — append to `llm-wiki-seed.test.ts`'s first `describe`:

```ts
it('lets Codex through a local bridge as a custom endpoint', () => {
  const bridge = { baseUrl: 'http://127.0.0.1:51234/v1', token: 'tok', model: 'gpt-test' }
  expect(
    llmWikiLlmFromAiSettings(settings('codex', { apiKey: '', model: '' }), bridge),
  ).toMatchObject({
    ok: true,
    llm: {
      provider: 'custom',
      apiKey: 'tok',
      model: 'gpt-test',
      customEndpoint: 'http://127.0.0.1:51234/v1',
      apiMode: 'chat_completions',
    },
  })
  // the model the user picked wins over the bridge's placeholder
  expect(
    llmWikiLlmFromAiSettings(settings('codex', { apiKey: '', model: 'gpt-picked' }), bridge),
  ).toMatchObject({ ok: true, llm: { model: 'gpt-picked' } })
  // without a bridge Codex is still refused
  expect(llmWikiLlmFromAiSettings(settings('codex', { apiKey: '', model: 'x' }))).toMatchObject({
    ok: false,
  })
})
```

and to `llm-wiki-glue.test.ts`'s `desiredSignature` describe:

```ts
it('changes when the bridge address changes', () => {
  const a = { ...llm, customEndpoint: 'http://127.0.0.1:51001/v1' }
  const b = { ...llm, customEndpoint: 'http://127.0.0.1:51002/v1' }
  expect(desiredSignature(a, 'D:/wiki')).not.toBe(desiredSignature(b, 'D:/wiki'))
})
```

- [ ] **Step 2: Run them to see the first fail**

Run: `npx vitest run apps/shell/tests/llm-wiki-seed.test.ts apps/shell/tests/llm-wiki-glue.test.ts`
Expected: the bridge test FAILS (a second argument is ignored and Codex is refused); the signature test already passes.

- [ ] **Step 3: Implement** in `llm-wiki-seed.ts`: change the signature and the Codex branch:

```ts
export interface CodexBridgeEndpoint {
  baseUrl: string
  token: string
  model: string
}

export function llmWikiLlmFromAiSettings(
  settings: AiSettings,
  bridge?: CodexBridgeEndpoint,
): { ok: true; llm: LlmWikiLlm } | { ok: false; reason: string } {
  const provider = settings.provider
  const config = settings.providers?.[provider]
  if (!config) return { ok: false, reason: 'no AI provider is configured' }
  const endpoint = getProviderAdapter(provider).resolveEndpoint(config)
  if (endpoint.protocol === 'codex-app-server') {
    if (!bridge) return { ok: false, reason: 'the Codex bridge is not running' }
    return {
      ok: true,
      llm: {
        provider: 'custom',
        apiKey: bridge.token,
        model: config.model || bridge.model,
        customEndpoint: bridge.baseUrl,
        ollamaUrl: 'http://localhost:11434',
        maxContextSize: MAX_CONTEXT,
        apiMode: 'chat_completions',
      },
    }
  }
  // …the rest of the function is unchanged…
```

In `work-wiki.ts`: add module state `let codexBridge: CodexBridge | null = null` and `let codexBridgeEndpoint: CodexBridgeEndpoint | null = null`, and these helpers above `startLlmWiki`:

```ts
/** the adapter that lets LLM Wiki use Codex; started only while the provider is Codex */
async function ensureCodexBridge(aiPath: string): Promise<CodexBridgeEndpoint | null> {
  const settings = readAiSettingsFile(aiPath)
  if (settings.provider !== 'codex') {
    await stopCodexBridge()
    return null
  }
  if (!codexBridge) {
    codexBridge = new CodexBridge({
      model: () => readAiSettingsFile(aiPath).providers.codex?.model || 'codex',
      complete: async ({ system, messages, maxTokens, signal, onDelta }) => {
        const cfg = readAiSettingsFile(aiPath).providers.codex
        if (!cfg) throw new Error('Codex is not configured')
        await streamForProvider('codex', cfg, system, messages, [], maxTokens, {
          signal,
          onDelta,
          onToolCall: () => {},
        })
      },
    })
    const { baseUrl, token } = await codexBridge.start()
    codexBridgeEndpoint = { baseUrl, token, model: 'codex' }
  }
  return codexBridgeEndpoint
}

async function stopCodexBridge(): Promise<void> {
  const b = codexBridge
  codexBridge = null
  codexBridgeEndpoint = null
  await b?.stop()
}
```

(imports: `CodexBridge` from `./codex-bridge`, `type CodexBridgeEndpoint` from `./llm-wiki-seed`.) In `startLlmWiki`, replace

```ts
const ai = llmWikiLlmFromAiSettings(readAiSettingsFile(aiPath))
```

with

```ts
const bridge = await ensureCodexBridge(aiPath)
const ai = llmWikiLlmFromAiSettings(readAiSettingsFile(aiPath), bridge ?? undefined)
```

and the drift timer's `llmWikiLlmFromAiSettings(readAiSettingsFile(aiPath))` call with `llmWikiLlmFromAiSettings(readAiSettingsFile(aiPath), codexBridgeEndpoint ?? undefined)`. At the very top of `startLlmWiki` (after stopping the old process) nothing else changes; in the early-return branches (`!s.enabled`, no exe) add `await stopCodexBridge()` before returning, and in `stopWorkWikiForQuit` add `stopCodexBridge()` into the `Promise.all([...])`. The bridge's port stays the same for the whole session, so `desiredSignature` only restarts LLM Wiki when the provider, model or key actually change.

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run apps/shell/tests/llm-wiki-seed.test.ts apps/shell/tests/llm-wiki-glue.test.ts apps/shell/tests/codex-bridge.test.ts && npm run typecheck -w @genoffice/shell && npm run check:english-comments`
Expected: PASS.

```bash
npx prettier --write apps/shell/src/main apps/shell/tests/llm-wiki-seed.test.ts apps/shell/tests/llm-wiki-glue.test.ts
git add apps/shell
git commit -F <message file>   # "feat(shell): LLM Wiki learns through Codex by way of the local adapter"
```

---

# Part D: Acceptance and release

### Task 12: Whole-suite check

- [ ] **Step 1: Run everything**

Run:
`npx vitest run packages/ai-provider packages/work-wiki`, `npx vitest run apps/shell`, `npx vitest run --project @genoffice/hwp`, then `npm run typecheck -w @genoffice/ai-provider -w @genoffice/work-wiki -w @genoffice/shell -w @genoffice/hwp -w @genoffice/docs -w @genoffice/slides -w @genoffice/sheets`, `npm run check:english-comments`, `npm run check:theme-colors`, and `npx eslint` + `npx prettier --check` on every file changed since `99346576` (`git diff --name-only 99346576 HEAD`).
Expected: green apart from the known Windows-path failures in the shell suite (headless-export, folder-tree, default-app, update-resume).

- [ ] **Step 2: Fix anything that is not a known failure**, each fix with its own test first; commit.

### Task 13: Acceptance run on this PC

**Files:** local only (`scripts/drivers/`, not tracked).

- [ ] **Step 1: LiteLLM mode in the app.** Build the apps (`for w in hwp docs slides shell; do npm run build -w @genoffice/$w; done`) and stage the packages (`npm run fetch:llm-wiki`, `npm run fetch:codex-cli`). Launch the dev shell on a clean profile (`GENOFFICE_USER_DATA`, a Hangul wiki folder) with `OPEN_GENOFFICE_ORG_DEFAULTS` pointing at a local file `{"ai":{"provider":"litellm","baseUrl":"<proxy>","model":"deepseek-flash"}}` (outside the repository), type the user's test key, and check with Playwright: the LiteLLM card is selected, the address is read-only, the model is `deepseek-flash`, Test passes, a Word chat answers.
- [ ] **Step 2: LLM Wiki on LiteLLM.** Run the earlier scenario driver (`scripts/drivers/driver.llm-wiki.mjs` with `ai-settings.json` set to the litellm provider): material added, pages created, the later task reads both wikis. Record the ingest time; if it is much slower than the DeepSeek-direct run (thinking), point the seed at `deepseek-flash-nothink` when the proxy lists it and rerun.
- [ ] **Step 3: Codex, not signed in.** In the Codex card: status shows "needs sign-in", the model list loads (the bundled app-server answers without a login), the Login button starts `codex login` and shows the address; Cancel kills the child (no `codex.exe login` process remains). Run it from the Hangul user folder (this PC's `C:\Users\김용현`), which covers Review Focus 7.
- [ ] **Step 4: Codex, signed in (needs the user).** Ask the user to press Login once and complete the browser page. Then: status shows the account; a Word chat answers; an LLM Wiki ingest through the adapter produces pages; the adapter refuses a request without the token; closing GenOffice stops `codex.exe`, `llm-wiki.exe` and the adapter. If the user does not want to sign in, say so in the report and leave this step unverified.
- [ ] **Step 5: Existing users.** With a profile that has an own-key provider (Anthropic) saved: the mode is "Own API keys" with that provider; moving to LiteLLM and back keeps the key.
- [ ] **Step 6: Report** which steps passed, which were not run, and any ingest-time or usage-limit finding.

### Task 14: Installer, review, push

- [ ] **Step 1: Build the installer** with the company variables set on the command line only (the address and `deepseek-flash` come from the user; they are not written to any file in the repository):
      `OPEN_GENOFFICE_LITELLM_URL=<address> OPEN_GENOFFICE_LITELLM_MODEL=deepseek-flash OPEN_GENOFFICE_WIN_SIDECAR_TARGET=x86_64-pc-windows-msvc LLM_WIKI_FORK_DIR=D:/llm_wiki_ubion/llm_wiki npm run dist:win`
      Check `apps/shell/release/win-unpacked/resources/` holds `llm-wiki/`, `codex/bin/codex.exe`, `codex/codex-resources/`, `org-defaults.json`; note the installer size (expected 330–370 MB, up from 217 MB) and tell the user.
- [ ] **Step 2: Run the installed app** (`win-unpacked\Open GenOffice.exe` with `--user-data-dir=<temp>`, since a packaged run ignores `GENOFFICE_USER_DATA`): first run is on LiteLLM with the build's address; the Codex card finds the bundled `codex.exe`. Delete anything the run created in the real profile.
- [ ] **Step 3: Whole-branch review** with a fresh reviewer on the diff since `99346576`; fix what it finds, each with a test.
- [ ] **Step 4: Push** to `private` only (`git push private migrate/upstream-2026-10`); never to `origin`. Ask the user before installing over `D:\Programs\Open GenOffice`.
