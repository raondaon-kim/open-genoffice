# LLM Wiki Bundled With GenOffice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One GenOffice installer also installs LLM Wiki. LLM Wiki runs hidden while GenOffice runs, learns the material the user adds, and the assistants search and read both wikis.

**Architecture:**

- **Fork:** a small fork of LLM Wiki (`D:\llm_wiki_ubion\llm_wiki`, branch `genoffice`) adds a managed mode: hidden window, its own identifier and ports, show/quit routes.
- **Engine:** the work wiki engine hands `index.md`, `log.md` and `raw/sources/` to LLM Wiki. Its search covers every wiki page, and a search hook merges LLM Wiki's own search.
- **Shell:** a shell module seeds LLM Wiki's settings, starts it, watches it and stops it. A new "add material" action converts Hangul files and drops them into `raw/sources/`.
- **Installer:** the fork's release build is packaged as an extra resource.

**Tech Stack:** Rust + Tauri 2.11 (fork), TypeScript, Electron main process, vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-10-15-llm-wiki-bundle-design.md` (builds on `2026-10-13-work-wiki-design.md`)

## Global Constraints

- GenOffice stays Apache-2.0. LLM Wiki (GPL-3.0) ships only as a **separate program** in `resources/llm-wiki/`. Its `LICENSE` and a `SOURCE.txt` (fork URL, exact commit, build steps) ship beside it.
- The fork's identifier is `com.opengenoffice.llmwiki`. Its settings live in `%APPDATA%\com.opengenoffice.llmwiki\app-state.json`. It never touches `com.llmwiki.app` (a personal LLM Wiki install, such as the one on this PC).
- Managed mode is switched on by `LLM_WIKI_MANAGED=1`. Ports come from `LLM_WIKI_API_PORT` and `LLM_WIKI_CLIP_PORT` (1024 or higher, else the defaults 19828 / 19827). The API token comes from `LLM_WIKI_API_TOKEN`, a random value per launch.
- `app-state.json` is written only while LLM Wiki is not running.
- GenOffice never writes `wiki/index.md`, `wiki/log.md`, `wiki/overview.md` or anything under `raw/sources/` except files the user adds through "add material". Chat notes live in `raw/genoffice-notes/`. The engine's own log is `<stateDir>/log.md`.
- GenOffice pages stay in `wiki/work`, `wiki/methods`, `wiki/clients`. Their `sources:` list holds document paths outside the wiki, so LLM Wiki's delete cascade (which looks at `raw/sources` files) never removes them.
- Page ids exposed to the assistants are paths under `wiki/` without `.md` (`work/koica-health`, `entities/koica`). A legacy bare slug still reads a GenOffice page.
- `wiki_read` resolves only inside `wiki/`: no `..`, no leading dot, no drive letters or backslashes, `.md` added when missing.
- LLM Wiki is reached only over `127.0.0.1` with `Authorization: Bearer <token>`.
- If LLM Wiki cannot run (no exe, no WebView2, unsupported AI provider, three crashes), GenOffice and its own work wiki keep working and Settings shows why.
- Code comments in English (`npm run check:english-comments`). Renderer colors only through theme tokens.
- Windows x64 only in this plan. On other platforms the executable is absent and the feature stays off.
- Refinements of the spec (also noted in the spec's menu section):
  - The File menu entries ship in the Hangul and Home menus, on a Home card, and as buttons in Settings. Word and PowerPoint menus are built inside their own apps and are left out for now.
  - The engine's search hook is an injected function, so the package knows nothing about LLM Wiki.

## Review Focus

1. **GenOffice crashes or is killed while LLM Wiki runs.** Expected: the next GenOffice start finds the stale pid and stops it before starting a new one. Test in Task 8.
2. **LLM Wiki does not become healthy** (missing WebView2, port in use, crash on start). Expected: three restarts with backoff, then state `failed` with a reason, no exception into the main process. Tests in Task 8.
3. **The user changes the AI model or key in GenOffice.** Expected: LLM Wiki is restarted with a rewritten `llmConfig`, not left on the old key. Tests in Tasks 7 and 9.
4. **Both programs write the same folder.** Expected: GenOffice leaves `index.md`, `log.md`, `overview.md` and `raw/sources/` alone, and its pages survive LLM Wiki's deletion cascade. Test in Task 5, checked end to end in Task 12.
5. **A Hangul file added as material.** Expected: converted to Markdown text without `[page N]` markers, names never overwrite an existing file, empty or unreadable files are reported, not silently dropped. Tests in Task 10.
6. **Hidden window throttles ingest.** Expected: a file dropped into `raw/sources/` while the window is hidden still becomes pages. Checked in Task 12, with a documented fallback.
7. **A page name or path chosen by a model or tool call.** Expected: cannot read outside `wiki/`. Tests in Task 6.

---

## File Structure

**Fork** (`D:\llm_wiki_ubion\llm_wiki`):

```
src-tauri/src/runtime.rs               managed flag, ports, RuntimeInfo
src-tauri/src/lib.rs                   runtime_info command, hidden window, close hides when managed
src-tauri/src/api_server.rs            POST /app/show, /app/quit
src-tauri/src/clip_server.rs           port from runtime
src-tauri/src/commands/fs.rs           OCR tool lookup without personal paths, no console flash
src-tauri/tauri.conf.json              identifier, hidden main window
src/lib/runtime-info.ts (+ test)       frontend access to RuntimeInfo
src/App.tsx, src/lib/clip-watcher.ts   clip port from runtime, no update check when managed
MODIFICATIONS.md                       what the fork changes
```

**GenOffice** (`D:\genoffice-next`):

```
packages/work-wiki/src/node/foreign.ts       read LLM Wiki pages, resolve wiki file ids
packages/work-wiki/src/node/search.ts        SearchDoc, mergeHits
packages/work-wiki/src/node/{store,learn,engine}.ts, types.ts, skill.ts   ownership changes, ids, async search
apps/shell/src/main/llm-wiki-seed.ts         AI settings → llmConfig, app-state seeding, project id
apps/shell/src/main/llm-wiki-process.ts      spawn, health, restart, quit, stale pid, show, search
apps/shell/src/main/llm-wiki.ts              real fs/ports/spawn glue, status, quit hook
apps/shell/src/main/add-material.ts          add files to raw/sources
apps/shell/src/main/work-wiki.ts             starts and stops LLM Wiki with the engine; IPC
apps/shell/src/main/index.ts                 menus, quit hook
apps/shell/src/renderer/src/{Home.tsx,WorkWikiSettings.tsx,strings.ts}
tools/fetch-llm-wiki.mjs, tools/llm-wiki.pin.json
apps/shell/electron-builder.cjs, ACKNOWLEDGMENTS.md, MODIFICATIONS.md
scripts/drivers/driver.llm-wiki.mjs           acceptance (local, gitignored)
```

Commands in Part A run in `D:\llm_wiki_ubion\llm_wiki`; Parts B to D run in `D:\genoffice-next`.

---

# Part A: LLM Wiki fork

### Task 1: Fork baseline and OCR tool lookup

**Files:**

- Modify: `src-tauri/src/commands/fs.rs` (the `run_ocrmypdf` function and every `Command::new` for Python or ocrmypdf)
- Test: the `#[cfg(test)]` module at the end of `src-tauri/src/commands/fs.rs`

**Interfaces:**

- Produces: `tesseract_dir_from(env_value: Option<&str>, exists: impl Fn(&str) -> bool) -> Option<String>`, `tesseract_dir() -> Option<String>`, `hide_console(cmd: &mut Command) -> &mut Command`

- [ ] **Step 1: Branch and commit the existing local changes as they are**

The working tree has uncommitted local changes (PDF fallback through pymupdf / OCRmyPDF, chunked ingest, a bundled `scripts/extract_pdf.py`). They are the fork's starting point.

```bash
git checkout -b genoffice
git add -A src-tauri/src src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.windows.conf.json src-tauri/scripts src
git commit -m "local: PDF text fallback (pymupdf, OCRmyPDF) and chunked ingest"
```

Expected: one commit; `git status --short` shows nothing tracked as modified.

- [ ] **Step 2: Write the failing test** (append to the tests module of `fs.rs`)

```rust
#[cfg(test)]
mod ocr_tool_tests {
    use super::*;

    #[test]
    fn tesseract_dir_prefers_the_env_value_then_the_default_install() {
        assert_eq!(
            tesseract_dir_from(Some(r"D:\tools\tess"), |_| false),
            Some(r"D:\tools\tess".to_string())
        );
        assert_eq!(
            tesseract_dir_from(Some("  "), |p| p == r"C:\Program Files\Tesseract-OCR"),
            Some(r"C:\Program Files\Tesseract-OCR".to_string())
        );
        assert_eq!(tesseract_dir_from(None, |_| false), None);
    }
}
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd src-tauri && cargo test --lib ocr_tool_tests`
Expected: FAIL to compile (`tesseract_dir_from` not found). The first build compiles LanceDB and takes a long time; later runs are incremental.

- [ ] **Step 4: Implement and use it**

Add above `run_ocrmypdf`:

```rust
const DEFAULT_TESSERACT_DIR: &str = r"C:\Program Files\Tesseract-OCR";

/// Tesseract folder for ocrmypdf's PATH: TESSERACT_DIR when set, else the default Windows
/// install when it exists.
fn tesseract_dir_from(env_value: Option<&str>, exists: impl Fn(&str) -> bool) -> Option<String> {
    if let Some(v) = env_value.map(str::trim).filter(|v| !v.is_empty()) {
        return Some(v.to_string());
    }
    exists(DEFAULT_TESSERACT_DIR).then(|| DEFAULT_TESSERACT_DIR.to_string())
}

fn tesseract_dir() -> Option<String> {
    tesseract_dir_from(std::env::var("TESSERACT_DIR").ok().as_deref(), |p| {
        Path::new(p).exists()
    })
}

/// Run helper tools without a console window flashing up (Windows only).
fn hide_console(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}
```

In `run_ocrmypdf`:

- Replace the candidate list with `which::which("ocrmypdf")` only: `let ocrmypdf_bin = which::which("ocrmypdf").map_err(|_| "ocrmypdf not found. Install with: pip install ocrmypdf".to_string())?;`
- Replace the hard-coded `tesseract_dir` with `tesseract_dir()`. Prepend it to `PATH` only when it is `Some`.
- Build the command as `let mut cmd = Command::new(&ocrmypdf_bin); hide_console(&mut cmd);` and keep the existing `.env(...)`, `.args(...)`, `.output()`.

Run `grep -n "Command::new" src/commands/fs.rs` and wrap every Python or ocrmypdf launch the same way with `hide_console`.

- [ ] **Step 5: Run the test and a check build**

Run: `cd src-tauri && cargo test --lib ocr_tool_tests && cargo check`
Expected: PASS and no new warnings from the changed code.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/fs.rs
git commit -m "fix(pdf): find ocrmypdf and tesseract without personal paths, no console flash"
```

---

### Task 2: Managed mode, ports, identifier, hidden window

**Files:**

- Create: `src-tauri/src/runtime.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/clip_server.rs`, `src-tauri/src/api_server.rs`, `src-tauri/tauri.conf.json`
- Create: `src/lib/runtime-info.ts`, `src/lib/runtime-info.test.ts`
- Modify: `src/App.tsx` (the two `fetch("http://127.0.0.1:19827/...")` calls), `src/lib/clip-watcher.ts` (line 18)

**Interfaces:**

- Produces:
  - Rust: `runtime::is_managed() -> bool`, `runtime::clip_port() -> u16`, `runtime::api_port() -> u16`, `runtime::parse_flag(Option<&str>) -> bool`, `runtime::parse_port(Option<&str>, u16) -> u16`, command `runtime_info -> RuntimeInfo { managed, clip_port, api_port }`
  - TS: `getRuntimeInfo(): Promise<RuntimeInfo>`, `clipUrl(path: string): Promise<string>`

- [ ] **Step 1: Write the failing Rust tests** in `src-tauri/src/runtime.rs`

```rust
use std::env;

/// LLM_WIKI_MANAGED=1: another program (GenOffice) starts and stops this one.
pub fn is_managed() -> bool {
    parse_flag(env::var("LLM_WIKI_MANAGED").ok().as_deref())
}

pub fn parse_flag(value: Option<&str>) -> bool {
    matches!(value.map(str::trim), Some("1") | Some("true") | Some("yes"))
}

/// A usable local port (1024 or higher), else the default.
pub fn parse_port(value: Option<&str>, default: u16) -> u16 {
    value
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|p| *p >= 1024)
        .unwrap_or(default)
}

