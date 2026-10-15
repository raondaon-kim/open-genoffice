# AI connection modes: LiteLLM, Codex, own API keys

Status: design, approved in conversation 2026-10-15; this file awaits the user's review.

## Understanding

Settings → AI model becomes a choice between **three ways to connect**, so a user picks how
to connect instead of scanning one long provider list:

1. **LiteLLM** (first, the default of a company build): the in-house proxy; the user enters only
   their virtual key. The default model is DeepSeek (`deepseek-chat`).
2. **Codex**: ChatGPT-account login, connected automatically. Codex CLI ships inside the
   installer, so nothing else is installed.
3. **Own API keys**: the existing providers (Claude, OpenAI, Gemini, DeepSeek, Genspark, …).

What the user said: the order (LiteLLM, Codex, API keys), the Settings UI is redesigned, the
Codex CLI is bundled, Genspark stays inside option 3, Codex also feeds the bundled LLM Wiki, and
LiteLLM's default model is DeepSeek.
Assumed (correct me): the redesign covers the AI model pane only; media/search panes stay.

## Scope and order

One spec, built in three steps so each step ships on its own:

- **A. Modes and Settings UI**, with LiteLLM and its DeepSeek default (sections 1, 2, 5).
- **B. Codex bundled and login** (section 3).
- **C. Codex → LLM Wiki bridge** (section 4).

Out of scope: macOS/Linux Codex bundling (the installer ships Windows x64 only, like LLM Wiki),
tools through the bridge, our own ChatGPT OAuth, changes to the media/search panes.

## 1. Data model: the mode is derived, nothing migrates

`AiSettings.provider` stays the source of truth; the mode is a view of it:

| provider      | mode       |
| ------------- | ---------- |
| `litellm`     | 1 LiteLLM  |
| `codex`       | 2 Codex    |
| anything else | 3 API keys |

- Each provider keeps its own config under `providers[...]`; switching mode never clears a key,
  model or address.
- New optional field `byokProvider` remembers the last provider used in mode 3, so going
  3 → 1 → 3 returns to it (default: the first provider that has a key, else `anthropic`).
  `sanitizeAiSettings` accepts it only when it is a known provider other than `litellm`/`codex`.
- Existing `ai-settings.json` files work unchanged.
- First run keeps today's rule (`org-defaults.json` seeds LiteLLM only when no settings exist).

## 2. Settings UI

A group of three radio cards on top, the selected mode's fields below. Shared rows (max output
tokens, cloud tools switch) stay as they are.

```
Connection
 (●) 1 LiteLLM        Connect with the key your company gave you
 ( ) 2 Codex          ChatGPT account, one login connects it
 ( ) 3 Own API keys   Claude, OpenAI, Gemini, DeepSeek … with your own key
```

- **1 LiteLLM:** server address (read-only with a note when the build carries it, an input
  otherwise), virtual key, model dropdown filled from the proxy's `/models`.
  - Prefill: choosing the card fills the address from `org-defaults.json` when the LiteLLM config
    has none, also on installs that already exist, so only the key is left to enter.
  - **DeepSeek default:** when no model is chosen, or the chosen one is not in the proxy's list,
    the model becomes `deepseek-chat` (DeepSeek V4 Flash, thinking off), else the first
    `deepseek*` entry, else the first entry. `deepseek-pro` and `deepseek-reasoner` stay
    selectable. `OPEN_GENOFFICE_LITELLM_MODEL` at build time still wins for a new install.
- **2 Codex:** status line (connected with the account, login needed, component missing),
  buttons **Login** and **Check connection**, model dropdown (the existing live model list),
  and a collapsed "Advanced: executable path" holding today's `cliPath` field.
- **3 API keys:** today's provider dropdown without LiteLLM and Codex, then model, key and address
  rows exactly as now.
- Strings in all 21 languages (Korean, Chinese, Japanese native; English elsewhere). The
  component is split out of `SettingsModal.tsx` (`AiConnectionPane` and one component per mode)
  so each part stays readable and testable.

