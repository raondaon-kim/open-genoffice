# LLM Wiki bundled with GenOffice

Date: 2026-10-15. Status: design, awaiting review. Builds on
`2026-10-13-work-wiki-design.md` (the work wiki already in GenOffice).

## Goal

One installer installs GenOffice and LLM Wiki. While GenOffice runs, LLM Wiki runs too, out of
sight. Both write into the same wiki folder, and the assistants use both.

**Success, as the user defined it:**

1. A document the user adds becomes wiki pages.
2. Later work refers to those pages.

The acceptance run at the end checks exactly this.

## Decisions taken with the user

| Question             | Decision                                                                                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install              | One GenOffice installer that also installs LLM Wiki. The user never installs or configures LLM Wiki separately.                                                                                                                                                                                                 |
| Lifetime             | LLM Wiki starts with GenOffice, without a window, and quits when GenOffice quits. A menu item shows its window on demand.                                                                                                                                                                                       |
| Roles                | GenOffice keeps learning works, methods and clients from saved documents and chat. LLM Wiki learns the material the user adds (company profile, past proposals, and so on) its own way (entities, concepts, source summaries, embeddings, graph). The assistants search and read both.                          |
| What LLM Wiki learns | Only the material the user adds, not every saved document (this keeps the token cost bounded).                                                                                                                                                                                                                  |
| License              | LLM Wiki is GPL-3.0. It ships as a **separate program** (aggregation), so GenOffice stays Apache-2.0. Its license text and the location of the exact source of the shipped build go into the installer and the third-party notices. The modified source lives in a fork repository in the private organization. |

## Why a fork

LLM Wiki v0.4.12 (`nashsu/llm_wiki`) as shipped cannot be embedded as-is:

| Problem in v0.4.12                                                                                                                                     | Fork change                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| No release binary in the tree. The local debug build needs the Vite dev server.                                                                        | Release build (`tauri build`) of the fork.                                                                                                      |
| No way to start without a window. The window is always visible, with no CLI flags, tray or single-instance guard. Ingest runs only inside the WebView. | `LLM_WIKI_MANAGED=1`: the main window is created hidden (the WebView still runs, so ingest works), and closing it hides it instead of quitting. |
| No way to show the window, or to quit cleanly from outside. Close asks "Are you sure…".                                                                | Two authenticated API routes: `POST /api/v1/app/show` and `POST /api/v1/app/quit`. Quit flushes the store and then exits.                       |
| Same app identifier (`com.llmwiki.app`) and fixed ports (19827 clip, 19828 API) as a personal LLM Wiki install. This user already has one.             | Identifier `com.opengenoffice.llmwiki` (its own settings folder). Ports come from `LLM_WIKI_API_PORT` and `LLM_WIKI_CLIP_PORT`.                 |
| Update check against `nashsu/llm_wiki`.                                                                                                                | Off when managed.                                                                                                                               |
| Local, uncommitted PDF OCR changes hard-code `C:\Users\김용현\…` and `C:\Program Files\Tesseract-OCR`.                                                 | Keep the feature, but find the tools on `PATH` only. Spawn them without a console window.                                                       |

Everything else is unchanged upstream code. The fork keeps the upstream history and documents
its changes in `MODIFICATIONS.md`.

## Shared folder: who owns what

```
<wiki root> (Documents\GenOffice 업무위키 by default)
  schema.md, purpose.md         seeded by GenOffice; LLM Wiki reads them (schema.md marks the folder as a project)
  .llm-wiki/project.json        LLM Wiki project id (written by GenOffice before the first launch)
  raw/sources/                  LLM Wiki: watched and ingested
  raw/genoffice-notes/          GenOffice: chat notes (moved out of raw/sources so LLM Wiki does not ingest them twice)
  wiki/index.md, log.md,        LLM Wiki owns them; GenOffice no longer writes them
  overview.md
  wiki/entities|concepts|sources|...   LLM Wiki pages
  wiki/work|methods|clients     GenOffice pages (LLM Wiki may read and link them, see below)
```

**Changes to the work wiki engine:**

- It stops writing `wiki/index.md` and `wiki/log.md`. Its log goes to the engine state folder
  (`userData/work-wiki/<hash>/log.md`). LLM Wiki rewrites `index.md` wholesale and appends to
  `log.md` without atomic writes, so two writers would lose lines. GenOffice's catalog never read
  `index.md` anyway: it is built from front matter.
- It stops watching `raw/sources` (LLM Wiki owns that folder). Chat notes move to
  `raw/genoffice-notes/`.
- `sources:` on GenOffice pages lists document paths outside `raw/sources`. LLM Wiki's
  delete-cascade fires only when a `raw/sources` file is deleted, so it never removes GenOffice
  pages.

## Adding material (the user's entry point)

- **Menu:** File → "업무 위키에 자료 추가…" in every editor, plus a Home action. It opens a file
  picker for several files. Accepted: hwp, hwpx, docx, pptx, xlsx, pdf, md, txt.
- **Conversion:**
  - LLM Wiki cannot read Hangul files. GenOffice converts hwp and hwpx to Markdown with the
    bundled rhwp (`export-markdown`) and writes `<name>.md` into `raw/sources/`.
  - Other formats are copied as they are.
  - A name clash gets a numeric suffix.
- **Feedback:** a toast "업무 위키에 자료 3개를 넣었습니다. 정리가 끝나면 AI가 참고합니다."
  Progress is visible in LLM Wiki's window (menu "업무 위키 열기").
- **Ingest:** LLM Wiki picks the files up through its own watcher (auto-ingest on) and writes
  pages, embeddings and index lines.

## LLM Wiki lifecycle (GenOffice main process)

**On GenOffice start, if the work wiki is on:**