pub fn clip_port() -> u16 {
    parse_port(env::var("LLM_WIKI_CLIP_PORT").ok().as_deref(), 19827)
}

pub fn api_port() -> u16 {
    parse_port(env::var("LLM_WIKI_API_PORT").ok().as_deref(), 19828)
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub managed: bool,
    pub clip_port: u16,
    pub api_port: u16,
}

pub fn runtime_info() -> RuntimeInfo {
    RuntimeInfo { managed: is_managed(), clip_port: clip_port(), api_port: api_port() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_managed_flag_accepts_1_true_yes_only() {
        assert!(parse_flag(Some("1")));
        assert!(parse_flag(Some(" true ")));
        assert!(!parse_flag(Some("0")));
        assert!(!parse_flag(Some("")));
        assert!(!parse_flag(None));
    }

    #[test]
    fn ports_below_1024_or_garbage_fall_back_to_the_default() {
        assert_eq!(parse_port(Some("51234"), 19828), 51234);
        assert_eq!(parse_port(Some("80"), 19828), 19828);
        assert_eq!(parse_port(Some("abc"), 19828), 19828);
        assert_eq!(parse_port(None, 19828), 19828);
    }
}
```

The file is complete as written (the implementation is part of it); the tests drive the helper functions, so write the file, then:

- [ ] **Step 2: Wire the module and watch the build fail**

Add `mod runtime;` to `lib.rs`. Run `cd src-tauri && cargo test --lib runtime::tests`. If it fails to compile because `serde` is not a direct dependency, check `Cargo.toml` (`serde = { version = "1", features = ["derive"] }` is already used by `proxy.rs`).
Expected: PASS (2 tests).

- [ ] **Step 3: Use the ports**

In `clip_server.rs`: delete `const PORT: u16 = 19827;` and replace each `PORT` (lines 53, 77, 87 area) with `crate::runtime::clip_port()`. In `api_server.rs`: delete `const PORT: u16 = 19828;` and replace each `PORT` (lines 74, 107, 111 area) with `crate::runtime::api_port()`; where a value is used several times in one function, bind `let port = crate::runtime::api_port();` first.

- [ ] **Step 4: Command, hidden window and close behavior in `lib.rs`**

```rust
#[tauri::command]
fn runtime_info() -> runtime::RuntimeInfo {
    runtime::runtime_info()
}
```

Register it in `generate_handler![ ... runtime_info, ]`. In `setup`, after the existing code and before `Ok(())`:

```rust
// the window starts hidden (tauri.conf.json); it is shown at once unless GenOffice manages it
if !runtime::is_managed() {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
    }
}
```

(`use tauri::Manager;` is already in scope inside `setup`.) At the top of the `CloseRequested` branch in `on_window_event`:

```rust
if let tauri::WindowEvent::CloseRequested { api, .. } = event {
    if runtime::is_managed() {
        // GenOffice owns the lifetime: closing only hides the window
        api.prevent_close();
        let _ = window.hide();
        return;
    }
    ...existing macOS / dialog code...
```

- [ ] **Step 5: Identifier and window in `tauri.conf.json`**

```json
"identifier": "com.opengenoffice.llmwiki",
...
"windows": [
  {
    "label": "main",
    "title": "업무 위키 (LLM Wiki)",
    "width": 1200,
    "height": 800,
    "resizable": true,
    "fullscreen": false,
    "visible": false,
    "backgroundThrottling": "disabled"
  }
]
```

If `cargo check` rejects `backgroundThrottling` as an unknown key, remove that line and rely on the hidden-ingest check in Task 12 (its fallback is described there).

- [ ] **Step 6: Frontend runtime info (test first)**

`src/lib/runtime-info.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

describe('runtime info', () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.resetModules()
  })

  it('asks the backend once and builds clip urls from its port', async () => {
    invoke.mockResolvedValue({ managed: true, clipPort: 51111, apiPort: 51112 })
    const { getRuntimeInfo, clipUrl } = await import('./runtime-info')
    expect((await getRuntimeInfo()).managed).toBe(true)
    expect(await clipUrl('/project')).toBe('http://127.0.0.1:51111/project')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default ports when the backend cannot answer', async () => {
    invoke.mockRejectedValue(new Error('no tauri'))
    const { getRuntimeInfo } = await import('./runtime-info')
    expect(await getRuntimeInfo()).toEqual({ managed: false, clipPort: 19827, apiPort: 19828 })
  })
})
```

Run `npx vitest run src/lib/runtime-info.test.ts`. Expected: FAIL (module missing). Then create `src/lib/runtime-info.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'

export interface RuntimeInfo {
  managed: boolean
  clipPort: number
  apiPort: number
}

const FALLBACK: RuntimeInfo = { managed: false, clipPort: 19827, apiPort: 19828 }
let cached: Promise<RuntimeInfo> | null = null

/** how this process was started: managed by GenOffice or not, and its local ports */
export function getRuntimeInfo(): Promise<RuntimeInfo> {
  cached ??= invoke<RuntimeInfo>('runtime_info').catch(() => FALLBACK)
  return cached
}

export async function clipUrl(path: string): Promise<string> {
  const { clipPort } = await getRuntimeInfo()
  return `http://127.0.0.1:${clipPort}${path}`
}
```

Run the test again. Expected: PASS (2 tests).

- [ ] **Step 7: Use `clipUrl` in the three places**

`App.tsx` (lines 345 and 354): `fetch(await clipUrl("/project"), {...})` and `fetch(await clipUrl("/projects"), {...})`. Those calls sit inside non-async callbacks; wrap each as `void clipUrl("/project").then((url) => fetch(url, {...})).catch(() => {})` keeping their bodies. `clip-watcher.ts`: inside the interval callback, `const res = await fetch(await clipUrl("/clips/pending"), { method: "GET" })`. Import `clipUrl` from `@/lib/runtime-info`.

- [ ] **Step 8: Verify and commit**

Run: `cd src-tauri && cargo check` then `cd .. && npm run build` (typecheck + vite) then `npx vitest run --exclude='**/*.real-llm.test.ts'`.
Expected: all pass.

```bash
git add src-tauri src
git commit -m "feat: managed mode for embedding (hidden window, own identifier and ports, runtime info)"
```

---

### Task 3: Show and quit routes

**Files:**

- Modify: `src-tauri/src/api_server.rs` (routing in `handle_request`, test module at the end)

**Interfaces:**

- Produces: `POST /api/v1/app/show`, `POST /api/v1/app/quit` (authenticated like every other route); `enum AppAction { Show, Quit }`, `fn app_action(method: &Method, parts: &[&str]) -> Option<AppAction>`

- [ ] **Step 1: Write the failing test** (inside the existing `#[cfg(test)] mod tests` at the end of `api_server.rs`)

```rust
#[test]
fn only_post_app_show_and_app_quit_are_app_actions() {
    assert_eq!(app_action(&Method::Post, &["app", "show"]), Some(AppAction::Show));
    assert_eq!(app_action(&Method::Post, &["app", "quit"]), Some(AppAction::Quit));
    assert_eq!(app_action(&Method::Get, &["app", "quit"]), None);
    assert_eq!(app_action(&Method::Post, &["app", "other"]), None);
    assert_eq!(app_action(&Method::Post, &["projects"]), None);
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd src-tauri && cargo test --lib only_post_app_show`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

```rust
#[derive(Debug, PartialEq)]
enum AppAction {
    Show,
    Quit,
}

/// The routes that control the app itself; GenOffice calls them.
fn app_action(method: &Method, parts: &[&str]) -> Option<AppAction> {
    match (method, parts) {
        (&Method::Post, ["app", "show"]) => Some(AppAction::Show),
        (&Method::Post, ["app", "quit"]) => Some(AppAction::Quit),
        _ => None,
    }
}

fn run_app_action(app: &AppHandle, action: AppAction) -> ApiResponse {
    use tauri::Manager;
    match action {
        AppAction::Show => match app.get_webview_window("main") {
            Some(window) => {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                ok(json!({ "ok": true }))
            }
            None => err(404, "main window not found"),
        },
        AppAction::Quit => {
            let handle = app.clone();
            // answer first so the caller gets its response, then exit
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(300));
                handle.exit(0);
            });
            ok(json!({ "ok": true }))
        }
    }
}
```

In `handle_request`, right after `let parts: Vec<&str> = ...;` and before `match (method, parts.as_slice())`:

```rust
if let Some(action) = app_action(method, &parts) {
    return run_app_action(app, action);
}
```

Check how the stores flush on exit: `grep -rn "RunEvent::Exit" ~/.cargo/registry/src/*/tauri-plugin-store-2.4.3/src/`. Expected: the plugin saves its stores on exit. If it does not, add in `lib.rs`'s `.run(|app, event| ...)` a store save on `RunEvent::Exit` using `tauri_plugin_store::StoreExt` (`app.store("app-state.json")?.save()`).

- [ ] **Step 4: Run tests and commit**

Run: `cd src-tauri && cargo test --lib only_post_app_show && cargo check`
Expected: PASS.

```bash
git add src-tauri/src/api_server.rs src-tauri/src/lib.rs
git commit -m "feat(api): authenticated routes to show the window and to quit"
```

---

### Task 4: No update check when managed, fork notes, release build

**Files:**

- Modify: `src/App.tsx` (the update check effect, line 92 onward)
- Create: `MODIFICATIONS.md` (fork root)

- [ ] **Step 1: Skip the update check when managed**

At the start of the `try {` block inside the `setTimeout(async () => {` of the update check effect (before `const { loadUpdateCheckState ... }`), add:

```ts
const { getRuntimeInfo } = await import('@/lib/runtime-info')
if ((await getRuntimeInfo()).managed) {
  console.log('[update-check] skipped: this copy is managed by GenOffice')
  return
}
```

No unit test (the effect is not unit tested upstream); Task 12 checks that a managed run makes no request to GitHub.

- [ ] **Step 2: Write `MODIFICATIONS.md`**

```markdown
# Fork notes: LLM Wiki for GenOffice

Based on nashsu/llm_wiki v0.4.12 (GPL-3.0). Changes in this fork:

- Managed mode (`LLM_WIKI_MANAGED=1`): the main window starts hidden and closing it hides it;
  no update check; own identifier `com.opengenoffice.llmwiki`.
- Ports from `LLM_WIKI_API_PORT` / `LLM_WIKI_CLIP_PORT`; frontend reads them through
  `runtime_info`.
- `POST /api/v1/app/show` and `/api/v1/app/quit` (same token auth as the other routes).
- PDF text fallback (pymupdf, OCRmyPDF) finds its tools on PATH (`TESSERACT_DIR` for
  Tesseract) and runs without a console window; ingest splits long sources into chunks.
```

- [ ] **Step 3: Build and test everything**

Run: `npm run build`, `npx vitest run --exclude='**/*.real-llm.test.ts'`, `cd src-tauri && cargo test --lib` (all), then the release build: `cd .. && npx tauri build --no-bundle`.
Expected: all pass; `src-tauri/target/release/llm-wiki.exe` exists.

- [ ] **Step 4: Commit and (after asking the user) publish the fork**

```bash
git add src/App.tsx MODIFICATIONS.md
git commit -m "feat: no update check when managed; fork notes"
```

**Ask the user before creating the remote repository** (an external side effect). On a yes:

```bash
gh repo create raondaon-kim/llm_wiki --private --source . --remote genoffice --push
git log -1 --format=%H   # the commit to pin in Task 11
```

---

# Part B: Work wiki engine

### Task 5: The engine gives up index, log and raw/sources

**Files:**

- Modify: `packages/work-wiki/src/node/store.ts`, `learn.ts`, `engine.ts`
- Modify tests: `packages/work-wiki/tests/{store,engine,engine-hardening,learn,review-fixes}.test.ts`

**Interfaces:**

- Produces: `WikiStore.notesDir = <root>/raw/genoffice-notes`; `WikiStore.appendLog(line)` writes `<stateDir>/log.md`; no `rawDir`, no `rebuildIndex`; `EngineOptions` without `watch` / `sourceSettleMs`; job kinds `'document' | 'note'`.

- [ ] **Step 1: Update the tests first (they fail against the old behavior)**

`store.test.ts`:

- In the layout test, the expected existing paths become `purpose.md`, `schema.md`, `raw/genoffice-notes`, `wiki/work`, `wiki/methods`, `wiki/clients`; add `expect(existsSync(join(root, 'wiki/index.md'))).toBe(false)` and the same for `wiki/log.md`.
- Delete the `rebuilds index.md grouped by type` test.
- The log test reads `join(store.stateDir, 'log.md')` instead of `wiki/log.md`.
- Add:

