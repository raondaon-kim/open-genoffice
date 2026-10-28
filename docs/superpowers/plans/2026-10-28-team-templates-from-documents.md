# Team Templates from Team Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Word documents in the team NAS `GenOffice-Documents` into template sets (`form.docx` + `template.md`, catalogued by `index.md`) in `GenOffice-Templates`, and let the Word AI write a new document from a set with a fixed table of contents and content from the attachments and the work wiki.

**Architecture:** A new pure package `@genoffice/team-templates` holds every format rule (docx outline, signatures, form building, style measurement, `template.md` / `index.md` text, source-words gate) and is unit tested without a NAS. The shell main process does NAS I/O and AI drafting (`TeamTemplates` service + IPC), the shell renderer shows sets, loose files and candidates in 팀 템플릿. `@genoffice/report-writer` gains a template mode (`writeFromTemplate`), and the Word editor wires it through a template lookup for the open file and a slot lander. LLM Wiki readiness is checked through a new work-wiki channel before a template fill.

**Tech Stack:** TypeScript, Electron (electron-vite), React, jszip, vitest, existing `@genoffice/doc-styles`, `@genoffice/doc-mask`, `@genoffice/report-writer`, `@genoffice/work-wiki`.

**Spec:** `docs/superpowers/specs/2026-10-28-team-templates-from-documents-design.md`

## Global Constraints