1. Make sure the wiki root has `schema.md` and `wiki/`, and that `.llm-wiki/project.json` holds
   a stable uuid. The uuid is generated once and kept.
2. Write `%APPDATA%\com.opengenoffice.llmwiki\app-state.json`. Only these keys are set, and
   every other key is kept as LLM Wiki saved it:
   - `lastProject`, `projectRegistry[<uuid>]`, `recentProjects` pointing at the wiki root;
   - `llmConfig` from GenOffice's AI settings: provider `custom`, `customEndpoint` = the
     provider's OpenAI-compatible base URL, `apiKey`, `model`, `apiMode: chat_completions`.
     `activePresetId` is null;
   - `apiConfig` `{enabled: true, allowUnauthenticated: false, token: <random per install>}`;
   - `sourceWatchConfig[<uuid>]` `{enabled: true, autoIngest: true}`, plus defaults;
   - `outputLanguage` / `projectOutputLanguages[<uuid>]` = Korean.

   This is done only while LLM Wiki is not running, because it overwrites external edits.

3. Spawn the bundled `llm-wiki.exe` with `LLM_WIKI_MANAGED=1`, `LLM_WIKI_API_TOKEN`, and free
   ports for `LLM_WIKI_API_PORT` and `LLM_WIKI_CLIP_PORT` (chosen at start). Then poll
   `/health` until it is up (timeout 30 s).
4. If it exits unexpectedly, restart it up to 3 times, with backoff. After that, the assistants
   use GenOffice's own search only, and Settings shows "LLM Wiki가 실행되지 않습니다".

**On GenOffice quit:** `POST /app/quit`, then wait up to 5 s, then kill.

**When an AI provider is unsupported** (codex CLI, for example): LLM Wiki still runs for search
and reading, but cannot ingest. Settings says so.

**WebView2:** checked at start. If it is missing, Settings shows the download link and
GenOffice keeps working without LLM Wiki.

## How the assistants use both

- **`wiki_search(query)`:** GenOffice's keyword search now covers every `wiki/**/*.md`, not
  only work, methods and clients, including LLM Wiki's pages. When LLM Wiki is up, its
  `/search` (keyword + vector, RRF) runs too. Results are merged by path (GenOffice pages are
  ranked first for the same score) and the top 8 are returned with their folder type (업무,
  작업 방식, 기관, 인물·기관 (entities), 개념, 자료 요약).
- **`wiki_read(path or slug)`:** reads any wiki page from disk. Page names are validated as
  today, and the path must stay under `wiki/`. Text is fenced as data.
- **Catalog each turn:** as today, plus one line with how many LLM Wiki pages exist and that
  they are reached through `wiki_search`.
- **Rule** (added to the skill prompt): "For company facts, people, track record and past
  material, search the wiki first. LLM Wiki's source summaries hold what the user added."

## Settings and menus

- **Settings → AI media → 업무 위키 block**, which gets one more line: LLM Wiki status
  (실행 중 / 정리 중 n건 / 실행 안 됨 + reason).
- **Entry points (first version):** the Home screen (a card pair and the File menu), the Hangul File menu, and buttons in Settings. Word and PowerPoint menus are built inside those apps and are left for later.
- **File menu items:**
  - "업무 위키 열기" (shows the LLM Wiki window)
  - "업무 위키에 자료 추가…"

## Packaging

- **Installer contents:** the fork's release `llm-wiki.exe`, `pdfium.dll`, `scripts/` and
  `LICENSE` go into `extraResources/llm-wiki/`. The NOTICE / third-party notices name LLM Wiki
  (GPL-3.0), its upstream, and the fork URL and commit of the shipped build.
- **Build:** `tools/fetch-llm-wiki.mjs` builds the fork at a pinned commit, or downloads its
  release artifact, into `apps/shell/build/llm-wiki/`, the way `fetch-rhwp-cli` does. The
  installer build fails if it is missing.

## Errors

- **Folder problems:** the wiki folder is unwritable or not a valid project → the work wiki
  engine already disables itself; LLM Wiki is not started.
- **Port conflicts:** they cannot happen with its own ports. A failed health check means
  restart, then degrade.
- **The AI key changes in GenOffice:** LLM Wiki is restarted after `app-state.json` is
  rewritten (quit → write → start).
- **A crash in the middle of an ingest:** LLM Wiki resumes its own queue on the next start.

## Testing

- **Fork:**
  - hidden start;
  - show / quit routes (auth required);
  - close hides the window when managed;
  - identifier and ports from env;
  - an upstream behaviour check that ingesting a file in `raw/sources` writes pages.
- **GenOffice unit:**
  - `app-state.json` seeding keeps foreign keys and maps each AI provider;
  - project bootstrap is idempotent;
  - adding material converts hwp to md, copies other files and suffixes on clashes;
  - merged search;
  - path validation for `wiki_read`;
  - the engine no longer writes `index.md` / `log.md` and no longer watches `raw/sources`;
  - the launcher's restart and degrade path (with a fake child process).
- **Acceptance, in the installed app, on a clean profile:**
  1. "업무 위키에 자료 추가…" with a company profile (.hwp) and a past proposal (.pdf) → LLM
     Wiki pages appear (`wiki/sources`, `entities`, `concepts`, index lines), with LLM Wiki
     hidden.
  2. Save a proposal in GenOffice → work and method pages appear.
  3. In a new Word document, "KOICA 제안서 개요를 회사 실적을 넣어서 써 줘" → the steps show
     wiki_search and wiki_read on LLM Wiki pages and on GenOffice pages, and the reply uses
     facts from the added profile and names the pages.
  4. "업무 위키 열기" shows LLM Wiki on the same folder. Quitting GenOffice ends the
     `llm-wiki.exe` process.