```ts
it("seeds a schema that names both programs' folders", () => {
  const root = mkdtempSync(join(tmpdir(), 'ww-'))
  new WikiStore(root, fixed).bootstrap()
  const schema = readFileSync(join(root, 'schema.md'), 'utf8')
  for (const name of [
    'wiki/work',
    'wiki/methods',
    'wiki/clients',
    'entities',
    'concepts',
    'raw/sources',
  ]) {
    expect(schema).toContain(name)
  }
})
```

`engine.test.ts`: delete the `learns a file dropped into raw/sources` test and remove every `watch: false,` line from the `EngineOptions` literals in all engine tests (`sed -i '/^ *watch: false,\?$/d'` on `engine.test.ts` and `engine-hardening.test.ts`, then fix the inline `watch: false` that share a line with other options by hand). Add to `engine-hardening.test.ts`:

```ts
it('never writes index.md, log.md or anything under raw/sources', async () => {
  const root = tmp()
  const engine = new WorkWikiEngine({
    root,
    stateDir: join(tmp(), 'state'),
    complete: model(),
    extractText: text,
    debounceMs: 0,
  })
  engine.start()
  engine.onDocumentSaved('D:/docs/a.hwp')
  await engine.runDue()
  await engine.remember(['표는 앞에'])
  await engine.runDue()
  expect(existsSync(join(root, 'wiki', 'index.md'))).toBe(false)
  expect(existsSync(join(root, 'wiki', 'log.md'))).toBe(false)
  expect(existsSync(join(root, 'raw', 'sources'))).toBe(false)
  expect(readdirSync(join(root, 'raw', 'genoffice-notes')).length).toBe(1)
})
```

(import `readdirSync` from `node:fs`.) Any other test that reads `index.md` or `log.md` in the wiki folder (`grep -rn "index.md\|log.md" packages/work-wiki/tests`) is changed the same way.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/work-wiki`
Expected: several FAIL (layout, log location, `watch` option still accepted, notes dir).

- [ ] **Step 3: Implement**

`store.ts`:

- `this.notesDir = join(root, 'raw', 'genoffice-notes')`; delete the `rawDir` field.
- `bootstrap()`: create `notesDir`, `stateDir` and the three page folders; seed only `purpose.md` and `schema.md` (drop `wiki/index.md` and `wiki/log.md` from the `seed` list).
- Delete `rebuildIndex()` and the `TYPE_HEADINGS` constant.
- `appendLog`: `appendFileSync(join(this.stateDir, 'log.md'), ...)`.
- Replace the `SCHEMA` constant with:

```ts
const SCHEMA = `# 페이지 규칙

이 폴더는 GenOffice와 LLM Wiki가 함께 씁니다.

## GenOffice가 관리 (사람이 고치지 않습니다)
- wiki/work/: 업무 하나에 한 페이지 (1,500자 이내). 섹션: 개요, 진행·결정, 관련 문서, 이력
- wiki/methods/: 작업 방식 (2,000자 이내). 섹션: 방식, 수정 경향, 이력
- wiki/clients/: 기관 (800자 이내). 섹션: 선호, 이력
- raw/genoffice-notes/: 대화에서 기억한 메모

## LLM Wiki가 관리
- raw/sources/: 사용자가 넣은 자료 (회사소개서, 지난 제안서 등)
- wiki/entities/: 인물·기관·사업, wiki/concepts/: 개념·방법, wiki/sources/: 자료 요약
- wiki/queries, comparisons, synthesis, index.md, log.md, overview.md

## 공통
- 앞머리: type, title, aliases, summary, tags, related, sources, created, updated
- 본문 링크는 [[이름]]
`
```

`learn.ts`: delete the `store.rebuildIndex()` call.
`engine.ts`:

- Delete: the `watch` import and `FSWatcher` type, the `watcher` field, `watchSources()`, the options `watch` and `sourceSettleMs`, `SOURCE_SETTLE_MS`, `SOURCE_EXT`, the `this.watcher?.close()` line in `stop()`, and the watcher start in `start()`.
- `Job['kind']` becomes `'document' | 'note'`.
- Replace `accepts` with:

```ts
private accepts(path: string, kind: Job['kind']): boolean {
  if (kind === 'note') return true // written by remember(), under raw/genoffice-notes
  const p = norm(path)
  if (!LEARNED.has(extname(path).toLowerCase())) return false
  // nothing inside the wiki folder is a document of the user's
  if (p.startsWith(`${norm(this.opts.root)}/`)) return false
  if (basename(path).startsWith('~$') || /\.tmp$/i.test(path)) return false
  return !(this.opts.exclude ?? []).some((e) => p === norm(e) || p.startsWith(`${norm(e)}/`))
}
```

- `loadQueue` results are filtered through `accepts` already (old `'source'` jobs have no matching kind and are dropped because `LEARNED` does not contain `.md`... a stale `source` job for a `.md` file is rejected by the `LEARNED` check).

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run packages/work-wiki && npm run typecheck -w @genoffice/work-wiki`
Expected: all PASS.

```bash
git add packages/work-wiki
git commit -m "refactor(work-wiki): leave index.md, log.md and raw/sources to LLM Wiki; notes in raw/genoffice-notes"
```

---

### Task 6: Search over every wiki page, path ids, `wiki_read` by path

**Files:**

- Create: `packages/work-wiki/src/node/foreign.ts`, `packages/work-wiki/tests/foreign.test.ts`
- Modify: `packages/work-wiki/src/types.ts`, `src/node/search.ts`, `src/node/engine.ts`, `src/skill.ts`, `src/node.ts`
- Modify tests: `search.test.ts`, `skill.test.ts`, `engine.test.ts`, `review-fixes.test.ts` (use `.id`, async `search`)

**Interfaces:**

- Produces:
  - `WikiHitKind = 'work' | 'method' | 'client' | 'entity' | 'concept' | 'source' | 'other'`
  - `WikiHit { id: string; kind: WikiHitKind; title: string; summary: string; score: number }` (replaces `slug` and `type`)
  - `SearchDoc { id, kind, title, aliases, summary, tags, body }`, `docOfPage(page): SearchDoc`, `new WikiSearch(docs: SearchDoc[])`
  - `readForeignDocs(wikiDir: string): { docs: SearchDoc[] }`
  - `resolveWikiFile(wikiDir: string, id: string): string | null`
  - `WorkWikiEngine.search(query): Promise<WikiHit[]>`, `read(id)` accepts a path id or a legacy slug

- [ ] **Step 1: Write the failing tests**

`foreign.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readForeignDocs, resolveWikiFile } from '../src/node/foreign'

function wikiWith(files: Record<string, string>): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'ww-')), 'wiki')
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true })
    writeFileSync(join(dir, ...rel.split('/')), text)
  }
  return dir
}

describe('readForeignDocs', () => {
  it('reads LLM Wiki pages with kinds from their folders, skipping our own folders and the catalog files', () => {
    const wiki = wikiWith({
      'entities/koica.md':
        '---\ntype: entity\ntitle: KOICA\ntags: [ODA, 기관]\n---\n한국국제협력단. 개발협력 기관.\n',
      'concepts/pdm.md': '# PDM\n\n사업 논리 모형.\n',
      'sources/회사소개서.md': '---\ntitle: 회사소개서 요약\n---\n주요 실적 12건.\n',
      'work/ours.md': '---\ntype: work\ntitle: 우리 업무\n---\n본문\n',
      'index.md': '# 목차\n',
      'log.md': '# 기록\n',
      'overview.md': '# 개요\n',
    })
    const { docs } = readForeignDocs(wiki)
    expect(docs.map((d) => d.id).sort()).toEqual([
      'concepts/pdm',
      'entities/koica',
      'sources/회사소개서',
    ])
    const koica = docs.find((d) => d.id === 'entities/koica')!
    expect(koica).toMatchObject({ kind: 'entity', title: 'KOICA', tags: ['ODA', '기관'] })
    expect(koica.summary).toContain('한국국제협력단')
    expect(docs.find((d) => d.id === 'concepts/pdm')!.title).toBe('PDM')
    expect(docs.find((d) => d.id === 'sources/회사소개서')!.kind).toBe('source')
  })

  it('returns nothing for a missing wiki folder', () => {
    expect(readForeignDocs(join(tmpdir(), 'no-such-wiki-dir')).docs).toEqual([])
  })
})

describe('resolveWikiFile', () => {
  const wiki = wikiWith({ 'entities/koica.md': 'x', 'sources/a b (1).md': 'y' })

  it('finds a page by path id, with or without .md', () => {
    expect(resolveWikiFile(wiki, 'entities/koica')).toMatch(/koica\.md$/)
    expect(resolveWikiFile(wiki, 'entities/koica.md')).toMatch(/koica\.md$/)
    expect(resolveWikiFile(wiki, 'sources/a b (1)')).toMatch(/a b \(1\)\.md$/)
  })

  it('refuses anything that could leave wiki/ or is not a plain page name', () => {
    for (const bad of [
      '../x',
      'entities/../../x',
      '/etc/passwd',
      'C:/x',
      'entities\\koica',
      '.hidden/x',
      'entities/.x',
      '',
      'entities/',
      'a//b',
    ]) {
      expect(resolveWikiFile(wiki, bad)).toBeNull()
    }
    expect(resolveWikiFile(wiki, 'entities/missing')).toBeNull()
  })
})
```

`search.test.ts`: build with `new WikiSearch(pages.map(docOfPage))`, assert `hits[0]?.id` is `'work/koica-health'` and `'work/gyeonggi-eco'`, `'client/...'`: ids use folder names (`work/`, `methods/`, `clients/`). Add:

```ts
it('ranks LLM Wiki pages together with ours', () => {
  const foreign: SearchDoc = {
    id: 'entities/koica-health-co',
    kind: 'entity',
    title: '코이카 보건 협력',
    aliases: [],
    summary: '',
    tags: [],
    body: '',
  }
  const s = new WikiSearch([...pages.map(docOfPage), foreign])
  expect(s.search('코이카 보건').map((h) => h.id)).toContain('entities/koica-health-co')
})
it('merges hit lists, ours first, without duplicates, within the limit', () => {
  const h = (id: string): WikiHit => ({ id, kind: 'work', title: id, summary: '', score: 1 })
  expect(mergeHits([h('a'), h('b')], [h('x'), h('a'), h('y')], 4).map((x) => x.id)).toEqual([
    'a',
    'x',
    'b',
    'y',
  ])
  expect(mergeHits([], [h('x')], 8).map((x) => x.id)).toEqual(['x'])
})
```

`engine.test.ts` additions:

```ts
it('search covers LLM Wiki pages, merges the extra search and degrades when it throws', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ww-'))
  mkdirSync(join(root, 'wiki', 'entities'), { recursive: true })
  writeFileSync(
    join(root, 'wiki', 'entities', 'hanbit.md'),
    '---\ntitle: 한빛정보\n---\n우리 회사. 보건 정보시스템 구축 실적.\n',
  )
  const extra = vi.fn(async () => [
    { id: 'sources/profile', kind: 'source' as const, title: '회사소개서', summary: '', score: 1 },
  ])
  const engine = new WorkWikiEngine({
    root,
    complete: model(),
    extractText: async () => null,
    extraSearch: extra,
  })
  engine.start()
  const ids = (await engine.search('한빛정보 실적')).map((h) => h.id)
  expect(ids).toContain('entities/hanbit')
  expect(ids).toContain('sources/profile')
  const broken = new WorkWikiEngine({
    root,
    complete: model(),
    extractText: async () => null,
    extraSearch: async () => {
      throw new Error('down')
    },
  })
  broken.start()
  expect((await broken.search('한빛정보')).map((h) => h.id)).toContain('entities/hanbit')
})

it('read takes a path id for any wiki page, fenced, and still takes a legacy slug', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ww-'))
  mkdirSync(join(root, 'wiki', 'entities'), { recursive: true })
  writeFileSync(
    join(root, 'wiki', 'entities', 'hanbit.md'),
    '---\ntitle: 한빛정보\n---\n우리 회사.\n',
  )
  const engine = new WorkWikiEngine({ root, complete: model(), extractText: async () => null })
  engine.start()
  const r = engine.read('entities/hanbit')
  expect(r.ok && r.page.startsWith('⟦업무 위키:') && r.page.includes('우리 회사')).toBe(true)
  expect(engine.read('../purpose').ok).toBe(false)
  await engine.remember(['KOICA 보건 사업'])
  await engine.runDue()
  const hit = (await engine.search('KOICA'))[0]!
  expect(hit.id.startsWith('work/')).toBe(true)
  expect(engine.read(hit.id).ok).toBe(true)
  expect(engine.read(hit.id.replace('work/', '')).ok).toBe(true) // legacy slug
})

it('the catalog mentions LLM Wiki pages when there are any', () => {
  const root = mkdtempSync(join(tmpdir(), 'ww-'))
  mkdirSync(join(root, 'wiki', 'concepts'), { recursive: true })
  writeFileSync(join(root, 'wiki', 'concepts', 'pdm.md'), '# PDM\n본문\n')
  const engine = new WorkWikiEngine({ root, complete: model(), extractText: async () => null })
  engine.start()
  expect(engine.catalog()).toContain('LLM Wiki')
})
```