- Word (`.docx`) only in this version; set layout, `index.md` and signatures stay format-neutral (kind folders `Word`, `Hangul`, `PowerPoint`, `Excel` from `teamDocumentType`).
- One folder per set: `<templates>/<kind>/<set folder>/template.md` + `form.docx`; folder name from `teamFolderName(title)`, made unique with ` (2)`, ` (3)`….
- The NAS is written only at 확정 (new set or 다시 만들기) and 삭제; never on save, tab close, quit or in the background. No in-app editing of a confirmed set.
- Every NAS write is staged (`.genoffice-<uuid>.tmp`, then rename) like `TeamLibrary.syncDocument`; listing never creates files.
- Source-words gate: no run of **8 or more characters** (whitespace and numbering ignored) from the source's body paragraphs, cover values and table body cells may appear in `form.docx` or `template.md`.
- doc-mask gate (`maskDocument` must return the same text, i.e. `counts` all zero, and `verifyMasked` ok) on both files before writing.
- `template.md` is the source of truth for the outline; review allows renaming headings and editing guidance only (no add/delete/reorder).
- `template.md` header keys, in order: `용도`, `상태` (`확정 · YYYY-MM-DD · <member name>`), `근거 문서` (`N건`), `근거 서명` (comma-separated 16-hex hashes), `형태 파일` (`form.docx · sha256 <64 hex>`), `필요한 자료`, `참고할 업무 위키`. No source paths or names.
- `index.md` line shape: `- [<title>](<Kind>/<folder>/) — <용도> · 확정 · <first 8 hex of form sha256>`; loose files under `## 정리되지 않은 파일` as `- [<name>](<Kind>/<name>)`.
- Candidate threshold setting `teamTemplateMinDocs`, default **1**.
- Template fill writes per deepest heading level the template uses (Heading3 in the sample); cover placeholders filled first; unfilled ones go to 「확인 필요 사항」.
- LLM Wiki before a fill: wait up to **30 s** while `starting`, one restart when `failed`/`stopped`, then the AI asks the user (그대로 쓰기 / 취소) before writing without it.
- UI strings in `team-library-strings.ts` (en + ko, the file's existing pattern); colors via theme tokens only; shell main changes need a shell rebuild.

## Review Focus

1. A source document whose headings carry no Heading styles (manual bold/large text) — candidate must still appear, marked less certain; templatize must not crash. → test in Task 2.
2. Two members confirming templates at nearly the same time — `index.md` keeps both lines (re-read before write) or the next list repairs it from kind folders. → test in Task 7.
3. A set folder renamed or deleted in Explorer while listed — opening it reports and the list self-repairs; nothing else is deleted. → test in Task 7.
4. Read-only member — list works and repairs only in memory; 확정/삭제 hidden. → test in Task 7.
5. The user saves the filled template copy — it goes to `GenOffice-Documents` as an ordinary document and its candidate shows "이미 템플릿 있음", not a new candidate. → test in Task 2 (signature equality) and Task 7.

---

### Task 1: Package scaffold and docx outline reader

**Files:**
- Create: `packages/team-templates/package.json` (name `@genoffice/team-templates`, deps `jszip`, `@genoffice/doc-styles`, `@genoffice/doc-mask`; scripts `typecheck`, `test` like `packages/doc-mask`), `tsconfig.json`, `vitest.config.ts`
- Create: `packages/team-templates/src/index.ts`, `src/docx-outline.ts`
- Create: `packages/team-templates/tests/fixtures.ts` (builds small docx files in memory with jszip: headings with `Heading1..3` styles, body, list, table, cover, header/footer, comments)
- Test: `packages/team-templates/tests/docx-outline.test.ts`
- Modify: root `package.json` `test` and `typecheck` scripts (add `-w @genoffice/team-templates`), `apps/shell/package.json` and `apps/docs/package.json` dependencies, `package-lock.json` (via `npm install`)

**Interfaces:**
- Produces:
  ```ts
  export interface OutlineHeading { level: number; text: string; styled: boolean; index: number }
  export interface OutlineTable { index: number; header: string[]; rows: number }
  export interface DocxOutline {
    headings: OutlineHeading[]        // in document order
    tables: OutlineTable[]
    body: string[]                    // body paragraphs (not headings, not cover, not tables)
    cover: string[]                   // paragraphs before the first heading
    tableCells: string[]              // table body cells (rows after the header row)
    certain: boolean                  // false when headings were guessed (no heading styles)
  }
  export async function readDocxOutline(bytes: Uint8Array): Promise<DocxOutline>
  ```
  `index` is the body element index (paragraph or table) in `word/document.xml`.

- [ ] **Step 1: Write the failing tests**
  - `reads styled headings`: fixture with `Heading1 "Ⅰ. 제안사 소개"`, `Heading2 "1. 일반현황"`, `Heading3 "1-1. 회사 일반현황"`, two body paragraphs → `headings.map(h=>[h.level,h.text])` equals the three, `certain === true`, `body.length === 2`.
  - `cover is what precedes the first heading`: two paragraphs before the first heading → `cover` equals them.
  - `tables report header and body cells`: 3×3 table → `tables[0].header` = first row, `rows === 3`, `tableCells.length === 6`.
  - `guesses headings without styles`: paragraphs `"Ⅰ. 개요"` (bold, 16pt), `"1. 배경"` (bold, 14pt), body → levels 1 and 2, `certain === false`.
  - `outline level in paragraph properties counts as heading`: `<w:outlineLvl w:val="1"/>` → level 2.
- [ ] **Step 2:** `npm run test -w @genoffice/team-templates` → FAIL (module missing).
- [ ] **Step 3: Implement `readDocxOutline`** with jszip + regex over `w:body` children like the spike (`<w:tbl>…</w:tbl>|<w:p …>…</w:p>`); heading level from `w:pStyle` `HeadingN` / `제목N` or style's `w:outlineLvl` in `styles.xml`, else numbering-pattern guess (`^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.` → 1, `^\d+\.\s` → 2, `^\d+-\d+\.` → 3, `^[가-하]\.` → 4) only when the paragraph is bold or larger than the document's Normal size.
- [ ] **Step 4:** tests PASS; `npm run typecheck -w @genoffice/team-templates` clean.
- [ ] **Step 5: Commit** `feat(team-templates): read a Word document's outline`

### Task 2: Outline signatures and candidate grouping

**Files:**
- Create: `packages/team-templates/src/signature.ts`
- Test: `packages/team-templates/tests/signature.test.ts`

**Interfaces:**
- Consumes: `DocxOutline` (Task 1)
- Produces:
  ```ts
  export function normalizeHeading(text: string): string   // numbering, brackets, digits, punctuation, whitespace removed
  export function outlineSignature(o: DocxOutline): string[] // `${level}:${normalizeHeading(text)}` per heading, then `T:${header joined |}` per table
  export function signatureHash(sig: string[]): string      // sha256 hex, first 16
  export function similarity(a: string[], b: string[]): number // 0..1, 1 - levenshtein(a,b)/max(len)
  export interface CandidateDoc { id: string; signature: string[]; certain: boolean; mtimeMs: number }
  export interface CandidateGroup { signatureHash: string; docs: CandidateDoc[]; certain: boolean }
  export function groupCandidates(docs: CandidateDoc[], opts: { minDocs: number; threshold?: number /* default 0.8 */ }): CandidateGroup[]
  ```

- [ ] **Step 1: Write the failing tests**
  - `project words differ, same form`: headings `"1-2. 인도네시아 보건 현황"` vs `"1-2. 르완다 교육 현황"` under identical others → `similarity ≥ 0.8`, grouped together with `minDocs: 2`.
  - `different forms stay apart`: ODA-like outline vs a 5-heading report → two groups with `minDocs: 1`, none with `minDocs: 2`.
  - `normalizeHeading('Ⅱ-1. 사업이해도 (10점)') === '사업이해도'`.
  - `groups sort newest first and the representative is docs[0]` (highest `mtimeMs`).
  - `a filled copy of a template has the template's signature` (Review Focus 5): outline of form + same headings with body → `signatureHash` equal.
  - `uncertain docs mark the group uncertain` (Review Focus 1).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Similarity on the heading part only (tables add ties); groups are single-link clusters over `similarity ≥ threshold`; group `signatureHash` = hash of the representative's signature.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(team-templates): group documents by outline signature`

### Task 3: Form builder and source-words gate

**Files:**
- Create: `packages/team-templates/src/form.ts`, `src/source-words.ts`
- Test: `packages/team-templates/tests/form.test.ts`, `tests/source-words.test.ts`

**Interfaces:**
- Consumes: `readDocxOutline` (Task 1)
- Produces:
  ```ts
  export interface FormOptions {
    headings?: string[]          // generalized texts, same count/order as outline.headings
    coverLabels?: string[]       // e.g. ['사업명','발주기관','제출일'] per cover paragraph; '' keeps an empty paragraph
    headerFooter?: Record<string, string> // part name (e.g. 'word/header1.xml') → generalized text
  }
  export async function buildFormDocx(source: Uint8Array, opts?: FormOptions): Promise<Uint8Array>
  export async function formHeadingTexts(form: Uint8Array): Promise<string[]>
  export async function setFormHeadings(form: Uint8Array, headings: string[]): Promise<Uint8Array> // throws when count differs
  export function sourceWordsHit(sourceTexts: string[], candidateTexts: string[], minLen?: number /* 8 */): string | null // the offending candidate line
  export function docxTexts(bytes: Uint8Array): Promise<string[]> // every w:t text in document, headers, footers, footnotes
  ```

- [ ] **Step 1: Write the failing tests**
  - `keeps headings, styles, sections, headers`: form's `formHeadingTexts` = source headings; `word/styles.xml`, `w:sectPr`, `header1.xml` bytes unchanged when no `headerFooter` option.
  - `one empty slot paragraph per section in the body style`: between two headings with 3 `ListParagraph` paragraphs → exactly one empty paragraph with `w:pStyle ListParagraph` (style of the first body paragraph).
  - `tables keep the header row and one empty row`: 4-row table → 2 rows, row 2 cells empty, `w:tcPr` kept.
  - `cover values become [label] placeholders`: cover `"발주기관 : KOICA"` with `coverLabels: ['발주기관']` → `"[발주기관]"`.
  - `removes comments, tracked changes, properties text, thumbnail, custom XML, body images`: none of `word/comments.xml`, `<w:ins`, `<w:del`, `docProps/thumbnail.jpeg`, `customXml/`, `<w:drawing` in document.xml remain; `docProps/core.xml` has empty `dc:title`/`dc:creator`.
  - `setFormHeadings` replaces texts in order and throws `heading count differs` on mismatch.
  - `sourceWordsHit`: source `"인도네시아 보건인력 관리체계"`, candidate containing `"보건인력 관리체계 개선"` → returns that line; candidate `"1-1. 회사 일반현황"` with source body not containing it → `null`; 7-char overlap → `null`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** on the XML strings (jszip), reusing the spike's `setParagraph` approach for text; table body rows: keep row 1 (header) and a copy of row 2 with every `w:t` emptied. Gate normalizes by removing whitespace and leading numbering before the substring test.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(team-templates): build an emptied form and check it for source words`

### Task 4: Style measurement

**Files:**
- Create: `packages/team-templates/src/measure.ts`
- Test: `packages/team-templates/tests/measure.test.ts`

**Interfaces:**
- Produces: `export async function measureDocxStyle(bytes: Uint8Array, meta: { id: string; title: string; documents: number }): Promise<DocxStyle>` — result passes `validateDocx` from `@genoffice/doc-styles`.

- [ ] **Step 1: Write the failing tests**
  - Fixture with `styles.xml`: Heading1 32 half-points bold, Normal 26 half-points, spacing line 384 (auto), ListParagraph ind left 680 twips; sectPr A4 with margins 1417/1417/1134/850 twips → roles `heading-1` size 16 bold, `body` size 13 lineSpacing 1.6, `bullet` kind `list` indentLeft 34; page marginMm ≈ {left 25, right 25, top 20, bottom 15} (±0.5); `validateDocx(result)` does not throw; `skeleton` = `[{slot:'body', roles:[…all role ids], required:true, repeat:true}]`.
  - Missing heading styles → heading roles derived from Normal (+2pt per level, bold), still valid.
- [ ] **Step 2:** FAIL. **Step 3:** implement (styles.xml `w:style` by `w:styleId` with `w:basedOn` resolution, `w:docDefaults`; twips→pt /20, half-points→pt /2, `w:spacing w:line` /240 for auto). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(team-templates): measure a Word document's roles and page setup`

### Task 5: template.md and the AI draft

**Files:**
- Create: `packages/team-templates/src/template-md.ts`, `src/draft.ts`
- Test: `packages/team-templates/tests/template-md.test.ts`, `tests/draft.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TemplateOutlineEntry { level: number; heading: string; guidance: string }
  export interface TemplateDef {
    title: string; kind: 'Word'; purpose: string
    confirmedAt: string; author: string          // 상태 line
    documents: number; signatures: string[]
    formSha256: string
    materials: string[]; wikiPages: string[]
    outline: TemplateOutlineEntry[]
    notes: string                                // free prose after the header
    style: DocxStyle
  }
  export function renderTemplateMd(def: TemplateDef): string
  export function parseTemplateMd(text: string): { ok: true; def: TemplateDef } | { ok: false; error: string }
  export function draftPrompt(input: { outlines: DocxOutline[]; wikiCatalog: string }): { system: string; user: string }
  export interface TemplateDraft { title: string; purpose: string; materials: string[]; wikiPages: string[]; headings: string[]; guidance: string[]; coverLabels: string[]; headerFooter: Record<string, string> }
  export function parseDraft(json: unknown, outline: DocxOutline, knownWikiPages: Set<string>): TemplateDraft
  ```
- [ ] **Step 1: Write the failing tests**
  - Round trip: `parseTemplateMd(renderTemplateMd(def)).def` deep-equals `def` (with a real `DocxStyle` from Task 4).
  - Rendered header lines exactly: `- 상태: 확정 · 2026-10-28 · 공용`, `- 근거 문서: 3건`, `- 형태 파일: form.docx · sha256 <hex>`; outline rendered as nested `- ` list with two spaces per level and ` — guidance`.
  - `parseTemplateMd` errors name the problem: missing `## 목차`, missing style block, bad hash.
  - `parseDraft` fills a missing heading/guidance from the outline (the spike's skipped block), drops unknown wiki pages, trims `headings` to outline length, and keeps original heading when the model returned an empty string.
  - `draftPrompt` user text contains every outline's headings and the instruction not to copy names, numbers or sentences; contains no body paragraph text of the outlines.
- [ ] **Step 2:** FAIL. **Step 3:** implement; style block via the doc-styles ```` ```json style ```` fence (`BLOCK` regex semantics) and `parseAnyStylePage` for validation. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(team-templates): template.md text and the AI draft`

### Task 6: index.md

**Files:**
- Create: `packages/team-templates/src/index-md.ts`
- Test: `packages/team-templates/tests/index-md.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface IndexSet { title: string; path: string /* 'Word/KOICA-ODA-기술제안서/' */; kind: string; purpose: string; hash8: string }
  export interface IndexLoose { name: string; path: string }
  export interface TemplateIndex { updatedAt: string; author: string; sets: IndexSet[]; loose: IndexLoose[] }
  export function renderIndexMd(index: TemplateIndex): string
  export function parseIndexMd(text: string): TemplateIndex | null   // null when unparsable
  export function upsertSet(index: TemplateIndex, set: IndexSet): TemplateIndex
  export function removeSet(index: TemplateIndex, path: string): TemplateIndex
  ```
- [ ] **Step 1: Tests:** round trip; header `갱신: <date time> · <author> · 템플릿 N개`; sets grouped under `## <Kind>` in kind order Word, Hangul, PowerPoint, Excel; a hand-added prose line is ignored, a broken set line makes `parseIndexMd` skip only that line; `upsertSet` replaces by path; garbage text → `null`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(team-templates): the index.md catalog`

### Task 7: Shell main — TeamTemplates service

**Files:**
- Create: `apps/shell/src/main/team-templates.ts`
- Test: `apps/shell/tests/team-templates.test.ts` (real temp folders standing in for the NAS, fake `complete`)
- Modify: `apps/shell/src/shared/team-library-api.ts` (types below)

**Interfaces:**
- Consumes: Tasks 1–6; `TeamLibrary.root(kind)`, `teamFolderName`, `teamDocumentType`, `maskDocument` from existing modules.
- Produces (shared types in `team-library-api.ts`):
  ```ts
  export interface TeamTemplateSet { path: string; title: string; kind: string; purpose: string; status: 'ok' | 'stale-md' | 'broken'; hash8: string }
  export interface TeamTemplateCandidate { key: string; docs: Array<{ id: string; name: string; mtimeMs: number }>; certain: boolean; coveredBy?: string }
  export interface TeamTemplateList { sets: TeamTemplateSet[]; loose: TeamLibraryEntry[]; writable: boolean; repaired: boolean }
  export interface TeamTemplateDraftView { draftId: string; markdown: string; formHeadings: string[]; headerFooter: Record<string, string>; coverLabels: string[]; sourceKind: 'candidate' | 'loose'; replaces?: string; replacesMdHash?: string }
  ```
  Service:
  ```ts
  export class TeamTemplates {
    constructor(deps: { library: TeamLibrary; memberName(): string; complete(system: string, user: string): Promise<string>; wikiCatalog(): Promise<string>; cacheDir: string; draftsDir: string; minDocs(): number; now?(): Date })
    list(): Promise<TeamTemplateList>                 // index.md + one readdir per kind folder; in-memory repair when read-only
    candidates(): Promise<TeamTemplateCandidate[]>   // scans GenOffice-Documents Word files; signature cache in cacheDir keyed by id+size+mtime
    draft(source: { candidateKey: string; docId?: string } | { loose: string }, replaces?: string): Promise<TeamTemplateDraftView>
    confirm(draftId: string, markdown: string): Promise<TeamTemplateSet>
    remove(setPath: string): Promise<void>
    openSet(setPath: string): Promise<{ workingCopy: string; templateMd: string }>
    rebuildIndex(): Promise<TeamTemplateList>
  }
  ```
- [ ] **Step 1: Write the failing tests**
  - `confirm writes a set and an index line`: draft from a fixture document in `<docs>/P/M/Word/a.docx`, confirm → `<tpl>/Word/<title>/template.md` + `form.docx` exist, `index.md` has the line, no `.tmp` left.
  - `listing reads index plus kind folders only`: spy on `readFile` → reads only `index.md`; a set folder copied in by hand appears (`repaired: true`).
  - `concurrent confirm keeps both` (Review Focus 2): two services confirm different sets back to back with an index write interleaved → both lines present after `list()`.
  - `renamed set folder repairs` (Review Focus 3): rename folder → `list()` shows the new path, old line gone, `template.md` untouched.
  - `read-only member` (Review Focus 4): templates root made read-only (chmod / fake `writable` probe) → `list().writable === false`, `index.md` unchanged on disk.
  - `source-words gate blocks`: markdown edited to contain a body sentence → `confirm` rejects with `TeamLibraryError('source-words')` and nothing is written.
  - `remake refuses when the set changed meanwhile`: replace `template.md` on disk after `draft(…, replaces)` → `confirm` rejects `TeamLibraryError('changed')`.
  - `remove deletes folder and index line`.
  - `openSet creates a local copy and returns the md`; `stale-md` when `form.docx` hash differs from md.
  - `candidates skip covered and pdf/hwp`; a filled copy of an existing set shows `coveredBy` (Review Focus 5).
- [ ] **Step 2:** FAIL. **Step 3: Implement.** New `TeamErrorCode`s: `'source-words' | 'changed' | 'draft-failed'`. Writable probe: create and remove `<tpl>/.genoffice-probe-<uuid>.tmp` only during `confirm`/`remove`; `list()` uses `fs.access(root, W_OK)` (no file creation). Drafts are kept in memory by `draftId` (source bytes, built form, outline) for 1 hour. AI draft: `complete(draftPrompt…)` → `JSON.parse` of the outermost `{…}` → `parseDraft`; failure → `draft-failed`. Confirm: parse md → `setFormHeadings` from md outline → gates (`sourceWordsHit` over `docxTexts(form)` + md lines vs source outline `body`/`cover`/`tableCells`; `maskDocument` counts zero) → set `형태 파일` hash → staged writes → index re-read/upsert/staged write.
- [ ] **Step 4:** PASS; `npm run test -w @genoffice/shell -- team-templates` and typecheck clean.
- [ ] **Step 5: Commit** `feat(shell): team template sets on the NAS`

### Task 8: Shell IPC, preload and the 팀 템플릿 UI

**Files:**
- Modify: `apps/shell/src/shared/team-library-api.ts` (channels `templateList`, `templateCandidates`, `templateDraft`, `templateConfirm`, `templateRemove`, `templateOpen`, `templateRebuild`; API methods of the same names returning `TeamResult<…>`)
- Modify: `apps/shell/src/main/team-library-ipc.ts` (handlers, `homeWindow` guard), `apps/shell/src/main/index.ts` (construct `TeamTemplates`: `complete = createWikiComplete(aiSettingsPath)`, `wikiCatalog` = the main-side catalog used by `WIKI_CHANNELS.catalog`, `cacheDir = userData/team-templates`, `minDocs` from app setting `teamTemplateMinDocs` default 1; `openSet` → `openDocumentPath` and register the copy in the template association store of Task 10)
- Modify: `apps/shell/src/preload/index.ts`
- Modify: `apps/shell/src/renderer/src/TeamLibrary.tsx` (templates kind: three sections 템플릿 / 정리되지 않은 파일 / 후보; review dialog with the md in a `<textarea>` and the form headings list; 삭제 with confirm; 다시 만들기 picks a candidate), `team-library.css` (tokens only), `team-library-strings.ts` (en + ko)
- Test: `apps/shell/tests/team-library-ui.test.ts` (render with a fake `window.aiOfficeTeam`)

- [ ] **Step 1: Failing UI tests:** sets from `templateList` render with status badges (`md 갱신 필요`, `깨진 템플릿`); candidates render "비슷한 문서 N건" and "이미 템플릿 있음"; 확정 calls `templateConfirm(draftId, editedMarkdown)`; when `writable === false` no 템플릿 만들기 / 삭제 buttons; a `source-words` error shows its message.
- [ ] **Step 2:** FAIL. **Step 3:** implement. Korean strings (exact): `templateSets: '템플릿'`, `looseFiles: '정리되지 않은 파일'`, `candidates: '후보'`, `similarDocs: '비슷한 문서 {n}건'`, `covered: '이미 템플릿 있음'`, `makeTemplate: '템플릿 만들기'`, `remake: '다른 문서로 다시 만들기'`, `remove: '삭제'`, `removeConfirm: '이 템플릿을 삭제할까요? NAS 휴지통에 남습니다.'`, `confirm: '확정'`, `staleMd: 'md 갱신 필요'`, `broken: '깨진 템플릿'`, `rebuild: '목록 다시 만들기'`, `drafting: 'AI가 템플릿 정의를 쓰는 중…'`, `writingNas: 'NAS에 쓰는 중…'`, `uncertain: '제목을 추정함'`; errors `source-words: '원본 문서의 문장이 남아 있어 확정할 수 없습니다: '`, `changed: '다른 사람이 먼저 이 템플릿을 바꿨습니다. 목록을 새로 고친 뒤 다시 시도하세요.'`, `draft-failed: 'AI가 템플릿 정의를 만들지 못했습니다. 다시 시도하세요.'` (+ English equivalents).
- [ ] **Step 4:** PASS; `npm run check:theme-colors`, lint, shell typecheck clean.
- [ ] **Step 5: Commit** `feat(shell): make, list and delete team templates in Home`

### Task 9: LLM Wiki readiness

**Files:**
- Modify: `packages/work-wiki/src/types.ts` (`WIKI_CHANNELS.ensureReady = 'wiki:ensure-ready'`; `WorkWikiApi.ensureReady(): Promise<WikiReadiness>`; `export type WikiReadiness = { ok: true } | { ok: false; off: boolean; reason: string }`), `src/preload.ts`
- Modify: `apps/shell/src/main/work-wiki.ts` (`export async function ensureLlmWikiReady(opts?: { waitMs?: number /* 30000 */; pollMs?: number }): Promise<WikiReadiness>` + handler)
- Test: `apps/shell/tests/llm-wiki-ready.test.ts` (inject a fake status source/restart via an exported pure helper `waitForWiki(status: () => LlmWikiStatus, restart: () => Promise<void>, opts)`)

- [ ] **Step 1: Failing tests:** `starting → running within wait` → `{ok:true}`; `failed → one restart → running` → ok and restart called once; `failed twice` → `{ok:false, off:false, reason}`; wiki disabled → `{ok:false, off:true}` without restart; never exceeds `waitMs`.
- [ ] **Step 2–4:** FAIL → implement (`restart` = existing `startLlmWiki`) → PASS.
- [ ] **Step 5: Commit** `feat(work-wiki): wait for LLM Wiki before a template fill`

### Task 10: report-writer template mode

**Files:**
- Create: `packages/report-writer/src/template-run.ts`, `src/template-prompts.ts`
- Modify: `packages/report-writer/src/types.ts`, `src/skill.ts`, `src/index.ts`
- Test: `packages/report-writer/tests/template-run.test.ts`, `tests/template-skill.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TemplateSection { index: number; path: string[]; heading: string; level: number; guidance: string }
  export interface TemplateForRun { title: string; purpose: string; sections: TemplateSection[] /* leaves at the deepest level used, in order */; coverLabels: string[]; wikiPages: string[]; styleRules: string }
  export interface TemplateLander {
    cover(values: Record<string, string>): Promise<void>
    section(index: number, blocks: ReportBlock[]): Promise<void>
    sectionFailed(index: number, heading: string): Promise<void>
    gaps(blocks: ReportBlock[]): Promise<void>
    finish(): Promise<void>
  }
  export async function writeFromTemplate(req: { request: string; template: TemplateForRun; attachments: Attachment[] }, ports: { llm: LlmPort; wiki: WikiPort | null; lander: TemplateLander; progress(e: ReportProgress): void }, signal?: AbortSignal): Promise<ReportOutcome>
  ```
  `ReportSkillDeps` gains optional `template?(): Promise<TemplateForRun | null>`, `templateLander?(t: TemplateForRun, runId: string): TemplateLander`, `wikiReady?(): Promise<WikiReadiness>`; tool input gains `withoutWiki?: boolean`.
- [ ] **Step 1: Failing tests**
  - `sections are written in template order and never added or dropped`: fake llm; lander receives `section(i)` for every `i` in order; outcome `written === sections.length`.
  - `plan assigns material but cannot change the outline`: llm plan JSON with an extra section → ignored.
  - `cover values from the request and attachments; missing go to gaps`.
  - `per-section prompt carries guidance and the template's wiki pages first`.
  - `failed section is marked and the run continues`.
  - skill: with a template present and `wikiReady` → `{ok:false, off:false}` and no `withoutWiki` → tool returns an error output instructing the assistant to ask 「업무 위키를 사용할 수 없습니다 (<reason>). 첨부 자료만으로 쓸까요?」 and nothing is written; with `withoutWiki: true` → runs with `wiki: null`.
  - skill: no template → existing `writeReport` path unchanged (existing tests stay green).
- [ ] **Step 2:** FAIL. **Step 3:** implement reusing `askJson`, `askChapter`, `parseChapterAnswer`, `fence`/rules from `prompts.ts` (`rulesFor('proposal')` when the template title or request matches the existing `PROPOSAL` regex). Section prompt: path, heading, guidance, outline of all headings, ledger, attachment, wiki pages; answer format without the `##` heading line (the form already has it).
- [ ] **Step 4:** PASS; `npm run test -w @genoffice/report-writer`.
- [ ] **Step 5: Commit** `feat(report-writer): write a document into a template's fixed outline`

### Task 11: Word editor wiring

**Files:**
- Create: `apps/docs/src/renderer/ai/report/template-lander.ts`
- Modify: `apps/docs/src/main/docs-main.ts` (`export function setDocsTemplateLookup(fn: ((filePath: string) => string | null) | null): void` + `ipcMain.handle('docs:template-for', (_e, path) => …)` returning the template.md text or null), `apps/docs/src/preload/index.ts` (`templateFor(filePath: string): Promise<string | null>`), `apps/docs/src/shared/ipc.ts` (DesktopApi type), `apps/docs/src/renderer/ai/AiPanel.tsx` (pass `template`, `templateLander`, `wikiReady: () => window.workWiki?.ensureReady?.()`), `apps/docs/src/renderer/ai/report/report-skill.ts`
- Modify: `apps/shell/src/main/index.ts` (template association store: `userData/team-template-copies.json`, `{ [workingCopyPath]: { set: string; md: string } }`, written by `openSet`; `setDocsTemplateLookup(path => store[path]?.md ?? null)`)
- Test: `apps/docs/tests/template-lander.test.ts`, `apps/docs/tests/template-wiring.test.ts`

**Interfaces:**
- Consumes: `parseTemplateMd` (Task 5), `TemplateForRun`/`TemplateLander` (Task 10).
- Produces: `export function templateForRun(def: TemplateDef): TemplateForRun` in `packages/team-templates/src/run-view.ts` (leaves = entries at the deepest level; ancestors in `path`; `styleRules` from the md prose); `export function createTemplateLander(deps: DocsLanderDeps & { template: TemplateForRun }): TemplateLander`.
- [ ] **Step 1: Failing tests**
  - lander on a TipTap editor loaded with a form-like doc (headings + empty slot paragraphs): `section(i, blocks)` inserts after the i-th leaf heading and removes that slot paragraph; content uses the template's roles; other headings untouched; cover placeholders replaced by `cover({사업명:'…'})`; `finish()` removes leftover empty slots.
  - wiring: `AiPanel` source passes `templateFor(filePath)` result through `parseTemplateMd` → `templateForRun`; report skill `buildContext` mentions the template title when present.
  - read-only catalog tool (spec: "The Word AI can read `index.md`"): `list_team_templates` returns the `index.md` text via `window.desktop.teamTemplateIndex()` (docs main hook `setDocsTemplateCatalog(fn: (() => Promise<string | null>) | null)`, shell sets it to `TeamTemplates.list()` rendered as index text); the tool never opens or writes anything and tells the assistant to suggest the user open the template from Home.
- [ ] **Step 2:** FAIL. **Step 3:** implement (find leaf heading by counting heading nodes in order; insert with `insertBlocksAfter`, styles from `styledBlockNodes(template style)`). **Step 4:** PASS; docs tests/typecheck.
- [ ] **Step 5: Commit** `feat(docs): fill a team template from the Word AI panel`

### Task 12: Whole-suite verification, live NAS check, docs

**Files:**
- Modify: `MODIFICATIONS.md` (team templates from team documents; LLM Wiki readiness), `docs/superpowers/specs/2026-10-28-nas-template-collection-design.md` untouched.

- [ ] **Step 1:** `npm run typecheck`, `npm run lint`, `npm run check:theme-colors`, `npm run test -w @genoffice/team-templates -w @genoffice/report-writer -w @genoffice/work-wiki -w @genoffice/shell -w @genoffice/docs` → all pass (shell's 14 pre-existing Windows-path failures excepted, unchanged count).
- [ ] **Step 2: Build** `npm run build:all`.
- [ ] **Step 3: Live NAS (10–20 sets)** with a test copy of the built app pointed at a test subfolder pair on `\\192.168.50.60` (never the team's real folders' existing files): create sets from documents, list time from `index.md`, Explorer rename/move/delete, two confirms in a row, delete `index.md` and list → rebuilt; clean up the test folders afterwards (and their NAS recycle-bin copies).
- [ ] **Step 4: Real document:** templatize `GenOffice_ODA제안서_샘플_KOICA_인도네시아보건.docx`, then in Word: "KOICA 「르완다 중등 교사 디지털 역량 강화 사업」 PMC 기술제안서를 써 줘" with `검증용_누리에듀랩_회사소개서.docx` attached → chapters equal the template outline, no 인도네시아/보건 project text, formatting from the form.
- [ ] **Step 5:** Restart check: quit, relaunch, fill immediately → "업무 위키 준비 중…" then writes.
- [ ] **Step 6: Commit** `docs: team templates from team documents`