## 3. Codex bundled, login

- **Packaging:** `tools/fetch-codex-cli.mjs` downloads the pinned `@openai/codex` Windows x64
  build, verifies its npm integrity hash and stages `apps/shell/build/codex/` (the executable,
  its license, a `SOURCE.txt` with the version); the installer ships it as `resources/codex/`.
  The Windows x64 build fails without it (same guard as LLM Wiki). `ACKNOWLEDGMENTS.md` and
  `MODIFICATIONS.md` name it (Apache-2.0).
- **Which executable runs:** the user's `cliPath` if set, else the bundled one, else `codex` on
  PATH. The provider package gets the bundled path as an option; it does not know Electron.
- **Login:** the Login button runs the bundled `codex login` (hidden console, the browser opens
  for the OAuth page), then polls `account/read` until signed in or a timeout; a Cancel button
  stops it. **Check connection** is the existing test. Codex keeps its tokens in its own folder
  (`~/.codex`); GenOffice stores none. The default Codex home is used, so a user already signed
  in to Codex is connected without any click.
- **Status** comes from one main-process function returning `connected | needs-login | missing |
error` plus the account label, used by the pane and by the LLM Wiki status.

## 4. Codex → LLM Wiki bridge (step C)

The bundled LLM Wiki speaks OpenAI/Claude/Gemini, not Codex. GenOffice runs a **local
OpenAI-compatible adapter** in the shell main process:

- Listens on `127.0.0.1` on a free port; every request needs the per-run bearer token; requests
  whose `Host` is not loopback are refused.
- `POST /v1/chat/completions` (streaming SSE and plain JSON) and `GET /v1/models`. Messages map
  to the existing Codex call (`streamForProvider('codex', …)`, no tools); the configured Codex
  model is the one reported. Client disconnect aborts the call.
- One request at a time (a queue) and a per-request timeout, because ingest prompts are long.
- `llmWikiLlmFromAiSettings` gets the bridge's address and token when the provider is `codex`
  and returns a `custom` endpoint, so the existing seed, restart-on-change and status code work
  unchanged. The settings signature includes the bridge address.
- The adapter starts with the work wiki when the provider is `codex`, and stops with GenOffice.
- Known risk: the ChatGPT account's usage limits and Codex's speed. Step C's acceptance run
  ingests real material to see it.

## 5. Errors and edge cases

- LiteLLM without an address (an open build, nothing typed): the card shows the address input and
  the test button explains what is missing (existing error text).
- Codex missing or damaged component: status `missing` with a reinstall hint; the pane still
  lets the user choose another mode.
- Login cancelled, timed out or failed: status stays `needs-login` with the reason.
- Choosing a mode never saves by itself; **Save** and **Test** keep working as today.
- A mode whose settings are incomplete is still selectable; the status pill says what is missing.

## 6. Testing

- Unit: mode derivation and `byokProvider` sanitising; LiteLLM model choice (DeepSeek preference,
  fallbacks); org-defaults prefill; Codex executable lookup order; login/status state machine
  with a fake child process; the bridge (auth, host check, streaming and plain replies, queue,
  abort, timeout) against a fake Codex call; `llmWikiLlmFromAiSettings` for `codex`.
- UI (jsdom): the three cards, the fields per mode, status texts and buttons.
- Local run: the installer contains `resources/codex/`; `codex` starts from there; the app-server
  answers `account/read` without a login; with a login (the user signs in once in the browser) a
  chat works and an LLM Wiki ingest succeeds through the bridge; LiteLLM against the real proxy
  with the user's virtual key using `deepseek-chat`.

## 7. Open items for the plan

- The exact Codex CLI version to pin and where its Windows x64 package puts the executable.
- Whether `codex login` can be driven with a non-interactive browser launch on this machine
  (verified with a throwaway run before the plan fixes the login steps).
- The proxy address and the virtual key are not stored in the repository: the address comes from
  `OPEN_GENOFFICE_LITELLM_URL` at build time, the key from the user.