(`mkdirSync`, `vi` imports as needed.) `skill.test.ts` mocks `search` returning hits with `id`/`kind`; the search output must contain the `id`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/work-wiki`
Expected: FAIL (modules and fields missing).

- [ ] **Step 3: Implement**

`types.ts`:

```ts
export type WikiHitKind = 'work' | 'method' | 'client' | 'entity' | 'concept' | 'source' | 'other'

export interface WikiHit {
  /** path under wiki/ without .md, e.g. work/koica-health or entities/koica */
  id: string
  kind: WikiHitKind
  title: string
  summary: string
  score: number
}
```

(delete the old `WikiHit`). `WorkWikiApi.read(id: string)` keeps its shape; rename the parameter.

`search.ts`: replace the `Doc`/`WikiPage` based index with `SearchDoc`:

```ts
export interface SearchDoc {
  id: string
  kind: WikiHitKind
  title: string
  aliases: string[]
  summary: string
  tags: string[]
  body: string
}

export const docOfPage = (p: WikiPage): SearchDoc => ({
  id: `${PAGE_FOLDERS[p.type]}/${p.slug}`,
  kind: p.type,
  title: p.title,
  aliases: p.aliases,
  summary: p.summary,
  tags: p.tags,
  body: p.body,
})
```

`FIELD_WEIGHTS` read from `SearchDoc`; `WikiSearch` constructor takes `SearchDoc[]`; hits are `{ id, kind, title, summary, score }`. `buildCatalog` lines become `- [${LABEL[p.type]}] ${p.title}${alias} — ${p.summary} (${PAGE_FOLDERS[p.type]}/${p.slug})`. Add:

```ts
/** local hits first, then the other source's, alternating, without duplicate ids */
export function mergeHits(local: WikiHit[], extra: WikiHit[], limit = 8): WikiHit[] {
  const out: WikiHit[] = []
  const seen = new Set<string>()
  const push = (h?: WikiHit) => {
    if (h && !seen.has(h.id) && out.length < limit) {
      seen.add(h.id)
      out.push(h)
    }
  }
  for (let i = 0; i < Math.max(local.length, extra.length); i++) {
    push(local[i])
    push(extra[i])
  }
  return out
}
```

`foreign.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { WikiHitKind } from '../types'
import type { SearchDoc } from './search'

/** folders GenOffice owns; everything else under wiki/ belongs to LLM Wiki */
const OWN = new Set(['work', 'methods', 'clients'])
const CATALOG_FILES = new Set(['index.md', 'log.md', 'overview.md'])
const KIND_BY_FOLDER: Record<string, WikiHitKind> = {
  entities: 'entity',
  concepts: 'concept',
  sources: 'source',
}
const MAX_FILES = 3000
const MAX_DEPTH = 3
const MAX_READ = 20_000
const MAX_BODY = 6_000

function frontMatter(text: string): { fields: Map<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const fields = new Map<string, string>()
  if (!m) return { fields, body: text }
  for (const line of m[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return { fields, body: m[2] ?? '' }
}

const unquote = (v: string) => v.replace(/^["']|["']$/g, '').trim()

function listOf(raw: string | undefined): string[] {
  if (!raw) return []
  const inner = raw.replace(/^\[|\]$/g, '')
  return inner.split(',').map(unquote).filter(Boolean)
}

function docOf(file: string, id: string): SearchDoc {
  const text = readFileSync(file, 'utf8').slice(0, MAX_READ)
  const { fields, body } = frontMatter(text)
  const heading = /^# (.+)$/m.exec(body)?.[1]?.trim()
  const firstLine = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  const folder = id.split('/')[0]!
  return {
    id,
    kind: KIND_BY_FOLDER[folder] ?? 'other',
    title: unquote(fields.get('title') ?? '') || heading || id.split('/').pop()!,
    aliases: [],
    summary: (firstLine ?? '').slice(0, 160),
    tags: listOf(fields.get('tags')),
    body: body.slice(0, MAX_BODY),
  }
}

/** every page under wiki/ that LLM Wiki wrote, as search documents */
export function readForeignDocs(wikiDir: string): { docs: SearchDoc[] } {
  const docs: SearchDoc[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > MAX_DEPTH || docs.length >= MAX_FILES) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.') || docs.length >= MAX_FILES) continue
      const path = join(dir, name)
      const relPath = rel ? `${rel}/${name}` : name
      if (statSync(path).isDirectory()) {
        if (!rel && (OWN.has(name) || name === 'media')) continue
        walk(path, relPath, depth + 1)
      } else if (name.endsWith('.md')) {
        if (!rel && CATALOG_FILES.has(name)) continue
        try {
          docs.push(docOf(path, relPath.slice(0, -3)))
        } catch {
          // an unreadable file is skipped
        }
      }
    }
  }
  if (existsSync(wikiDir)) walk(wikiDir, '', 0)
  return { docs }
}

const SEGMENT = /^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/

/** the absolute file of a page id under wiki/, or null for anything that is not a plain page inside it */
export function resolveWikiFile(wikiDir: string, id: string): string | null {
  const clean = id.endsWith('.md') ? id.slice(0, -3) : id
  const parts = clean.split('/')
  if (parts.length === 0 || parts.length > MAX_DEPTH + 1) return null
  if (!parts.every((p) => SEGMENT.test(p))) return null
  const base = resolve(wikiDir)
  const file = resolve(base, ...parts) + '.md'
  if (!file.startsWith(base + sep)) return null
  return existsSync(file) ? file : null
}
```

`engine.ts`:

- Option `extraSearch?: (query: string) => Promise<WikiHit[]>`.
- Fields `private foreign: SearchDoc[] = []`, `private indexBuiltAt = 0`.
- `refreshSearch()` builds `docOfPage` for `store.listPages()` plus `readForeignDocs(store.wikiDir).docs` into `this.searchIndex` and sets `indexBuiltAt = Date.now()`.
- `search`:

```ts
async search(query: string): Promise<WikiHit[]> {
  if (!this.isEnabled || !this.store) return []
  if (Date.now() - this.indexBuiltAt > INDEX_TTL_MS) this.refreshSearch()
  const local = this.searchIndex?.search(query, 5) ?? []
  let extra: WikiHit[] = []
  try {
    extra = (await this.opts.extraSearch?.(query)) ?? []
  } catch {
    // LLM Wiki being down only narrows the results
  }
  return mergeHits(local, extra)
}
```

(`const INDEX_TTL_MS = 30_000`.)

- `read(id)`:

```ts
read(id: string): { ok: true; page: string } | { ok: false; error: string } {
  if (!this.isEnabled || !this.store) return { ok: false, error: WIKI_UNAVAILABLE }
  const [folder, ...rest] = id.split('/')
  const ownSlug = rest.length === 1 && OWN_FOLDERS.has(folder!) ? rest[0]! : id.includes('/') ? null : id
  try {
    if (ownSlug !== null) {
      const page = this.store.readPage(ownSlug)
      if (page) return { ok: true, page: fenceWikiText(serializePage(page).replace(/^sources: .*\n/m, '')) }
      return { ok: false, error: `no wiki page: ${id}` }
    }
    const file = resolveWikiFile(this.store.wikiDir, id)
    if (!file) return { ok: false, error: `no wiki page: ${id}` }
    return { ok: true, page: fenceWikiText(readFileSync(file, 'utf8').slice(0, READ_CAP)) }
  } catch (err) {
    this.disable(err)
    return { ok: false, error: WIKI_UNAVAILABLE }
  }
}
```

(`const OWN_FOLDERS = new Set(['work', 'methods', 'clients'])`, `const READ_CAP = 12_000`; import `resolveWikiFile`, `readForeignDocs`, `mergeHits`, `docOfPage`.)

- `catalog()`: after building the lines, `const n = this.foreign count`: keep the count from the last `refreshSearch` (`this.foreignCount = foreign.docs.length`) and append `\n- LLM Wiki 자료 페이지 ${n}개 (인물·기관·개념·자료 요약): wiki_search로 찾으세요` when `n > 0`.
  `skill.ts`: search output lines `- ${h.id} [${h.kind}] ${h.title} — ${h.summary}`; tool descriptions say `wiki_read` takes the id (path) from the catalog or `wiki_search`; the prompt bullet about the rule adds: "For company facts, people, track record and past material, search the wiki first: LLM Wiki's pages (sources, entities, concepts) hold what the user added."
  `node.ts` exports `readForeignDocs`, `resolveWikiFile`, `mergeHits`, `docOfPage`, `SearchDoc`.

- [ ] **Step 4: Run tests, typecheck, other consumers**

Run: `npx vitest run packages/work-wiki apps/hwp/tests/work-wiki-skill.test.ts && npm run typecheck -w @genoffice/work-wiki -w @genoffice/shell -w @genoffice/hwp`
Expected: PASS and no type errors. If the shell `work-wiki.ts` IPC handler for `WIKI_CHANNELS.search` calls `engine?.search(...)` synchronously, change it to `await` (it is already an `ipcMain.handle`, so an async handler works).

- [ ] **Step 5: Commit**

```bash
git add packages/work-wiki apps/shell/src/main/work-wiki.ts
git commit -m "feat(work-wiki): search and read every wiki page by path id, merge an injected extra search"
```

---

# Part C: Shell

### Task 7: Settings seed for LLM Wiki

**Files:**

- Create: `apps/shell/src/main/llm-wiki-seed.ts`, `apps/shell/tests/llm-wiki-seed.test.ts`

**Interfaces:**

- Produces:
  - `type LlmWikiLlm = { provider: 'custom' | 'anthropic' | 'google'; apiKey: string; model: string; customEndpoint: string; ollamaUrl: string; maxContextSize: number; apiMode: 'chat_completions' | 'anthropic_messages' }`
  - `llmWikiLlmFromAiSettings(settings: AiSettings): { ok: true; llm: LlmWikiLlm } | { ok: false; reason: string }`
  - `seedAppState(existing: Record<string, unknown>, input: { projectId: string; wikiRoot: string; projectName: string; llm: LlmWikiLlm | null; now: number }): Record<string, unknown>`
  - `ensureProjectId(wikiRoot: string): string`, `readAppState(dir)`, `writeAppState(dir, state)`

- [ ] **Step 1: Write the failing test** `llm-wiki-seed.test.ts`

```ts
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
    const again = seedAppState(first, { ...input, llm: null }) as Record<string, any>
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/shell/tests/llm-wiki-seed.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `llm-wiki-seed.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
    model: config.model,
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
```

(`existsSync` is not needed; drop it from the import.)

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run apps/shell/tests/llm-wiki-seed.test.ts && npm run typecheck -w @genoffice/shell`
Expected: PASS (11 tests).

```bash
git add apps/shell/src/main/llm-wiki-seed.ts apps/shell/tests/llm-wiki-seed.test.ts
git commit -m "feat(shell): seed LLM Wiki's settings from GenOffice's AI settings and wiki folder"
```

---

### Task 8: The LLM Wiki process

**Files:**

- Create: `apps/shell/src/main/llm-wiki-process.ts`, `apps/shell/tests/llm-wiki-process.test.ts`

**Interfaces:**

- Consumes: `WikiHit`, `WikiHitKind` from `@genoffice/work-wiki`.
- Produces:
  - `class LlmWikiProcess` with `start(): Promise<boolean>`, `stopAndWait(): Promise<void>`, `show(): Promise<boolean>`, `search(query: string): Promise<WikiHit[]>`, `status(): LlmWikiStatus`
  - `type LlmWikiStatus = { state: 'stopped' | 'starting' | 'running' | 'failed'; reason?: string }`
  - `interface ChildLike`, `FetchLike`, `StalePid`, `LlmWikiProcessOptions` (below)
  - `hitOfSearchResult(raw: unknown): WikiHit | null`

- [ ] **Step 1: Write the failing test** `llm-wiki-process.test.ts`

```ts
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { hitOfSearchResult, LlmWikiProcess } from '../src/main/llm-wiki-process'
import type {
  ChildLike,
  FetchLike,
  LlmWikiProcessOptions,
  StalePid,
} from '../src/main/llm-wiki-process'

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242
  killed = false
  kill(): boolean {
    this.killed = true
    this.emit('exit', 1)
    return true
  }
}

/** a fake LLM Wiki: healthy after `healthyAfter` calls, quits on POST /app/quit */
function fakeWorld(opts: { healthyAfter?: number; neverHealthy?: boolean } = {}) {
  const children: FakeChild[] = []
  const calls: Array<{ url: string; method: string; auth?: string; body?: string }> = []
  let healthCalls = 0
  const spawn = vi.fn((_exe: string, _env: NodeJS.ProcessEnv) => {
    const c = new FakeChild()
    children.push(c)
    return c
  })
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      auth: init?.headers?.Authorization,
      body: init?.body,
    })
    if (url.endsWith('/health')) {
      healthCalls++
      const up = !opts.neverHealthy && healthCalls > (opts.healthyAfter ?? 0)
      return { ok: up, status: up ? 200 : 503, json: async () => ({ ok: up }) }
    }
    if (url.endsWith('/app/quit')) {
      setTimeout(() => children.at(-1)?.emit('exit', 0), 5)
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (url.endsWith('/app/show'))
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    if (url.includes('/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          results: [
            {
              path: 'wiki/entities/koica.md',
              title: 'KOICA',
              snippet: '한국국제협력단',
              score: 0.9,
            },
          ],
        }),
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { children, calls, spawn, fetch }
}

