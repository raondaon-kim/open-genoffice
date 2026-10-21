# Saved documents in the work wiki and a two-level index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every saved document reaches LLM Wiki and GenOffice's learning; the wiki index becomes a
code-built two-level index; AI context stays within fixed budgets.

**Architecture:** Two repositories. The LLM Wiki fork (`D:\llm_wiki_ubion\llm_wiki`, Tauri + TS +
Rust) gets an index builder that is the only writer of index files, a relevance slice for ingest
prompts, rewrite-on-modify for sources, walker exclusions and a rebuild endpoint (Tasks 1–6).
GenOffice (`D:\genoffice-next`) gets save hooks in four more editors, a saved-document mirror in
the work-wiki engine, widened learning, a question-relevant catalog, a `wiki_index` tool and the
skill in all seven panels, then pins the new fork commit (Tasks 7–13).

**Tech Stack:** TypeScript, React 19, Electron, Tauri 2 (Rust), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-wiki-saved-docs-and-index-design.md`

## Global Constraints

- GenOffice: docs/comments English-only (`npm run check:english-comments`), CSS tokens only,
  Prettier + lint clean; every new shell UI string in all 21 locales (`apps/shell/tests/strings.test.ts`).
- Fork: `npm run typecheck` and `npm run test:mocks` green; Rust `cargo test` in `src-tauri` green.
- The fork's index builder is the only writer of `wiki/index.md` and `wiki/index/**`.
- Numbers from the spec: top index ≤ 4,000 chars with 5 recent pages per category; split a category
  over 200 pages; groups < 5 pages → 기타; ≤ 30 groups; `wiki_index` ≤ 6,000 chars; overview ≤ 6,000
  chars in prompts; ingest index context ≤ `computeContextBudget(...).indexBudget`; mirror ≤ 100 MB,
  replaced at most once an hour, debounced 120 s; AI catalog ≤ 3,000 chars; learn catalog ≤ 6,000.
- Index files are cut into parts at 6,000 chars or 200 lines, whichever comes first (ruling: 200
  lines of 120-char summaries cannot fit the 6,000-char tool cap the spec also sets).
- No internal address or key in either repository. Tests never touch the user's real wiki or
  `%APPDATA%\com.opengenoffice.llmwiki\app-state.json` (back it up and restore around packaged runs).
- Known Windows-only GenOffice failures are not regressions (shell `default-app`, `folder-tree`,
  `headless-export`, flaky `update-resume`; sheets `promote-file-atomically`; pdf `generated-output`,
  `text-insert-fallback`; markdown `image-export`; electron-utils `default-save-dir`, `dialog-memory`).

## Review Focus

1. Autosave storms (PDF/Markdown/HTML autosave while typing): one LLM Wiki re-ingest per document
   per hour at most, never a burst.
2. Two people sharing one wiki folder save different `보고서.docx`: two distinct copies, neither
   overwritten.
3. The rebuild deleting or rewriting `wiki/index/*.md` must not be seen by the file watcher as page
   deletions (no `[[entities]]`-style link stripping across the wiki).
4. A 1,000+ page wiki: top index ≤ 4,000 chars, every index file ≤ 6,000 chars, ingest index
   context within budget.
5. A modified source whose re-ingest fails: its single-source pages were removed first; the source
   stays queued for retry and the pages come back on success.

---

## Part 1 — LLM Wiki fork (`D:\llm_wiki_ubion\llm_wiki`)

Run commands from the fork root. One test file: `npx vitest run src/lib/<file>.test.ts`. Use
`realFs` + `createTempProject` from `src/test-helpers/fs-temp.ts` for disk tests
(`vi.mock("@/commands/fs", () => realFs)`); add `writeFileAtomic`/`fileExists` to `realFs` if used.

### Task 1: Index builder

**Files:** Create `src/lib/wiki-index.ts`, `src/lib/wiki-index.test.ts`.

**Interfaces — Produces:**

- `interface IndexPage { relPath: string; category: string; slug: string; title: string;
summary: string; tags: string[]; updated: string }`
- `collectIndexPages(projectPath: string): Promise<IndexPage[]>` — every `.md` under `wiki/<folder>/`
  except `wiki/index/**` and `wiki/media/**`; category = first folder; title from front matter (else
  slug); summary = first body line that is not a heading or empty, cut to 120 chars; tags and
  `updated` from front matter (`parseFrontmatter`).
- `buildIndexFiles(pages: IndexPage[], lang: string): Map<string, string>` — key is the path relative
  to the project (`wiki/index.md`, `wiki/index/<category>.md`, `wiki/index/<category>/<group>.md`,
  parts `…-2.md`).
- `rebuildWikiIndex(projectPath: string, lang: string): Promise<{ written: string[]; removed: string[] }>`
  — writes the map, deletes any other file under `wiki/index/`.
- `CATEGORY_LABELS: Record<string, { ko: string; en: string; descKo: string; descEn: string }>` for
  `sources entities concepts queries comparisons synthesis work methods clients` (ko: 자료, 인물·기관,
  개념, 질문, 비교, 종합, 작업물, 작업 방식, 발주처); `lang` starting with `ko` picks Korean.

- [ ] **Step 1: Tests** (`wiki-index.test.ts`):
  - `lists every page of every category and nothing else` (index files, media skipped).
  - `top index is under 4000 chars with page counts and 5 recent pages per category`.
  - `a category of 201 pages is split into groups by the first tag that is not the category name`
    (pages tagged `개념, 교육` go to `교육`).
  - `groups under 5 pages and untagged pages go to 기타; at most 30 groups are listed`.
  - `work pages are grouped by the year of updated; methods and clients go to numbered parts`.
  - `every index file is at most 6000 chars or 200 lines, cut into numbered parts`.
  - `rebuildWikiIndex removes stale files under wiki/index and replaces an old index.md` (seed an
    `index.md` with 18 lines pointing at missing pages; after rebuild none remain).
  - `1,200 synthetic pages: top index ≤ 4000, every file ≤ 6000` (Review Focus 4).
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement the five exports above.
- [ ] **Step 4:** Run → PASS. `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(wiki): build the two-level index from the pages on disk`.

### Task 2: The builder is the only index writer

**Files:** Modify `src/lib/ingest.ts` (`writeFileBlocks` ~840-917, `executeIngestWrites` ~1535-1687,
end of `autoIngestImpl` before the final `activity.updateItem` ~797), `src/lib/source-lifecycle.ts`
(`deleteSourceFiles` :173, `cleanupDeletedWikiPages` :300), `src/lib/dedup-runner.ts`
(`executeMerge` :165, index write at :240-251), `src/App.tsx` (`handleProjectOpened` after
`restoreQueue` ~:295), `src/components/chat/chat-message.tsx:194-215`,
`src/components/lint/lint-view.tsx:101-110`, `src/components/review/review-view.tsx:82-92,188-199`,
`src/lib/templates.ts` (`BASE_INDEX_FORMAT` :46-49, `BASE_CROSSREF` :58-62),
`src-tauri/src/commands/project.rs` (default schema `## Index Format` :87-90, :106).
Tests: `src/lib/ingest.writes.test.ts` (new), `src/lib/source-lifecycle.test.ts`.

**Interfaces — Consumes:** Task 1 `rebuildWikiIndex`. **Produces:**
`isIndexFilePath(relPath: string): boolean` in `wiki-index.ts` (true for `wiki/index.md` and
`wiki/index/**`); `currentOutputLanguage(): string` read from the wiki store's settings.

- [ ] **Step 1: Tests:** `writeFileBlocks ignores FILE blocks for wiki/index.md and wiki/index/**`;
      `executeIngestWrites ignores index blocks`; `a successful autoIngest rebuilds the index so it lists
the new pages` (mock LLM via `createStreamChatHarness`); `deleteSourceFiles and
cleanupDeletedWikiPages rebuild the index instead of editing index.md lines`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Skip index paths in both writers (the old `endsWith("/index.md")` overwrite branch
      goes); call `rebuildWikiIndex` at the end of `autoIngestImpl` (inside the project lock),
      `executeIngestWrites`, `deleteSourceFiles`, `cleanupDeletedWikiPages`, `executeMerge`, and in
      `handleProjectOpened`; replace the three UI writers' index edits with a rebuild; reword the
      templates and Rust default schema to "`wiki/index.md` and `wiki/index/` are maintained by the app;
      do not write them". Remove `cleanIndexListing`/`rewriteIndexMd` call sites (keep the functions if
      tests use them).
- [ ] **Step 4:** Run the new tests + `npm run test:mocks` → PASS. `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(wiki): the index builder is the only writer of index files`.

### Task 3: Relevant index slice in prompts

**Files:** Create `src/lib/index-context.ts` (+ test). Modify `src/lib/ingest.ts`
(`autoIngestImpl` reads :318-324, `buildAnalysisPrompt` :1029/:1074, `buildGenerationPrompt`
:1080/:1099/:1177-1178, `startIngest` :1475-1490, `executeIngestWrites` :1546-1558),
`src/lib/enrich-wikilinks.ts:34,75`, `src/lib/deep-research.ts:107-131`,
`src/components/chat/chat-panel.tsx:205-240`, `src/lib/ingest.prompt.test.ts`.

**Interfaces — Produces:**

- `trimIndexByRelevance(raw: string, query: string, budgetChars: number): string` — the chat
  panel's inline logic moved here unchanged (keep `##` lines and lines containing query tokens via
  `tokenizeQuery`, stop at budget, append `[...index trimmed to relevant entries...]` when cut).
- `selectIndexContext(projectPath: string, queryText: string, budgetChars: number): Promise<string>`
  — the top index, then lines from category/group index files ranked by query-token overlap, within
  `budgetChars`.
- `capOverview(text: string, max = 6000): string`.

- [ ] **Step 1: Tests:** `selectIndexContext stays within budget on a 1,200-page wiki and keeps a
line whose title shares a token with the query`; `the generation prompt no longer asks for an
updated wiki/index.md and labels the index as relevant entries`; `overview in prompts is capped at
6000 chars`; chat trimming test keeps its old behaviour through `trimIndexByRelevance`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Use `selectIndexContext(pp, chunkContent (+ analysis text for generation),
computeContextBudget(llmConfig.maxContextSize).indexBudget)` wherever the whole index was read;
      drop instruction 4 (":1099") and rename the section to `## Relevant Wiki Index (for linking; the
app maintains the index)`; `capOverview` the overview.
- [ ] **Step 4:** Run → PASS; `npm run test:mocks`; typecheck.
- [ ] **Step 5:** Commit `feat(wiki): send the relevant part of the index, not the whole file`.

### Task 4: A modified source is rewritten

**Files:** Modify `src/lib/source-lifecycle.ts` (`deleteSourceFiles` options),
`src/lib/project-file-sync.ts` (`enqueueRawSourceChanges` :170-185). Tests:
`source-lifecycle.test.ts`, `project-file-sync.test.ts`.

**Interfaces — Produces:** `deleteSourceFiles(…, { fileAlreadyDeleted?, logReason?,
keepMultiSourcePages?: boolean })` — with `keepMultiSourcePages`, pages that other sources also use
are left untouched (their `sources` not rewritten).

- [ ] **Step 1: Tests:** `a modified raw source first removes the pages whose only source it is,
keeps shared pages unchanged, then is queued for ingest`; `created sources are queued as before`;
      `if the re-ingest fails the source stays in the queue for retry` (Review Focus 5).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `enqueueRawSourceChanges`, for `kind === "modified"` call
      `deleteSourceFiles(project.path, [path], { fileAlreadyDeleted: true, keepMultiSourcePages: true,
logReason: "modified" })` before enqueueing.
- [ ] **Step 4:** Run → PASS; `npm run test:mocks`.
- [ ] **Step 5:** Commit `feat(wiki): a changed source is rewritten, not merged`.

### Task 5: Walkers skip `wiki/index/`

**Files:** `src-tauri/src/commands/search.rs` (:147-152), `src-tauri/src/api_server.rs`
(`build_graph` :1091-1096), `src-tauri/src/commands/file_sync.rs` (`should_watch_rel` :1058-1100),
`src/lib/project-file-sync.ts` (`isWikiPageForCascade` :238-246), `src/lib/wiki-graph.ts`
(`flattenMdFiles` :117), `src/lib/graph-relevance.ts:55`, `src/lib/lint.ts` (:80-81, :187-188),
`src/lib/embedding.ts:421`, `src/lib/dedup-runner.ts` (`walkMd` :63), `src/components/…/knowledge-tree.tsx:57`.

**Interfaces — Consumes:** Task 2 `isIndexFilePath`. **Produces:** Rust
`fn is_index_rel(rel: &str) -> bool` in `src-tauri/src/commands/file_sync.rs` (pub(crate)).

- [ ] **Step 1: Tests:** TS `isWikiPageForCascade` false for `wiki/index/entities.md`; lint and graph
      skip `wiki/index/**`; Rust `#[test] fn index_tree_is_not_watched_or_searched` on `is_index_rel`
      and `should_watch_rel` (Review Focus 3).
- [ ] **Step 2:** Run → FAIL (`npx vitest run …`, `cd src-tauri && cargo test is_index`).
- [ ] **Step 3:** Apply the skip everywhere listed.
- [ ] **Step 4:** Run → PASS; `npm run test:mocks`; `cargo test`.
- [ ] **Step 5:** Commit `fix(wiki): index files are not pages for search, graph, lint or the watcher`.

### Task 6: Rebuild endpoint

**Files:** `src-tauri/src/api_server.rs` (routes :256-275, import `Emitter` :12),
`src/App.tsx` (listener next to file sync start ~:339), `src/components/settings/sections/api-server-section.tsx:50`.

**Interfaces — Produces:** `POST /api/v1/projects/:id/index/rebuild` → `{"ok":true,"queued":true}`
after `app.emit("wiki-index://rebuild", { projectId })`; TS `listenIndexRebuild(getProject):
Promise<UnlistenFn>` in `src/lib/wiki-index.ts` calling `rebuildWikiIndex` when `projectId` matches.

- [ ] **Step 1: Tests:** TS listener test (event with matching id rebuilds, other id ignored); Rust
      route test that the path parts match `["projects", id, "index", "rebuild"]` (extract a small
      `fn route_index_rebuild(parts: &[&str]) -> Option<&str>` to test).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; list the endpoint in the settings section.
- [ ] **Step 4:** Run → PASS; `npm run typecheck`; `npm run test:mocks`; `cargo test`.
- [ ] **Step 5:** Commit `feat(api): POST /projects/:id/index/rebuild`. Record the fork HEAD for Task 13.

---

## Part 2 — GenOffice (`D:\genoffice-next`)

### Task 7: Save hooks in Sheets, PDF, Markdown, HTML

**Files:** `apps/sheets/src/main/sheets-main.ts` (save handler :3260, success ~:3451),
`apps/pdf/src/main/pdf-main.ts` (save handler :1138, success ~:1199-1222),
`apps/markdown/src/main/markdown-main.ts` (save :821, success :915),
`apps/html/src/main/html-main.ts` (save :1447, success :1540), `apps/shell/src/main/index.ts`
(register next to :3581-3582). Tests: one per app, `tests/document-saved-hook.test.ts`.

**Interfaces — Produces:** `setSheetsDocumentSavedHook`, `setPdfDocumentSavedHook`,
`setMarkdownDocumentSavedHook`, `setHtmlDocumentSavedHook`, each
`(fn: ((filePath: string) => void) | null) => void`, the docs pattern (`docs-main.ts:4088-4099`):
module hook, try/catch around the call.

- [ ] **Step 1: Tests:** each app — a successful save (manual and automatic) calls the hook once
      with the saved path; a failed save does not; Sheets' quiet save of an unsaved new workbook
      (temp file, `quietUnsavedNew` ~:3405) does not; PDF's redacted copy reports the copy's path.
      Shell wiring test: the four setters are registered with `workWikiDocumentSaved`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; typecheck the four apps
      and shell.
- [ ] **Step 5:** Commit `feat(sheets,pdf,markdown,html): report saves to the work wiki`.

### Task 8: Saved-document mirror

**Files:** Create `packages/work-wiki/src/node/mirror.ts` (+ `tests/mirror.test.ts`); move the
hwp → Markdown formatting from `apps/shell/src/main/add-material.ts:81-89` into
`packages/work-wiki/src/node/hwp-markdown.ts` (`hwpTextAsMarkdown(stem: string, text: string):
string`) and use it in both. Modify `packages/work-wiki/src/node/engine.ts` (`Job.kind` adds
`'mirror'`, `runJob` :196-233, new `EngineOptions.mirror?`, `EngineOptions.onPagesWritten?`,
`documentMoved(oldPath, newPath)`).

**Interfaces — Produces:**

```ts
export interface SavedMirrorOptions {
  root: string // wiki folder
  stateDir: string // <userData>/work-wiki/<wiki id>
  materialIndexPath: string // add-material's material-index.json
  extractText: (path: string) => Promise<string | null>
  enabled: () => boolean // the Settings switch
  now?: () => number
  minIntervalMs?: number // default 3_600_000
  maxBytes?: number // default 100 * 1024 * 1024
  onFirstMirror?: () => void // the one-time notice
}
export type MirrorOutcome =
  | { status: 'written' | 'unchanged' | 'skipped'; mirror?: string }
  | { status: 'deferred'; retryAt: number }
export function createSavedMirror(o: SavedMirrorOptions): {
  mirror(path: string): Promise<MirrorOutcome>
  moved(oldPath: string, newPath: string): Promise<void>
}
```

`saved-index.json` in `stateDir`: `{ "version": 1, "docs": { "<canonical original>": { "mirror":
"<path relative to raw/sources>", "hash": "<sha256>", "writtenAt": <ms> } } }`. New copies go to
`raw/sources/genoffice-saved/`; a name is free only if no file of that name exists anywhere under
`raw/sources` and it is not a key of `<root>/.llm-wiki/ingest-cache.json` `entries`.

- [ ] **Step 1: Tests** (`mirror.test.ts`, temp dirs):
  - `first save writes raw/sources/genoffice-saved/<name> and records it`.
  - `.hwp and .hwpx become <stem>.md with the extracted text`.
  - `a name taken anywhere under raw/sources or in the ingest cache gets " (2)"`.
  - `two originals with the same name, as two people sharing the folder would save, get two copies`
    (Review Focus 2).
  - `an unchanged save writes nothing`.
  - `a second change within an hour is deferred with retryAt = writtenAt + 1h, then written`
    (Review Focus 1).
  - `a file over 100 MB is skipped`; `switched off: skipped`.
  - `a document whose content matches an Add-material copy adopts that copy and updates it in place`.
  - `moved() re-keys the record; the copy keeps its name`.
  - `onFirstMirror fires once`.
  - Engine: `a document job mirrors before learning; a deferred mirror schedules a mirror job at
retryAt`; `onPagesWritten fires after learn writes pages`.
- [ ] **Step 2:** Run `cd packages/work-wiki && npx vitest run tests/mirror.test.ts tests/engine.test.ts` → FAIL.
- [ ] **Step 3:** Implement; in `runJob` for `document` call `mirror.mirror(path)` before
      `registry.compare` (a mirror error is logged, never stops learning); `deferred` → schedule
      `{ kind: 'mirror', dueAt: retryAt }`.
- [ ] **Step 4:** Run → PASS; existing add-material tests still pass.
- [ ] **Step 5:** Commit `feat(work-wiki): copy saved documents into the wiki's sources`.

### Task 9: Widened learning, settings switch, notice, wiring

**Files:** `packages/work-wiki/src/node/engine.ts` (`LEARNED` :37),
`apps/shell/src/main/work-wiki-settings.ts` (+ `mirrorSaved: boolean`, default true),
`apps/shell/src/shared/home-api.ts:138` (`WorkWikiSettings`), `apps/shell/src/main/work-wiki.ts`
(`restart()` :362-384 passes `mirror` and `onPagesWritten`; notice text in `MATERIAL_TEXT` :257 for
zh/en/ko), `apps/shell/src/main/index.ts` (`afterFileMoved` :3272 → `workWikiDocumentMoved`),
`apps/shell/src/renderer/src/WorkWikiSettings.tsx` (switch row after `<LlmWikiRow/>` :111),
`apps/shell/src/renderer/src/strings.ts` (2 keys × 21 locales:
`setWorkWikiMirrorSaved`, `setWorkWikiMirrorSavedDesc`), `apps/shell/src/main/llm-wiki-process.ts`
(`rebuildIndex(): Promise<boolean>` like `search()` :217).

**Interfaces — Consumes:** Task 8 `createSavedMirror`, Task 6 endpoint. **Produces:**
`workWikiDocumentMoved(oldPath: string, newPath: string): void`.

- [ ] **Step 1: Tests:** engine accepts `.xlsx .pdf .md .html .htm` and still rejects `.csv`;
      `normalizeWorkWikiSettings` defaults `mirrorSaved` to true and keeps false; the settings UI shows
      the switch and saves `{ mirrorSaved }`; strings parity; `LlmWikiProcess.rebuildIndex` posts to
      `/projects/<id>/index/rebuild` and is false when not running; the one-time notice is shown once
      (flag `workWiki.mirrorNoticeShown`) as an OS notification.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; `restart()` reads
      `GENOFFICE_WIKI_MIRROR_INTERVAL_MS` (tests and drivers only) into `minIntervalMs`, as it already
      reads `GENOFFICE_WORK_WIKI_DEBOUNCE_MS`. **Step 4:** Run → PASS; shell suite.
- [ ] **Step 5:** Commit `feat(work-wiki): learn from seven formats; switch and notice for saved copies`.

### Task 10: Question-relevant catalog, `wiki_index`, learn catalog

**Files:** `packages/work-wiki/src/node/engine.ts` (`catalog()` :246 → `catalogFor`),
`packages/work-wiki/src/node/search.ts` (`buildCatalog` :111), `packages/work-wiki/src/node/learn.ts`
(:226), `packages/work-wiki/src/node/foreign.ts` (skip `index/`), `packages/work-wiki/src/types.ts`
(`WIKI_CHANNELS.index = 'wiki:index'`, `WorkWikiApi.catalog(query?)`, `WorkWikiApi.index(category?,
group?)`), `packages/work-wiki/src/preload.ts`, `apps/shell/src/main/work-wiki.ts`
(`registerWorkWikiIpc` :404).

**Interfaces — Produces:**

- `WorkWikiEngine.catalogFor(query: string, cap = 3000): Promise<string>` — search hits (both
  engines) first, then the top index's category lines, then recent own pages.
- `WorkWikiEngine.indexFile(category?: string, group?: string): string` — `wiki/index.md` or
  `wiki/index/<category>[/<group>].md`, cut at 6,000 chars with a "narrow by group" hint; when
  missing: `색인이 아직 없습니다. wiki_search로 찾으세요.`
- `relevantCatalog(pages: WikiPage[], query: string, cap: number): string` in `search.ts` (learn
  passes the digest as the query, cap 6,000).

- [ ] **Step 1: Tests:** a page matching the question is listed first even when 50 newer pages
      exist; output ≤ 3,000; `indexFile` reads top/category/group files, caps at 6,000, and reports
      "not available" when the index is missing; foreign reader skips `wiki/index/**`; learn's catalog
      contains the page most relevant to the digest.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(work-wiki): question-relevant catalog and the wiki_index tool`.

### Task 11: Agent context on the latest message only; the skill

**Files:** `packages/agent-core/src/skill.ts` (:24, `composeSkills` :47-71),
`packages/agent-core/src/loop.ts` (:536-541, history map :571-573),
`packages/work-wiki/src/skill.ts` (`buildContext` :85-88, tools :49-82).

**Interfaces — Produces:** `AgentSkill.buildContext?(instruction: string): string | Promise<string>`;
`AgentSkill.stripContext?(text: string): string`; `composeSkills` fans both out; the loop awaits
`buildContext(instruction)` and applies `stripContext` to every earlier user message before a run.
The work-wiki skill: `buildContext(q)` → `api.catalog(q)`; `stripContext` removes
`### 업무 위키 목차\n⟦업무 위키:[0-9a-f]+⟧[\s\S]*?⟦/업무 위키:[0-9a-f]+⟧`; tool `wiki_index
{ category?: string; group?: string }`.

- [ ] **Step 1: Tests:** agent-core — after three turns only the last user message carries the
      catalog; a skill without `stripContext` is untouched; async `buildContext` is awaited. Skill —
      `buildContext` passes the question to `catalog`; `wiki_index` calls `api.index` and returns its
      text.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; agent-core and
      work-wiki suites; docs/slides/hwp suites (they use the skill).
- [ ] **Step 5:** Commit `feat(agent-core,work-wiki): catalog on the latest message only; wiki_index`.

### Task 12: The skill in Sheets, PDF, Markdown, HTML

**Files:** `apps/sheets/src/renderer/App.tsx` (:1282-1297), `apps/markdown/src/renderer/ai/AiPanel.tsx`
(:362-375), `apps/html/src/renderer/ai/AiPanel.tsx` (:650-683), `apps/pdf/src/renderer/ai/AiPanel.tsx`
(:383 → `composeSkills('pdf+wiki', '', [createPdfSkill(deps), createWorkWikiSkill(...)])`),
`apps/pdf/src/preload/index.ts` and `apps/markdown/src/preload/index.ts` (expose `workWiki` via
`createWorkWikiPreloadApi`, as `apps/html/src/preload/index.ts:133`).

- [ ] **Step 1: Tests:** wiring test per app: the panel's skill list includes the work-wiki skill;
      pdf and markdown preloads expose `workWiki`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; the four apps' suites.
- [ ] **Step 5:** Commit `feat(sheets,pdf,markdown,html): the work wiki in every AI panel`.

### Task 13: Pin, whole tree, built-app check

**Files:** `tools/llm-wiki.pin.json` (commit from Task 6), `MODIFICATIONS.md` (one entry),
untracked driver `scripts/drivers/driver.wiki-saved.mjs`.

- [ ] **Step 1:** Bump the pin; `npm run fetch:llm-wiki` with `LLM_WIKI_FORK_DIR`.
- [ ] **Step 2:** GenOffice `npm run typecheck`, `npm run lint`, gates, Prettier, suites for shell,
      work-wiki, agent-core, docs, sheets, slides, pdf, markdown, html, hwp → green apart from known
      failures.
- [ ] **Step 3:** `npm run build:all`; driver on a temp profile and temp wiki (back up/restore the
      LLM Wiki app-state): save one document of each of the seven types → copies in
      `raw/sources/genoffice-saved/`, LLM Wiki pages, GenOffice pages, `wiki/index.md` and
      `wiki/index/*.md` listing every page; re-save a changed Word document after the hour throttle is
      shortened by env → old single-source pages replaced; an AI panel answers using `wiki_index`.
- [ ] **Step 4:** Commit `chore: pin LLM Wiki with the code-built index` (+ MODIFICATIONS).