const stale = (over: Partial<StalePid> = {}): StalePid => ({
  read: () => null,
  write: vi.fn(),
  clear: vi.fn(),
  isLlmWiki: () => false,
  kill: vi.fn(),
  ...over,
})

const make = (world: ReturnType<typeof fakeWorld>, over: Partial<LlmWikiProcessOptions> = {}) =>
  new LlmWikiProcess({
    exePath: 'C:/res/llm-wiki/llm-wiki.exe',
    projectId: 'p-1',
    token: 'tok',
    spawn: world.spawn,
    fetch: world.fetch,
    pickPorts: async () => ({ api: 51001, clip: 51002 }),
    stale: stale(),
    healthTimeoutMs: 400,
    pollMs: 10,
    quitWaitMs: 200,
    backoffMs: [5, 5, 5],
    ...over,
  })

describe('LlmWikiProcess', () => {
  it('starts the program in managed mode with its own ports and token, and waits until it is healthy', async () => {
    const world = fakeWorld({ healthyAfter: 2 })
    const p = make(world)
    expect(await p.start()).toBe(true)
    expect(p.status().state).toBe('running')
    const env = world.spawn.mock.calls[0]![1]
    expect(env).toMatchObject({
      LLM_WIKI_MANAGED: '1',
      LLM_WIKI_API_PORT: '51001',
      LLM_WIKI_CLIP_PORT: '51002',
      LLM_WIKI_API_TOKEN: 'tok',
    })
    expect(world.calls.some((c) => c.url === 'http://127.0.0.1:51001/health')).toBe(true)
  })

  it('reports failed with a reason when it never becomes healthy, and stops the child', async () => {
    const world = fakeWorld({ neverHealthy: true })
    const p = make(world)
    expect(await p.start()).toBe(false)
    expect(p.status()).toMatchObject({ state: 'failed' })
    expect(p.status().reason).toMatch(/health/i)
    expect(world.children[0]!.killed).toBe(true)
  })

  it('restarts after an unexpected exit, up to three times, then gives up with a reason', async () => {
    const world = fakeWorld()
    const p = make(world)
    await p.start()
    for (let i = 0; i < 4; i++) {
      world.children.at(-1)!.emit('exit', 1)
      await new Promise((r) => setTimeout(r, 60))
    }
    expect(world.spawn).toHaveBeenCalledTimes(4) // first start + three restarts
    expect(p.status()).toMatchObject({ state: 'failed' })
    expect(p.status().reason).toMatch(/exited/i)
  })

  it('stopAndWait asks it to quit with the token, waits for it, and does not restart', async () => {
    const world = fakeWorld()
    const p = make(world)
    await p.start()
    await p.stopAndWait()
    const quit = world.calls.find((c) => c.url.endsWith('/app/quit'))!
    expect(quit).toMatchObject({ method: 'POST', auth: 'Bearer tok' })
    expect(p.status().state).toBe('stopped')
    expect(world.spawn).toHaveBeenCalledTimes(1)
    expect(world.children[0]!.killed).toBe(false)
  })

  it('kills it when it does not quit in time', async () => {
    const world = fakeWorld()
    const slowFetch: FetchLike = async (url, init) =>
      url.endsWith('/app/quit')
        ? { ok: true, status: 200, json: async () => ({}) }
        : world.fetch(url, init)
    const p = make(world, { fetch: slowFetch, quitWaitMs: 30 })
    await p.start()
    await p.stopAndWait()
    expect(world.children[0]!.killed).toBe(true)
  })

  it('stops a program left over from a GenOffice that crashed, before starting', async () => {
    const world = fakeWorld()
    const s = stale({ read: () => 777, isLlmWiki: (pid) => pid === 777 })
    const p = make(world, { stale: s })
    await p.start()
    expect(s.kill).toHaveBeenCalledWith(777)
    expect(s.write).toHaveBeenCalledWith(4242)
    await p.stopAndWait()
    expect(s.clear).toHaveBeenCalled()
  })

  it('does not kill a pid that is not LLM Wiki', async () => {
    const world = fakeWorld()
    const s = stale({ read: () => 888, isLlmWiki: () => false })
    await make(world, { stale: s }).start()
    expect(s.kill).not.toHaveBeenCalled()
  })

  it('show posts to the app route, search maps results to wiki hits, and both are quiet when not running', async () => {
    const world = fakeWorld()
    const p = make(world)
    expect(await p.show()).toBe(false)
    expect(await p.search('코이카')).toEqual([])
    await p.start()
    expect(await p.show()).toBe(true)
    const hits = await p.search('코이카')
    expect(hits).toEqual([
      {
        id: 'entities/koica',
        kind: 'entity',
        title: 'KOICA',
        summary: '한국국제협력단',
        score: 0.9,
      },
    ])
    const call = world.calls.find((c) => c.url.includes('/projects/p-1/search'))!
    expect(JSON.parse(call.body!)).toMatchObject({ query: '코이카' })
  })

  it('a start that throws (spawn failure) is a failed state, not an exception', async () => {
    const world = fakeWorld()
    const p = make(world, {
      spawn: () => {
        throw new Error('ENOENT')
      },
    })
    await expect(p.start()).resolves.toBe(false)
    expect(p.status()).toMatchObject({ state: 'failed', reason: 'ENOENT' })
  })
})

describe('hitOfSearchResult', () => {
  it('keeps pages under wiki/ and drops everything else', () => {
    expect(
      hitOfSearchResult({
        path: 'wiki/concepts/pdm.md',
        title: 'PDM',
        snippet: '논리모형',
        score: 0.5,
      }),
    ).toEqual({
      id: 'concepts/pdm',
      kind: 'concept',
      title: 'PDM',
      summary: '논리모형',
      score: 0.5,
    })
    expect(
      hitOfSearchResult({ path: 'wiki/sources/a.md', title: 'a', snippet: '', score: 1 }),
    ).toMatchObject({ kind: 'source' })
    expect(hitOfSearchResult({ path: 'raw/sources/a.md', title: 'a' })).toBeNull()
    expect(hitOfSearchResult({ path: 'wiki/queries/q.md', title: 'q' })).toMatchObject({
      kind: 'other',
    })
    expect(hitOfSearchResult('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/shell/tests/llm-wiki-process.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `llm-wiki-process.ts`**

```ts
import { randomBytes } from 'node:crypto'
import type { WikiHit, WikiHitKind } from '@genoffice/work-wiki'

export interface ChildLike {
  pid?: number | undefined
  on(event: 'exit', cb: (code: number | null) => void): unknown
  kill(): boolean
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** the pid of the program this app started, kept in a file so a crash cannot strand it */
export interface StalePid {
  read(): number | null
  write(pid: number): void
  clear(): void
  isLlmWiki(pid: number): boolean
  kill(pid: number): void
}

export interface LlmWikiProcessOptions {
  exePath: string
  projectId: string
  token?: string
  spawn: (exe: string, env: NodeJS.ProcessEnv) => ChildLike
  fetch: FetchLike
  pickPorts: () => Promise<{ api: number; clip: number }>
  stale?: StalePid
  extraEnv?: NodeJS.ProcessEnv
  healthTimeoutMs?: number
  pollMs?: number
  quitWaitMs?: number
  maxRestarts?: number
  backoffMs?: number[]
  log?: (msg: string) => void
}

export type LlmWikiState = 'stopped' | 'starting' | 'running' | 'failed'
export interface LlmWikiStatus {
  state: LlmWikiState
  reason?: string
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const KIND_BY_FOLDER: Record<string, WikiHitKind> = {
  entities: 'entity',
  concepts: 'concept',
  sources: 'source',
}

/** one LLM Wiki search result as a wiki hit; null for anything that is not a page under wiki/ */
export function hitOfSearchResult(raw: unknown): WikiHit | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const path = typeof r.path === 'string' ? r.path.replace(/\\/g, '/') : ''
  if (!path.startsWith('wiki/') || !path.endsWith('.md')) return null
  const id = path.slice('wiki/'.length, -'.md'.length)
  return {
    id,
    kind: KIND_BY_FOLDER[id.split('/')[0]!] ?? 'other',
    title: typeof r.title === 'string' && r.title ? r.title : id,
    summary: typeof r.snippet === 'string' ? r.snippet.slice(0, 160) : '',
    score: typeof r.score === 'number' ? r.score : 0,
  }
}

export class LlmWikiProcess {
  private child: ChildLike | null = null
  private ports: { api: number; clip: number } | null = null
  private state: LlmWikiState = 'stopped'
  private reason: string | undefined
  private restarts = 0
  private stopping = false
  private readonly token: string

  constructor(private readonly o: LlmWikiProcessOptions) {
    this.token = o.token ?? randomBytes(24).toString('hex')
  }

  status(): LlmWikiStatus {
    return this.reason ? { state: this.state, reason: this.reason } : { state: this.state }
  }

  private base(): string {
    return `http://127.0.0.1:${this.ports!.api}`
  }

  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.o.extraEnv,
      LLM_WIKI_MANAGED: '1',
      LLM_WIKI_API_TOKEN: this.token,
      LLM_WIKI_API_PORT: String(this.ports!.api),
      LLM_WIKI_CLIP_PORT: String(this.ports!.clip),
    }
  }

  private fail(reason: string): void {
    this.state = 'failed'
    this.reason = reason
    this.o.log?.(`llm wiki: ${reason}`)
  }

  /** start (or restart after a crash); false when it did not come up */
  async start(): Promise<boolean> {
    this.stopping = false
    this.state = 'starting'
    this.reason = undefined
    try {
      this.reapStale()
      this.ports = await this.o.pickPorts()
      const child = this.o.spawn(this.o.exePath, this.env())
      this.child = child
      if (child.pid) this.o.stale?.write(child.pid)
      child.on('exit', (code) => void this.onExit(child, code))
      if (!(await this.waitHealthy())) {
        this.fail('health check timed out')
        this.child = null // its exit is expected here, not a crash to restart from
        child.kill()
        return false
      }
      this.state = 'running'
      return true
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  private reapStale(): void {
    const s = this.o.stale
    if (!s) return
    const pid = s.read()
    if (pid && s.isLlmWiki(pid)) s.kill(pid)
    s.clear()
  }

  private async waitHealthy(): Promise<boolean> {
    const until = Date.now() + (this.o.healthTimeoutMs ?? 30_000)
    while (Date.now() < until) {
      try {
        const r = await this.o.fetch(`${this.base()}/health`)
        if (r.ok) return true
      } catch {
        // not listening yet
      }
      await sleep(this.o.pollMs ?? 250)
    }
    return false
  }

  private async onExit(child: ChildLike, code: number | null): Promise<void> {
    if (this.child !== child) return
    this.child = null
    if (this.stopping) {
      this.state = 'stopped'
      return
    }
    const max = this.o.maxRestarts ?? 3
    if (this.restarts >= max) {
      this.fail(`exited unexpectedly (code ${code ?? 'none'}), gave up after ${max} restarts`)
      return
    }
    const wait = (this.o.backoffMs ?? [1000, 3000, 9000])[this.restarts] ?? 9000
    this.restarts++
    this.state = 'starting'
    await sleep(wait)
    if (!this.stopping) await this.start()
  }

  private async call(path: string, method: string, body?: unknown) {
    return this.o.fetch(`${this.base()}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  /** ask it to quit, wait, and kill it if it does not; never throws */
  async stopAndWait(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (child && this.ports) {
      const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()))
      try {
        await this.call('/app/quit', 'POST')
      } catch {
        // already gone
      }
      const done = await Promise.race([
        exited.then(() => true),
        sleep(this.o.quitWaitMs ?? 5000).then(() => false),
      ])
      if (!done) child.kill()
    }
    this.child = null
    this.o.stale?.clear()
    this.state = 'stopped'
  }

  /** bring its window forward */
  async show(): Promise<boolean> {
    if (this.state !== 'running') return false
    try {
      return (await this.call('/app/show', 'POST')).ok
    } catch {
      return false
    }
  }

  /** its own search (keyword + vector), as wiki hits; empty when it is not running */
  async search(query: string, topK = 5): Promise<WikiHit[]> {
    if (this.state !== 'running') return []
    try {
      const r = await this.call(
        `/projects/${encodeURIComponent(this.o.projectId)}/search`,
        'POST',
        { query, topK },
      )
      if (!r.ok) return []
      const body = (await r.json()) as { results?: unknown[] }
      return (body.results ?? []).map(hitOfSearchResult).filter((h): h is WikiHit => h !== null)
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run apps/shell/tests/llm-wiki-process.test.ts && npm run typecheck -w @genoffice/shell`
Expected: PASS (9 tests). The restart counter belongs to one instance and is never reset; a settings change builds a new `LlmWikiProcess` (Task 9).

```bash
git add apps/shell/src/main/llm-wiki-process.ts apps/shell/tests/llm-wiki-process.test.ts
git commit -m "feat(shell): LLM Wiki process manager (start, health, restart, quit, stale pid, show, search)"
```

---

### Task 9: Glue, status and shutdown

**Files:**

- Create: `apps/shell/src/main/llm-wiki.ts`
- Modify: `apps/shell/src/main/work-wiki.ts`, `apps/shell/src/main/index.ts`, `apps/shell/src/shared/home-api.ts`, `apps/shell/src/preload/index.ts`, `apps/shell/src/renderer/src/WorkWikiSettings.tsx`, `apps/shell/src/renderer/src/strings.ts`
- Test: `apps/shell/tests/llm-wiki-glue.test.ts`

**Interfaces:**

- Consumes: `LlmWikiProcess` (Task 8), `llmWikiLlmFromAiSettings`, `seedAppState`, `ensureProjectId`, `readAppState`, `writeAppState` (Task 7).
- Produces:
  - `llmWikiExePath(resourcesPath: string | undefined, devDir: string): string | null`
  - `desiredSignature(llm: LlmWikiLlm | null, wikiRoot: string): string`
  - in `work-wiki.ts`: `startLlmWiki()`, `llmWikiStatus(): LlmWikiStatus & { available: boolean }`, `openLlmWiki(): Promise<boolean>`, `stopWorkWikiForQuit(): Promise<void>`
  - `HOME_CHANNELS.getLlmWikiStatus = 'home:get-llm-wiki-status'`, `HOME_CHANNELS.openLlmWiki = 'home:open-llm-wiki'`

- [ ] **Step 1: Write the failing test** `llm-wiki-glue.test.ts`

```ts
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
```

Run: `npx vitest run apps/shell/tests/llm-wiki-glue.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 2: Implement `llm-wiki.ts` (pure helpers and real fs/ports/spawn glue)**

```ts
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import type { ChildLike, FetchLike, StalePid } from './llm-wiki-process'
import type { LlmWikiLlm } from './llm-wiki-seed'

/** the installed copy (resources/llm-wiki), else the dev build (apps/shell/build/llm-wiki); null when absent */
export function llmWikiExePath(resourcesPath: string | undefined, devDir: string): string | null {
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'llm-wiki', 'llm-wiki.exe')] : []),
    join(devDir, 'llm-wiki', 'llm-wiki.exe'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** what LLM Wiki's settings must say: a change means it needs a restart. The key only enters as a hash. */
export function desiredSignature(llm: LlmWikiLlm | null, wikiRoot: string): string {
  const parts = llm
    ? [
        llm.provider,
        llm.model,
        llm.customEndpoint,
        llm.apiMode,
        createHash('sha256').update(llm.apiKey).digest('hex').slice(0, 12),
      ]
    : ['no-llm']
  return [wikiRoot.replace(/\\/g, '/').toLowerCase(), ...parts].join('|')
}

export const realFetch: FetchLike = async (url, init) => {
  const r = await fetch(url, init)
  return { ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> }
}

export function realSpawn(exe: string, env: NodeJS.ProcessEnv): ChildLike {
  const child = spawn(exe, [], { env, cwd: dirname(exe), stdio: 'ignore', windowsHide: true })
  child.on('error', () => {})
  return child
}

/** two free local ports (asked of the OS, released at once) */
export async function pickFreePorts(): Promise<{ api: number; clip: number }> {
  const one = () =>
    new Promise<number>((resolve, reject) => {
      const s = createServer()
      s.once('error', reject)
      s.listen(0, '127.0.0.1', () => {
        const port = (s.address() as { port: number }).port
        s.close(() => resolve(port))
      })
    })
  const api = await one()
  let clip = await one()
  while (clip === api) clip = await one()
  return { api, clip }
}

/** pid file in the app's own data folder; Windows only checks the image name through tasklist */
export function pidFileStore(file: string): StalePid {
  return {
    read() {
      try {
        const n = Number(readFileSync(file, 'utf8').trim())
        return Number.isInteger(n) && n > 0 ? n : null
      } catch {
        return null
      }
    },
    write: (pid) => writeFileSync(file, String(pid), 'utf8'),
    clear: () => rmSync(file, { force: true }),
    isLlmWiki(pid) {
      try {
        const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          windowsHide: true,
        })
        return out.toLowerCase().includes('llm-wiki.exe')
      } catch {
        return false
      }
    },
    kill(pid) {
      try {
        process.kill(pid)
      } catch {
        // already gone
      }
    },
  }
}
```

Run the test: expected PASS (3 tests).

- [ ] **Step 3: Wire into `work-wiki.ts`** (no unit test; covered by Tasks 8, 9 step 1 and the acceptance run)

Add module state and functions:

```ts
import { mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { readAiSettingsFile } from '@genoffice/ai-search'
import { LlmWikiProcess } from './llm-wiki-process'
import type { LlmWikiStatus } from './llm-wiki-process'
import {
  desiredSignature,
  llmWikiExePath,
  pickFreePorts,
  pidFileStore,
  realFetch,
  realSpawn,
} from './llm-wiki'
import {
  ensureProjectId,
  llmWikiLlmFromAiSettings,
  readAppState,
  seedAppState,
  writeAppState,
} from './llm-wiki-seed'

const LLM_WIKI_IDENTIFIER = 'com.opengenoffice.llmwiki'
const DRIFT_CHECK_MS = 30_000

let llmWiki: LlmWikiProcess | null = null
let llmWikiSignature = ''
let driftTimer: ReturnType<typeof setInterval> | null = null
let llmWikiReason: string | null = null

const llmWikiDataDir = () => join(app.getPath('appData'), LLM_WIKI_IDENTIFIER)
const devLlmWikiDir = () => join(app.getAppPath(), 'build')

/** status for Settings: whether this install ships it, and how it is doing */
export function llmWikiStatus(): LlmWikiStatus & { available: boolean } {
  const available = llmWikiExePath(process.resourcesPath, devLlmWikiDir()) !== null
  if (llmWiki) return { ...llmWiki.status(), available }
  return { state: 'stopped', available, ...(llmWikiReason ? { reason: llmWikiReason } : {}) }
}

export async function openLlmWiki(): Promise<boolean> {
  return (await llmWiki?.show()) ?? false
}

/** (re)start LLM Wiki for the current settings; every failure becomes a status, never an exception */
async function startLlmWiki(): Promise<void> {
  await llmWiki?.stopAndWait()
  llmWiki = null
  llmWikiReason = null
  if (driftTimer) clearInterval(driftTimer)
  driftTimer = null
  const s = readWorkWikiSettings()
  const exe = llmWikiExePath(process.resourcesPath, devLlmWikiDir())
  if (!s.enabled || process.platform !== 'win32') return
  if (!exe) {
    llmWikiReason = 'LLM Wiki is not installed'
    return
  }
  try {
    const ai = llmWikiLlmFromAiSettings(
      readAiSettingsFile(join(paths!.userData, 'ai-settings.json')),
    )
    const llm = ai.ok ? ai.llm : null
    if (!ai.ok) llmWikiReason = ai.reason
    const projectId = ensureProjectId(s.folder)
    // LLM Wiki watches this folder; it must exist (the engine itself never creates it)
    mkdirSync(join(s.folder, 'raw', 'sources'), { recursive: true })
    const dir = llmWikiDataDir()
    // its settings are written only now, while it is not running
    writeAppState(
      dir,
      seedAppState(readAppState(dir), {
        projectId,
        wikiRoot: s.folder,
        projectName: '업무 위키',
        llm,
        now: Date.now(),
      }),
    )
    const proc = new LlmWikiProcess({
      exePath: exe,
      projectId,
      spawn: realSpawn,
      fetch: realFetch,
      pickPorts: pickFreePorts,
      stale: pidFileStore(join(paths!.userData, 'llm-wiki.pid')),
      extraEnv: { PDFIUM_DYNAMIC_LIB_PATH: join(dirname(exe), 'pdfium') },
      log: (m) => console.warn(`[work-wiki] ${m}`),
    })
    llmWiki = proc
    llmWikiSignature = desiredSignature(llm, s.folder)
    await proc.start()
    // a changed model, key or folder in GenOffice restarts it with the new settings
    driftTimer = setInterval(() => {
      const next = llmWikiLlmFromAiSettings(
        readAiSettingsFile(join(paths!.userData, 'ai-settings.json')),
      )
      if (
        desiredSignature(next.ok ? next.llm : null, readWorkWikiSettings().folder) !==
        llmWikiSignature
      )
        void startLlmWiki()
    }, DRIFT_CHECK_MS)
    driftTimer.unref()
  } catch (err) {
    llmWikiReason = err instanceof Error ? err.message : String(err)
  }
}

/** engine and LLM Wiki stop together; bounded so quitting is never held up */
export async function stopWorkWikiForQuit(): Promise<void> {
  if (driftTimer) clearInterval(driftTimer)
  driftTimer = null
  const old = engine
  engine = null
  await Promise.race([
    Promise.all([old?.stopAndWait(), llmWiki?.stopAndWait()]),
    new Promise((r) => setTimeout(r, 4000)),
  ])
}
```

Changes to existing code in `work-wiki.ts`:

- In `restart()`, after `if (next.start()) engine = next`, add `void startLlmWiki()`; when the wiki is switched off (`if (!s.enabled) return` branch) also call `void startLlmWiki()` first so LLM Wiki stops (its function returns early after stopping).
- The `WorkWikiEngine` options get `extraSearch: (q) => llmWiki?.search(q) ?? Promise.resolve([])`.
- `registerWorkWikiIpc` adds:

```ts
ipcMain.handle(HOME_CHANNELS.getLlmWikiStatus, () => llmWikiStatus())
ipcMain.handle(HOME_CHANNELS.openLlmWiki, () => openLlmWiki())
```

`home-api.ts`: channels `getLlmWikiStatus: 'home:get-llm-wiki-status'`, `openLlmWiki: 'home:open-llm-wiki'`; interface members `getLlmWikiStatus(): Promise<LlmWikiStatusView>` and `openLlmWiki(): Promise<boolean>`; `export interface LlmWikiStatusView { state: 'stopped' | 'starting' | 'running' | 'failed'; reason?: string; available: boolean }`. `preload/index.ts`: matching `async` wrappers like `getWorkWikiSettings`.

- [ ] **Step 4: Quit hook in `index.ts`**

Replace the body of `app.on('before-quit', () => {...})` start with a guarded async stop:

```ts
let quittingAfterWikiStop = false
app.on('before-quit', (event) => {
  if (!quittingAfterWikiStop) {
    event.preventDefault()
    quittingAfterWikiStop = true
    void stopWorkWikiForQuit().finally(() => app.quit())
    return
  }
  ...the existing body (markSheetsShuttingDown, stopSheetsSidecar, stopMcpSync)...
})
```

Import `stopWorkWikiForQuit` from `./work-wiki`. The second `app.quit()` re-enters `before-quit` with the flag set and runs the existing shutdown code.

- [ ] **Step 5: Settings status line and open button**

`strings.ts` (all 21 language blocks, by the script pattern used for `setWorkWiki*`: insert after `setWorkWikiExcludeRemove`). Korean texts: `setLlmWiki` "LLM Wiki", `setLlmWikiRunning` "실행 중", `setLlmWikiStarting` "시작하는 중…", `setLlmWikiStopped` "실행 안 됨", `setLlmWikiFailed` "LLM Wiki가 실행되지 않습니다: {reason}", `setLlmWikiMissing` "이 설치본에는 LLM Wiki가 들어 있지 않습니다", `setLlmWikiOpen` "LLM Wiki 열기". Chinese for `zh` and `zh-TW`, Japanese for `ja`, English elsewhere.
`llmWikiStatus()` turns the reason `health check timed out` into `LLM Wiki did not start; check that the Microsoft Edge WebView2 runtime is installed` (the usual cause on a machine without it), so Settings names the likely fix.
`WorkWikiSettings.tsx`: below the folder row, a block that polls `window.aiOffice.getLlmWikiStatus()` every 5 seconds while mounted and shows the state text, plus a button `setLlmWikiOpen` calling `window.aiOffice.openLlmWiki()` (disabled unless `state === 'running'`). Add a jsdom test in `work-wiki-settings-ui.test.ts` that renders with `getLlmWikiStatus` returning `{state:'failed', reason:'x', available:true}` and expects the reason on screen and the open button disabled, then with `running` expects it enabled and a click calling `openLlmWiki`.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run apps/shell/tests/llm-wiki-glue.test.ts apps/shell/tests/work-wiki-settings-ui.test.ts && npm run typecheck -w @genoffice/shell && npm run check:english-comments && npm run check:theme-colors`
Expected: PASS. Then `npm test -w @genoffice/shell` and confirm only the known Windows-path failures remain (headless-export, folder-tree, default-app, update-resume).

```bash
git add apps/shell
git commit -m "feat(shell): run LLM Wiki with the work wiki; status in Settings; stop it on quit"
```

---

### Task 10: Add material

**Files:**

- Create: `apps/shell/src/main/add-material.ts`, `apps/shell/tests/add-material.test.ts`
- Modify: `apps/shell/src/main/work-wiki.ts`, `apps/shell/src/main/index.ts` (Home and Hangul menus, `tm` strings), `apps/shell/src/shared/home-api.ts`, `apps/shell/src/preload/index.ts`, `apps/shell/src/renderer/src/Home.tsx`, `WorkWikiSettings.tsx`, `strings.ts`

**Interfaces:**

- Produces:
  - `addMaterial(opts: { files: string[]; rawSources: string; extractText: (path: string) => Promise<string | null> }): Promise<{ added: string[]; skipped: Array<{ file: string; reason: string }> }>`
  - IPC `home:add-wiki-material` → `{ added: number; skipped: number; canceled: boolean }`

- [ ] **Step 1: Write the failing test** `add-material.test.ts`

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addMaterial } from '../src/main/add-material'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mat-'))
  const rawSources = join(dir, 'raw', 'sources')
  const src = (name: string, text = 'x') => {
    const p = join(dir, name)
    writeFileSync(p, text)
    return p
  }
  return { dir, rawSources, src }
}

describe('addMaterial', () => {
  it('converts Hangul files to Markdown text without page markers, and copies the other formats as they are', async () => {
    const { rawSources, src } = setup()
    const hwp = src('회사소개서.hwp')
    const pdf = src('실적.pdf', 'PDFDATA')
    const r = await addMaterial({
      files: [hwp, pdf],
      rawSources,
      extractText: async () => '[page 1]\n회사 개요\n주요 실적\n\n[page 2]\n연락처',
    })
    expect(r.skipped).toEqual([])
    const md = readFileSync(join(rawSources, '회사소개서.md'), 'utf8')
    expect(md).toContain('# 회사소개서')
    expect(md).toContain('주요 실적')
    expect(md).not.toContain('[page')
    expect(readFileSync(join(rawSources, '실적.pdf'), 'utf8')).toBe('PDFDATA')
    expect(r.added.sort()).toEqual(
      [join(rawSources, '실적.pdf'), join(rawSources, '회사소개서.md')].sort(),
    )
  })

  it('never overwrites an existing file: a name clash gets a number', async () => {
    const { rawSources, src } = setup()
    const a = src('a.md', 'first')
    await addMaterial({ files: [a], rawSources, extractText: async () => null })
    writeFileSync(a, 'second')
    const r = await addMaterial({ files: [a], rawSources, extractText: async () => null })
    expect(readFileSync(join(rawSources, 'a.md'), 'utf8')).toBe('first')
    expect(readFileSync(join(rawSources, 'a (2).md'), 'utf8')).toBe('second')
    expect(r.added).toEqual([join(rawSources, 'a (2).md')])
  })

  it('reports files it cannot use instead of dropping them silently', async () => {
    const { rawSources, src } = setup()
    const bad = src('x.exe')
    const empty = src('빈문서.hwpx')
    const missing = join(rawSources, '..', 'no-such.docx')
    const r = await addMaterial({
      files: [bad, empty, missing],
      rawSources,
      extractText: async () => '   ',
    })
    expect(r.added).toEqual([])
    expect(r.skipped.map((s) => s.file)).toEqual([bad, empty, missing])
    expect(r.skipped[0]!.reason).toMatch(/format/i)
    expect(r.skipped[1]!.reason).toMatch(/text/i)
    expect(r.skipped[2]!.reason).toMatch(/read|found/i)
    expect(existsSync(join(rawSources, '빈문서.md'))).toBe(false)
  })

  it('does not take more than fifty files at once', async () => {
    const { rawSources, src } = setup()
    const files = Array.from({ length: 52 }, (_, i) => src(`f${i}.md`))
    const r = await addMaterial({ files, rawSources, extractText: async () => null })
    expect(r.added).toHaveLength(50)
    expect(r.skipped).toHaveLength(2)
  })
})
```

Run: `npx vitest run apps/shell/tests/add-material.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 2: Implement `add-material.ts`**

```ts
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const COPY = new Set(['.docx', '.pptx', '.xlsx', '.pdf', '.md', '.txt'])
const HANGUL = new Set(['.hwp', '.hwpx'])
const MAX_FILES = 50
const MAX_BYTES = 100 * 1024 * 1024

export interface AddMaterialResult {
  added: string[]
  skipped: Array<{ file: string; reason: string }>
}

/** a free name in the folder: the wanted one, else "name (2).ext", "name (3).ext" */
function freeName(dir: string, name: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let n = 1
  let candidate = name
  while (existsSync(join(dir, candidate))) candidate = `${stem} (${++n})${ext}`
  return join(dir, candidate)
}

/**
 * Put the user's files into raw/sources for LLM Wiki to learn. Hangul files become Markdown text
 * (LLM Wiki cannot read them); the other formats are copied as they are. Nothing is overwritten.
 */
export async function addMaterial(opts: {
  files: string[]
  rawSources: string
  extractText: (path: string) => Promise<string | null>
}): Promise<AddMaterialResult> {
  const result: AddMaterialResult = { added: [], skipped: [] }
  mkdirSync(opts.rawSources, { recursive: true })
  opts.files.forEach((file, i) => {
    if (i >= MAX_FILES)
      result.skipped.push({ file, reason: `more than ${MAX_FILES} files at once` })
  })
  for (const file of opts.files.slice(0, MAX_FILES)) {
    const ext = extname(file).toLowerCase()
    if (!COPY.has(ext) && !HANGUL.has(ext)) {
      result.skipped.push({ file, reason: 'unsupported file format' })
      continue
    }
    try {
      if (statSync(file).size > MAX_BYTES) {
        result.skipped.push({ file, reason: 'file is larger than 100 MB' })
        continue
      }
      if (COPY.has(ext)) {
        const target = freeName(opts.rawSources, basename(file))
        copyFileSync(file, target)
        result.added.push(target)
        continue
      }
      const text = (await opts.extractText(file))?.replace(/^\[page \d+\]\r?\n/gm, '').trim()
      if (!text) {
        result.skipped.push({ file, reason: 'no readable text in the file' })
        continue
      }
      const stem = basename(file, extname(file))
      const target = freeName(opts.rawSources, `${stem}.md`)
      writeFileSync(target, `# ${stem}\n\n${text}\n`, 'utf8')
      result.added.push(target)
    } catch (err) {
      result.skipped.push({
        file,
        reason: `could not read the file: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  return result
}
```

Run the test. Expected: PASS (4 tests).

- [ ] **Step 3: IPC, menus and buttons (no unit test beyond the above; checked in Task 12)**

`work-wiki.ts`, exported function and handler:

```ts
import { addMaterial } from './add-material'

/** ask for files and put them into the wiki's raw/sources; the result is shown in a message box */
export async function addWikiMaterialFromDialog(
  parent: BrowserWindow | null,
): Promise<{ added: number; skipped: number; canceled: boolean }> {
  const s = readWorkWikiSettings()
  const options = {
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    filters: [
      {
        name: tmw('materialFilter'),
        extensions: ['hwp', 'hwpx', 'docx', 'pptx', 'xlsx', 'pdf', 'md', 'txt'],
      },
    ],
  }
  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (picked.canceled || picked.filePaths.length === 0)
    return { added: 0, skipped: 0, canceled: true }
  const r = await addMaterial({
    files: picked.filePaths,
    rawSources: join(s.folder, 'raw', 'sources'),
    extractText,
  })
  const lines = [
    tmw('materialAdded', { n: r.added.length }),
    ...r.skipped.map((k) => `· ${basename(k.file)}: ${k.reason}`),
  ]
  await dialog.showMessageBox({
    type: r.skipped.length ? 'warning' : 'info',
    message: lines.join('\n'),
  })
  return { added: r.added.length, skipped: r.skipped.length, canceled: false }
}
```

(`tmw` is a small `createI18n` dictionary in this module for `ko`, `en` and `zh`; other languages fall back to `zh`, the dictionary default. Korean: `materialFilter` "문서", `materialAdded` "업무 위키에 자료 {n}개를 넣었습니다. 정리가 끝나면 AI가 참고합니다.", `materialOff` "업무 위키가 꺼져 있거나 사용할 수 없습니다.") Register `ipcMain.handle(HOME_CHANNELS.addWikiMaterial, (e) => addWikiMaterialFromDialog(BrowserWindow.fromWebContents(e.sender)))`. If the wiki is off or its folder is unusable, show the same message box with `tmw('materialOff')` and return `{ added: 0, skipped: 0, canceled: true }`.
`home-api.ts`: channel `addWikiMaterial: 'home:add-wiki-material'` and `addWikiMaterial(): Promise<{ added: number; skipped: number; canceled: boolean }>`; preload wrapper.
`index.ts`: in `buildHomeMenu()` and `buildHwpMenu()` File submenus, after the Save group, add:

```ts
{ type: 'separator' },
{ label: tm('menuWikiAddMaterial'), click: () => void addWikiMaterialFromDialog(BrowserWindow.getFocusedWindow()) },
{ label: tm('menuWikiOpen'), click: () => void openLlmWiki() },
```

Add the keys `menuWikiAddMaterial` ("업무 위키에 자료 추가…") and `menuWikiOpen` ("업무 위키 열기") to the `tm` table in `index.ts` for all 21 languages with a script that appends them after each `menuSaveAs:` line (Korean, Chinese, Japanese native; English elsewhere).
`Home.tsx`: a second row of two `quick-card` buttons (title `t('wikiAddMaterial')` with sub `.hwp .docx .pdf …`, and `t('wikiOpen')`) rendered after the "Open local" card in `renderQuickCards()`, calling `window.aiOffice.addWikiMaterial()` and `window.aiOffice.openLlmWiki()`. `WorkWikiSettings.tsx`: a "자료 추가…" button (`setWikiAddMaterial`) next to the LLM Wiki status. `strings.ts`, in all 21 blocks (Korean: `wikiAddMaterial` "업무 위키에 자료 추가", `wikiAddMaterialSub` ".hwp .docx .pdf …", `wikiOpen` "업무 위키 열기", `setWikiAddMaterial` "자료 추가…"; Chinese, Japanese and English texts as before).

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run apps/shell/tests/add-material.test.ts && npm run typecheck -w @genoffice/shell && npm run check:english-comments && npm run check:theme-colors && npm test -w @genoffice/shell`
Expected: PASS apart from the known Windows-path failures.

```bash
git add apps/shell
git commit -m "feat(shell): add material to the work wiki (Home card, menus, Settings)"
```

---

# Part D: Packaging and acceptance

### Task 11: Package LLM Wiki in the installer

**Files:**

- Create: `tools/fetch-llm-wiki.mjs`, `tools/llm-wiki.pin.json`
- Modify: `apps/shell/electron-builder.cjs`, `package.json` (script `fetch:llm-wiki`; `dist:win` runs it first), `.gitignore`, `ACKNOWLEDGMENTS.md`, `MODIFICATIONS.md`

**Interfaces:**

- Produces: `apps/shell/build/llm-wiki/{llm-wiki.exe, pdfium/pdfium.dll, scripts/extract_pdf.py, LICENSE, SOURCE.txt}`; the same folder under `resources/llm-wiki/` in the installer.

- [ ] **Step 1: The pin**

`tools/llm-wiki.pin.json`:

```json
{
  "repo": "https://github.com/raondaon-kim/llm_wiki",
  "commit": "<the commit printed at the end of Task 4>"
}
```

Replace the placeholder with the real hash before this step is finished; the fetch script refuses a checkout at any other commit.

- [ ] **Step 2: The fetch script**

`tools/fetch-llm-wiki.mjs` (Windows x64 only; elsewhere it prints a notice and exits 0):

```js
// Build the LLM Wiki fork from a local checkout and stage it for the installer.
//   LLM_WIKI_FORK_DIR=D:\llm_wiki_ubion\llm_wiki node tools/fetch-llm-wiki.mjs [--force]
// The checkout must be at the commit in tools/llm-wiki.pin.json.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'shell', 'build', 'llm-wiki')
const pin = JSON.parse(readFileSync(join(ROOT, 'tools', 'llm-wiki.pin.json'), 'utf8'))
const FORCE = process.argv.includes('--force')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('llm wiki: only Windows x64 builds ship it; skipping')
  process.exit(0)
}
const fork = process.env.LLM_WIKI_FORK_DIR
if (!fork || !existsSync(join(fork, 'src-tauri', 'Cargo.toml'))) {
  console.error('llm wiki: set LLM_WIKI_FORK_DIR to a checkout of the fork (' + pin.repo + ')')
  process.exit(1)
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: true })
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fork, encoding: 'utf8' }).trim()
if (head !== pin.commit) {
  console.error(`llm wiki: the checkout is at ${head}, the pin is ${pin.commit}`)
  process.exit(1)
}
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
  cwd: fork,
  encoding: 'utf8',
}).trim()
if (dirty) {
  console.error(
    'llm wiki: the checkout has uncommitted changes; the shipped build must match the pinned commit',
  )
  process.exit(1)
}
const stamp = join(OUT, '.commit')
if (
  !FORCE &&
  existsSync(join(OUT, 'llm-wiki.exe')) &&
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8') === head
) {
  console.log(`llm wiki: up to date (${head.slice(0, 8)}), skipping`)
  process.exit(0)
}

if (!existsSync(join(fork, 'node_modules'))) run('npm', ['ci'], fork)
run('npx', ['tauri', 'build', '--no-bundle'], fork)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'pdfium'), { recursive: true })
mkdirSync(join(OUT, 'scripts'), { recursive: true })
copyFileSync(
  join(fork, 'src-tauri', 'target', 'release', 'llm-wiki.exe'),
  join(OUT, 'llm-wiki.exe'),
)
copyFileSync(join(fork, 'src-tauri', 'pdfium', 'pdfium.dll'), join(OUT, 'pdfium', 'pdfium.dll'))
copyFileSync(
  join(fork, 'src-tauri', 'scripts', 'extract_pdf.py'),
  join(OUT, 'scripts', 'extract_pdf.py'),
)
copyFileSync(join(fork, 'LICENSE'), join(OUT, 'LICENSE'))
writeFileSync(
  join(OUT, 'SOURCE.txt'),
  [
    'LLM Wiki (GPL-3.0), modified for GenOffice.',
    '',
    `Source of this exact build: ${pin.repo}`,
    `Commit: ${head}`,
    '',
    'Build: npm ci && npx tauri build --no-bundle (Node 22, Rust 1.95, protoc).',
    'The license text is in LICENSE next to this file. Upstream: https://github.com/nashsu/llm_wiki',
    '',
  ].join('\n'),
)
writeFileSync(stamp, head)
console.log(`llm wiki: staged ${head.slice(0, 8)} in ${OUT}`)
```

Run: `LLM_WIKI_FORK_DIR=D:/llm_wiki_ubion/llm_wiki node tools/fetch-llm-wiki.mjs`
Expected: builds and stages the folder; running it again prints "up to date".

- [ ] **Step 3: Installer config**

`apps/shell/electron-builder.cjs`, in the Windows `extraResources` list (the one with `xlsx-sidecar.exe`), add:

```js
{
  from: 'build/llm-wiki',
  to: 'llm-wiki',
  filter: ['llm-wiki.exe', 'pdfium/**', 'scripts/**', 'LICENSE', 'SOURCE.txt'],
},
```

Add the path `build/llm-wiki/llm-wiki.exe` to the list checked by `assertExtraResourceSources` for the Windows x64 build so an installer cannot be built without it (the pattern used for the rhwp CLI there). `.gitignore`: `/apps/shell/build/llm-wiki/`. `package.json`: `"fetch:llm-wiki": "node tools/fetch-llm-wiki.mjs"` and `dist:win` becomes `npm run fetch:llm-wiki && npm run notices && npm run build:all && npm run dist:win -w @genoffice/shell`.

- [ ] **Step 4: Notices and docs**

`ACKNOWLEDGMENTS.md`: a section "LLM Wiki" naming nashsu/llm_wiki (GPL-3.0, Copyright (C) 2024-2026 Yong Su), saying it ships as a separate program in `resources/llm-wiki/` with its license and the exact source location (`SOURCE.txt`), and that the fork's changes are listed in its `MODIFICATIONS.md`. `MODIFICATIONS.md` (GenOffice): a bullet for the bundled LLM Wiki (managed mode, folder ownership, add material, search merge). `README.md`: a short line under the work wiki feature.

- [ ] **Step 5: Verify and commit**

Run: `npm run check:english-comments && npx prettier --check ACKNOWLEDGMENTS.md MODIFICATIONS.md tools/fetch-llm-wiki.mjs tools/llm-wiki.pin.json`
Expected: OK.

```bash
git add tools apps/shell/electron-builder.cjs package.json .gitignore ACKNOWLEDGMENTS.md MODIFICATIONS.md README.md
git commit -m "build: package the LLM Wiki fork with the installer (separate program, license and source notice)"
```

---

### Task 12: Acceptance run, fixes, installer

**Files:**

- Create: `scripts/drivers/driver.llm-wiki.mjs` (local, gitignored)
- Modify: whatever the run shows is wrong (each fix gets its own failing test first where a unit test can express it)

- [ ] **Step 1: Back up the test target and build**

`%APPDATA%\com.opengenoffice.llmwiki` is the fork's own folder and does not exist on a machine that never ran it. If it exists, move it to `com.opengenoffice.llmwiki.bak-<time>`. Then build the apps used by the driver: `for w in hwp docs slides shell; do npm run build -w @genoffice/$w; done`, and stage LLM Wiki with `fetch:llm-wiki` (Task 11 step 2).

- [ ] **Step 2: Hidden ingest check (the technical risk)**

Run a small script (`scripts/drivers/check-hidden-ingest.mjs`, local):

1. Make a temp wiki root with `schema.md`, `wiki/`, and a project id.
2. Seed `%APPDATA%\com.opengenoffice.llmwiki\app-state.json` with `seedAppState` using the DeepSeek key from `GENOFFICE_SEED_DEEPSEEK_API_KEY` (never printed).
3. Start `LlmWikiProcess` against `apps/shell/build/llm-wiki/llm-wiki.exe` with the real glue from `llm-wiki.ts`.
4. Write `회사소개.md` (a short company profile with two track-record entries) into `raw/sources/`.
5. Poll up to 10 minutes for `wiki/sources/회사소개*.md`.
6. Assert there is no `llm-wiki.exe` window visible (`Get-Process llm-wiki | Select MainWindowHandle` shows a hidden window), and that `/health` and a `/search` for a company fact answer.
7. `stopAndWait()` and confirm no `llm-wiki.exe` process remains.

Expected: a source page appears while the window is hidden.
**If ingest stalls with the window hidden** (the page never appears, or only after `show()`): the WebView is being throttled. First confirm `backgroundThrottling` was accepted in `tauri.conf.json` (Task 2 step 5). If it was removed or does not help, change the fork's setup to keep the window _visible but out of sight_: position it at `(-32000, -32000)`, `skip_taskbar(true)`, and make `/app/show` move it back to the center. Add a test for the position helper, rebuild, and rerun this step.

- [ ] **Step 3: The four-step scenario in the app (the user's completion criteria)**

Write `scripts/drivers/driver.llm-wiki.mjs` (Playwright on the dev shell, clean GenOffice profile, `workWiki.folder` set to a temp folder, DeepSeek settings, `GENOFFICE_WORK_WIKI_DEBOUNCE_MS=3000`). It does, and prints one `LLMWIKI:` JSON line:

1. **Material in:** stub the open dialog to return two files: a company profile `.hwp` (make one with `rhwp` from the existing sample text plus two track-record paragraphs) and `D:/tmp/oda-survey/rfp/koica_indonesia_health_R25BK01238511_2.pdf`. Click Home → "업무 위키에 자료 추가…". Wait until LLM Wiki has written `wiki/sources/*` and `wiki/entities/*` (up to 15 minutes).
2. **Documents in:** open `GenOffice_ODA제안서_샘플_KOICA_인도네시아보건.hwpx`, Save As `.hwp`; wait for the work and method pages.
3. **Later work uses both:** open a new Word document and ask "KOICA 인도네시아 보건 후속 제안서 개요를 우리 회사 실적을 넣어서 써 줘. 문서에 넣지 말고 답변으로". Record the step titles and the reply.
4. **Window and shutdown:** click Home → "업무 위키 열기"; the LLM Wiki window shows on the same folder; then close GenOffice and confirm `llm-wiki.exe` is gone.

Success, in the user's terms:

- LLM Wiki pages exist for the added files (1).
- The assistant's steps include `업무 위키 검색` and `업무 위키 읽기` on at least one LLM Wiki page (`sources/…` or `entities/…`) and one GenOffice page (`work/…` or `methods/…`).
- The reply uses a fact that is only in the added company profile and names the pages it used.
- No `llm-wiki.exe` left after quitting.

- [ ] **Step 4: Fix what the run shows**

For each failure: reproduce it in a unit test where possible (most are in `llm-wiki-seed`, `llm-wiki-process`, `add-material`, `engine`), watch it fail, fix, rerun the whole acceptance. Likely candidates: LLM Wiki's search path field names (compare the real `/search` response with `hitOfSearchResult`), `llmConfig` fields LLM Wiki needs beyond those seeded, the Korean output language key, the hidden-window fallback.

- [ ] **Step 5: Whole-suite check**

Run: `npx vitest run packages/work-wiki`, `npm test -w @genoffice/shell`, `npx vitest run --project @genoffice/hwp`, `npm test -w @genoffice/docs`, `npm test -w @genoffice/slides`, typecheck for work-wiki, hwp, docs, slides, sheets and shell, `npm run check:english-comments`, `npm run check:theme-colors`, `npx eslint` on every changed file, and `npx prettier --check` on the same set.
Expected: green apart from the known Windows-path failures in the shell suite and the load-dependent docs timeout.

- [ ] **Step 6: Installer and the installed app**

`npm run dist:win` with no LiteLLM or update-feed variables (`OPEN_GENOFFICE_WIN_SIDECAR_TARGET=x86_64-pc-windows-msvc` only). Check `apps/shell/release/win-unpacked/resources/llm-wiki/` holds `llm-wiki.exe`, `pdfium/pdfium.dll`, `scripts/extract_pdf.py`, `LICENSE`, `SOURCE.txt`. Run steps 1 to 4 of the driver against `win-unpacked\Open GenOffice.exe` (the driver's `exe` argument). **Ask the user before installing over `D:\Programs\Open GenOffice`** (the app must be closed).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(llm-wiki): changes found by the acceptance run"
```

(Only if the run needed fixes; the drivers stay untracked.)
