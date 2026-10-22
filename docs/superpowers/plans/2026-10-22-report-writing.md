# Report Writing (Word and Hangul) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `write_report` tool in the Word and Hangul AI panels that plans a whole document from the user's attachments and the work wiki's index, shows the title and table of contents at once, and fills the chapters one after another.

**Architecture:** An Electron-free package `@genoffice/report-writer` holds the pipeline (attachment maps, plan, chapter calls with reasoning-aware budgets, parsing the model's chapter text into blocks, progress events) behind injected ports. Each editor supplies the ports: a model port over its `aiStream` IPC, a wiki port over `window.workWiki`, its attachments, and a lander that puts the skeleton and chapters into its document. A shared progress card lives in `@genoffice/ui`.

**Tech Stack:** TypeScript, React, Vitest, ProseMirror (Word editor), rhwp CLI + `@rhwp/editor` (Hangul editor).

**Spec:** `docs/superpowers/specs/2026-10-22-report-writing-design.md`

## Global Constraints

- Budgets: plan JSON 16,384 → 32,768 → 65,536 on a `max_tokens`/empty stop; chapter starts at 32,768; a chapter stop at the limit with under 500 visible chars asks again with twice the budget up to 65,536; a stop with ≥ 500 chars is continued at most 2 times; still cut → the chapter fails. Every call sends `thinking: 'off'`.
- Context caps (chars): whole attachments in the plan when all attachments together < 30,000; attachment parts ≈ 4,000; part preview 300; must-see parts in the plan ≤ 20,000; wiki material in the plan ≤ 12,000; per chapter: attachment ≤ 24,000, one wiki page ≤ 6,000, wiki pages together ≤ 20,000.
- Must-see keywords: 목차, 작성 요령, 작성 지침, 작성 방법, 평가 항목, 평가 기준, 배점, 제출, 요구사항, 과업 내용.
- A wiki page the plan named that does not exist is dropped; no search fallback; a chapter left with no pages is written without the wiki.
- Attachments are mandatory: an attachment that cannot be read stops the run before planning and names the file.
- Writing rules (fixed copy, used verbatim in chapter prompts — see Task 3).
- Proposals (proposal style in use, or an RFP attached and the request is a proposal): blanks like `[회사 실적 기재]` stay in the body; when the attachment fixes the table of contents, no 요약 chapter and no 확인 필요 사항 table.
- Work wiki "## 활용 메모 (원문 아님)" sections are guidance, never cited as the source.
- No verification/review/revision pass.
- UI strings in Korean and English through each app's i18n.
- Every pushed commit follows `CLAUDE.local.md`: version bump, `og-vX.Y.Z` tags and releases in both repositories, company installer built and kept local.

## Rulings made while planning (spec → plan)

- **Tables are a block type, not a style role.** `DOCX_KINDS` and the Hangul role schema have no table kind; a role would not validate. Word tables land through `parseHtmlFragment`; Hangul tables through a new table block in `buildStyledDocument`. Cost if wrong: one schema change later.
- **Hangul landing.** The Hangul panel can reload its own tab (`editor.loadFile(bytes, …)`, as AI edits do). When the open document is blank, every step rebuilds the document from all blocks so far and reloads the tab; otherwise the run shows progress in the card and creates one new document at the end (`createStyledDocument`), because rebuilding would overwrite the user's content. Cost if wrong: non-blank Hangul documents do not fill live.

## Review Focus

1. An attachment with neither headings nor page markers (pasted text, CSV) must still map into parts and reach the chapters — Task 2 test `maps plain text by paragraphs`.
2. The user types above the placeholders while chapters are being written: each chapter must still land in its own placeholder — Task 7 test `finds the placeholder after blocks were inserted above it`.
3. The wiki is off or slow: the run must go on from the attachments alone — Task 5 test `runs without the wiki when the wiki port fails`.
4. The model never returns valid plan JSON: nothing lands, the error is shown — Task 5 test `a plan that never parses lands nothing`.
5. Cancel during chapter 3: chapters 1–2 stay, placeholders 3..N are removed — Task 5 test `cancel keeps landed chapters and removes open placeholders` and Task 7 lander test.

---

### Task 1: Package scaffold, types and the chapter-text parser

**Files:**
- Create: `packages/report-writer/package.json` (name `@genoffice/report-writer`, `type: module`, exports `.` → `./src/index.ts`, scripts `typecheck`/`test` as in `packages/pipelines`), `tsconfig.json`, `vitest.config.ts` (copy `packages/pipelines`)
- Create: `packages/report-writer/src/types.ts`, `src/blocks.ts`, `src/index.ts`
- Modify: root `package.json` `test` and `typecheck` chains (add `@genoffice/report-writer` after `@genoffice/work-wiki`); add the workspace to `apps/docs` and `apps/hwp` dependencies (`"@genoffice/report-writer": "*"`); `npm install`
- Test: `packages/report-writer/tests/blocks.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type ReportBlock =
    | { type: 'chapter' | 'section' | 'subsection' | 'paragraph' | 'bullet' | 'numbered'; text: string }
    | { type: 'table'; rows: string[][] } // rows[0] is the header row
  export interface Attachment { name: string; text: string }
  export interface AttachmentPart { id: string; attachment: string; label: string; text: string }
  export interface Brief { purpose: string; reader: string; messages: string[]; terms: Record<string, string> }
  export interface PlannedChapter { no: number; title: string; point: string; owns: string[]; stances: string[]; sections: string[]; attachmentParts: string[]; wikiPages: string[] }
  /** tocFromAttachment: the attachment (e.g. an RFP) fixes the table of contents */
  export interface ReportPlan { brief: Brief; title: string; tocFromAttachment: boolean; chapters: PlannedChapter[] }
  export type LlmStatus = 'complete' | 'max_tokens' | 'empty' | 'error' | 'stopped'
  export interface LlmReply { status: LlmStatus; text: string; error?: string }
  export interface LlmPort { (req: { system: string; user: string; maxTokens: number; signal?: AbortSignal }): Promise<LlmReply> }
  export interface WikiPort { catalog(q: string): Promise<string>; index(category?: string): Promise<string>; read(id: string): Promise<string | null> }
  export interface Skeleton { title: string; withSummary: boolean; chapters: Array<{ no: number; title: string; sections: string[] }> }
  export interface Lander {
    skeleton(s: Skeleton): Promise<void>
    chapter(no: number, blocks: ReportBlock[]): Promise<void>
    chapterFailed(no: number, title: string): Promise<void>
    summary(blocks: ReportBlock[]): Promise<void>
    gaps(blocks: ReportBlock[]): Promise<void>
    /** remove the placeholders still open (cancel / fatal error) */
    abandon(): Promise<void>
    finish(): Promise<void>
  }
  export type ReportProgress =
    | { kind: 'reading' } | { kind: 'planning' }
    | { kind: 'chapter'; no: number; of: number; title: string }
    | { kind: 'chapter-failed'; no: number; title: string; error: string }
    | { kind: 'summary' }
    | { kind: 'done'; written: number; failed: number[] }
    | { kind: 'cancelled'; written: number }
    | { kind: 'error'; error: string }
  export interface ReportRequest { request: string; kind: 'report' | 'proposal'; styleRules: string; lengthHint?: string; attachments: Attachment[] }
  export interface ReportPorts { llm: LlmPort; wiki: WikiPort | null; lander: Lander; progress(e: ReportProgress): void }
  export type ReportOutcome = { ok: true; written: number; failed: number[]; gaps: number } | { ok: false; error: string; written: number }
  ```
- Produces (`blocks.ts`): `parseChapterAnswer(text: string): { blocks: ReportBlock[]; claims: string[]; gaps: string[] }` and `parseBlocks(markdown: string): ReportBlock[]`.

- [ ] **Step 1: Write the failing tests** (`tests/blocks.test.ts`)

```ts
it('parses headings, paragraphs, lists and a pipe table into blocks', () => {
  const md = '## 2. 규제\n\n첫 문장이 결론이다.\n\n### 2.1 7단계\n\n- 데이터 보호\n- 전략\n\n1. 하나\n2. 둘\n\n#### 세부\n\n| 단계 | 내용 |\n|---|---|\n| 1 | 데이터 |\n'
  expect(parseBlocks(md)).toEqual([
    { type: 'chapter', text: '2. 규제' },
    { type: 'paragraph', text: '첫 문장이 결론이다.' },
    { type: 'section', text: '2.1 7단계' },
    { type: 'bullet', text: '데이터 보호' }, { type: 'bullet', text: '전략' },
    { type: 'numbered', text: '하나' }, { type: 'numbered', text: '둘' },
    { type: 'subsection', text: '세부' },
    { type: 'table', rows: [['단계', '내용'], ['1', '데이터']] },
  ])
})
it('splits the claims and gaps lists off the chapter answer', () => {
  const r = parseChapterAnswer('## 1. 원칙\n\n본문.\n<<주장>>\n- 인간 중심\n- 13세 하한\n<<부족>>\n- 국내 동의 연령\n')
  expect(r.blocks).toEqual([{ type: 'chapter', text: '1. 원칙' }, { type: 'paragraph', text: '본문.' }])
  expect(r.claims).toEqual(['인간 중심', '13세 하한'])
  expect(r.gaps).toEqual(['국내 동의 연령'])
})
it('treats "없음" as no gaps and a missing list as empty', () => {
  expect(parseChapterAnswer('본문\n<<부족>>\n- 없음').gaps).toEqual([])
  expect(parseChapterAnswer('본문').claims).toEqual([])
})
it('joins soft-wrapped paragraph lines and strips emphasis markers', () => {
  expect(parseBlocks('첫 줄\n둘째 줄 **강조**')).toEqual([{ type: 'paragraph', text: '첫 줄 둘째 줄 강조' }])
})
```

- [ ] **Step 2: Run** `npm run test -w @genoffice/report-writer` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts`, `blocks.ts` (line-based: `## `→chapter, `### `→section, `####`+→subsection, `- `/`* `→bullet, `N. `→numbered, consecutive `|` lines→table with the `|---|` separator dropped, other non-empty lines join into one paragraph until a blank line; `**`/`__` removed; block text is one line), `index.ts` re-exports.
- [ ] **Step 4: Run** the tests — Expected: PASS. Also `npm run typecheck -w @genoffice/report-writer`.
- [ ] **Step 5: Commit** `feat(report-writer): package, types and chapter-text parser`

### Task 2: Attachment maps

**Files:** Create `packages/report-writer/src/attachments.ts`; Test `tests/attachments.test.ts`

**Interfaces:**
- Produces: `PART_CHARS = 4000`, `PREVIEW_CHARS = 300`, `WHOLE_ATTACHMENT_CHARS = 30000`, `MUST_SEE_CHARS = 20000`, `MUST_SEE_WORDS: readonly string[]` (the ten keywords).
- `mapAttachment(a: Attachment, index: number): AttachmentPart[]` — ids `A{index+1}-{n}` (1-based n); cut at Markdown headings (`#`..`######`) when present, else at `[page N]` markers grouped to ≈ `PART_CHARS`, else at blank lines grouped to ≈ `PART_CHARS`; `label` = the heading, `p.3–5`, or `part n`.
- `mustSeeParts(parts: AttachmentPart[], cap = MUST_SEE_CHARS): AttachmentPart[]` — the first part of each attachment, then parts whose label or text contain a must-see word, most keyword hits first, total ≤ cap (a part over the remaining cap is cut to fit).
- `describeParts(parts: AttachmentPart[]): string` — one line per part: `id | label | length | first PREVIEW_CHARS chars (one line)`.

- [ ] **Step 1: Failing tests**

```ts
it('cuts a Word-like text at its headings', () => {
  const parts = mapAttachment({ name: 'rfp.docx', text: '# 제안요청서\n개요\n## 1. 과업 내용\n가\n## 2. 평가 항목\n나' }, 0)
  expect(parts.map((p) => [p.id, p.label])).toEqual([['A1-1', '제안요청서'], ['A1-2', '1. 과업 내용'], ['A1-3', '2. 평가 항목']])
})
it('groups PDF pages into parts of about 4,000 chars', () => {
  const page = (n: number) => `[page ${n}]\n${'가'.repeat(1500)}`
  const parts = mapAttachment({ name: 'g.pdf', text: [1, 2, 3, 4, 5].map(page).join('\n') }, 1)
  expect(parts[0]).toMatchObject({ id: 'A2-1', label: 'p.1–2' })
  expect(parts.every((p) => p.text.length <= 4000 + 1600)).toBe(true)
})
it('maps plain text by paragraphs', () => {
  const parts = mapAttachment({ name: 'a.txt', text: Array.from({ length: 12 }, () => '나'.repeat(900)).join('\n\n') }, 0)
  expect(parts.length).toBeGreaterThan(2)
  expect(parts.map((p) => p.text).join('').replace(/\n/g, '').length).toBe(12 * 900)
})
it('puts the first part and the evaluation/TOC parts first within the cap', () => {
  const parts = mapAttachment({ name: 'r.docx', text: `# 표지\n표지\n## 배경\n${'x'.repeat(5000)}\n## 평가 항목 및 배점\n기술 70점` }, 0)
  const seen = mustSeeParts(parts, 2000)
  expect(seen.map((p) => p.label)).toEqual(['표지', '평가 항목 및 배점'])
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(report-writer): attachment maps and must-see parts`

### Task 3: Prompts and the writing rules

**Files:** Create `packages/report-writer/src/prompts.ts`; Test `tests/prompts.test.ts`

**Interfaces:**
- Produces: `WRITING_RULES: string`, `PROPOSAL_RULES: string`, and
  `planPrompt(input: { request: string; kind: 'report' | 'proposal'; styleRules: string; lengthHint?: string; attachmentsWhole?: string; attachmentMap?: string; mustSee?: string; wiki: string }): { system: string; user: string }`,
  `chapterPrompt(input: { plan: ReportPlan; chapter: PlannedChapter; ledger: string[]; attachment: string; wikiPages: Array<{ id: string; text: string }>; kind: 'report' | 'proposal'; styleRules: string }): { system: string; user: string }`,
  `continuePrompt(base: { system: string; user: string }, soFar: string): { system: string; user: string }`,
  `summaryPrompt(plan: ReportPlan, ledger: string[]): { system: string; user: string }`,
  `gapsPrompt(gaps: Array<{ no: number; need: string }>): { system: string; user: string }`.

`WRITING_RULES` (exact copy):

```
작성 원칙:
- 각 절의 첫 문장은 그 절의 결론이다. "본 절에서는 ~을 살펴본다" 같은 문장은 쓰지 않는다.
- 근거는 제공된 첨부와 위키 페이지에서만 가져온다. 근거로 쓴 문장 끝에 (출처: 첨부 이름 또는 페이지 이름)을 단다. 첨부와 위키가 다르면 첨부를 따른다.
- 위키 페이지의 "## 활용 메모 (원문 아님)" 섹션은 참고만 하고 출처로 인용하지 않는다.
- 자료에 없는 사실·수치·기준은 만들지 않는다. 작성자가 새로 제안하는 일은 "(제안)"이라고 밝히고 출처를 달지 않는다.
- 본문에 "[확인 필요]" 같은 빈칸을 쓰지 않는다. 근거가 없어 쓸 수 없는 내용은 본문에서 빼고 응답 끝의 <<부족>> 목록에 적는다.
- 한 문장은 짧게, 한 문단은 세 문장 이하. 비교·단계·항목 나열은 표나 번호 목록으로.
- 일반론, 반복, "결론적으로" 같은 군더더기를 쓰지 않는다.
```

`PROPOSAL_RULES` (exact copy, replaces the blank rule for proposals):

```
제안서 원칙:
- 제안사에 관한 사실(실적, 인력, 금액 등) 중 자료에 없는 것은 본문의 그 자리에 [회사 실적 기재]처럼 대괄호 빈칸으로 남긴다.
- 제안요청서의 목차·작성 요령·평가 항목을 그대로 따르고, 요구사항마다 대응을 쓴다.
```

The chapter answer format the prompt asks for: Markdown with `## N. 제목` first, `###`/`####` for sections, `-`/`1.` lists, pipe tables; then `<<주장>>` (3–5 lines) and `<<부족>>` (lines or "없음"). The plan prompt asks for JSON `{ "brief": …, "title": …, "tocFromAttachment": true|false, "chapters": [ … ] }` with the PlannedChapter fields, states that the outline follows the attachments when present, every topic is owned by exactly one chapter, page ids are copied exactly as listed, and chapter count follows the length hint or the material (typically 4–7).

- [ ] **Step 1: Failing tests**

```ts
it('puts the topic and the whole outline into every chapter prompt', () => {
  const p = chapterPrompt({ plan, chapter: plan.chapters[1], ledger: ['1장: 인간 중심'], attachment: '', wikiPages: [], kind: 'report', styleRules: '' })
  for (const c of plan.chapters) expect(p.user).toContain(c.title)
  expect(p.user).toContain(plan.brief.purpose)
  expect(p.user).toContain('1장: 인간 중심')
  expect(p.system).toContain(WRITING_RULES)
})
it('tells a chapter with no wiki pages that the wiki has nothing for it', () => {
  expect(chapterPrompt({ plan, chapter: plan.chapters[0], ledger: [], attachment: '', wikiPages: [], kind: 'report', styleRules: '' }).user).toMatch(/위키 자료 없음/)
})
it('uses the proposal rules instead of the no-blank rule for proposals', () => {
  const p = chapterPrompt({ plan, chapter: plan.chapters[0], ledger: [], attachment: 'x', wikiPages: [], kind: 'proposal', styleRules: '' })
  expect(p.system).toContain(PROPOSAL_RULES)
  expect(p.system).not.toContain('[확인 필요]')
})
it('gives the plan the must-see parts whole next to the attachment map', () => {
  const p = planPrompt({ request: 'r', kind: 'report', styleRules: '', attachmentMap: 'A1-1 | 표지', mustSee: '평가 항목 전문', wiki: '' })
  expect(p.user).toContain('A1-1 | 표지')
  expect(p.user).toContain('평가 항목 전문')
})
```
(`plan` is a small fixture `ReportPlan` with three chapters defined in the test file.)

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(report-writer): plan, chapter, summary and gaps prompts with the writing rules`

### Task 4: Budgets, plan validation and wiki material

**Files:** Create `packages/report-writer/src/budget.ts`, `src/plan.ts`, `src/wiki.ts`; Tests `tests/budget.test.ts`, `tests/plan.test.ts`, `tests/wiki.test.ts`

**Interfaces:**
- `PLAN_BUDGETS = [16384, 32768, 65536]`, `CHAPTER_BUDGET = 32768`, `MAX_BUDGET = 65536`, `CONTINUATIONS = 2`, `NEAR_EMPTY_CHARS = 500`.
- `askJson<T>(llm: LlmPort, prompt: { system: string; user: string }, parse: (text: string) => T, signal?: AbortSignal): Promise<{ ok: true; value: T } | { ok: false; error: string }>` — tries each plan budget; a reply that is `max_tokens`/`empty` or does not parse moves to the next budget; fenced or bare JSON accepted.
- `askChapter(llm: LlmPort, prompt: { system: string; user: string }, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; error: string; stopped?: boolean }>` — the Global Constraints ladder; continuation uses `continuePrompt` and appends.
- `validatePlan(raw: unknown, known: { pages: Set<string>; parts: Set<string> }): ReportPlan` — throws on a missing title/chapters; renumbers chapters 1..N; drops unknown `wikiPages`/`attachmentParts`; a topic owned by two chapters stays with the first.
- `planWikiMaterial(wiki: WikiPort, request: string, cap = 12000): Promise<{ text: string; pages: Set<string> }>` — catalog, then the top index, then the category lists the catalog names, until the cap; `pages` = every page id that appears as `[[id]]` or `category/id` in that text. Any port error → `{ text: '', pages: new Set() }`.
- `readChapterPages(wiki: WikiPort, ids: string[], perPage = 6000, total = 20000): Promise<Array<{ id: string; text: string }>>` — `read(id)`; for an id without `/` that returns null, try `sources/`, `entities/`, `concepts/` prefixes; missing ids are dropped.

- [ ] **Step 1: Failing tests**

```ts
// budget.test.ts
it('asks the plan again with a larger budget after an empty reasoning-only reply', async () => {
  const seen: number[] = []
  const llm: LlmPort = async (r) => { seen.push(r.maxTokens); return seen.length < 2 ? { status: 'empty', text: '' } : { status: 'complete', text: '{"a":1}' } }
  expect(await askJson(llm, P, JSON.parse)).toEqual({ ok: true, value: { a: 1 } })
  expect(seen).toEqual([16384, 32768])
})
it('a plan that never parses fails after 65,536', async () => {
  const seen: number[] = []
  const r = await askJson(async (q) => (seen.push(q.maxTokens), { status: 'complete', text: 'not json' }), P, JSON.parse)
  expect(r.ok).toBe(false); expect(seen).toEqual([16384, 32768, 65536])
})
it('a chapter cut with almost no text is asked again with twice the budget', async () => {
  const seen: number[] = []
  const llm: LlmPort = async (q) => (seen.push(q.maxTokens), seen.length === 1 ? { status: 'max_tokens', text: '## 1' } : { status: 'complete', text: '## 1. 장\n본문' })
  expect(await askChapter(llm, P)).toEqual({ ok: true, text: '## 1. 장\n본문' }); expect(seen).toEqual([32768, 65536])
})
it('a chapter cut after real text is continued and joined', async () => {
  const long = '가'.repeat(800)
  const replies: LlmReply[] = [{ status: 'max_tokens', text: long }, { status: 'complete', text: '끝' }]
  expect(await askChapter(async () => replies.shift()!, P)).toEqual({ ok: true, text: long + '끝' })
})
it('a chapter still cut after two continuations fails', async () => {
  const r = await askChapter(async () => ({ status: 'max_tokens', text: '가'.repeat(800) }), P)
  expect(r.ok).toBe(false)
})
// plan.test.ts
const ch = (no: number, owns: string[], wikiPages: string[], attachmentParts: string[]) =>
  ({ no, title: `장${no}`, point: 'p', owns, stances: ['s'], sections: ['x'], wikiPages, attachmentParts })
it('drops unknown pages and parts and keeps a topic with its first owner', () => {
  const raw = { brief: { purpose: 'p', reader: 'r', messages: [], terms: {} }, title: 'T', tocFromAttachment: false,
    chapters: [ch(1, ['규제'], ['concepts/a', 'concepts/ghost'], ['A1-1']), ch(2, ['규제', '역량'], [], ['A9-9'])] }
  const plan = validatePlan(raw, { pages: new Set(['concepts/a']), parts: new Set(['A1-1']) })
  expect(plan.chapters[0].wikiPages).toEqual(['concepts/a'])
  expect(plan.chapters[1].attachmentParts).toEqual([])
  expect(plan.chapters[1].owns).toEqual(['역량'])
})
it('defaults tocFromAttachment to false and renumbers chapters', () => {
  const plan = validatePlan({ brief: { purpose: 'p', reader: 'r', messages: [], terms: {} }, title: 'T', chapters: [ch(3, [], [], [])] }, { pages: new Set(), parts: new Set() })
  expect(plan.tocFromAttachment).toBe(false); expect(plan.chapters[0].no).toBe(1)
})
// wiki.test.ts
const wikiOf = (pages: Record<string, string>): WikiPort => ({ catalog: async () => '', index: async () => '', read: async (id) => pages[id] ?? null })
it('reads a bare page id through the category folders and drops missing pages', async () => {
  const got = await readChapterPages(wikiOf({ 'entities/unesco': '유네스코' }), ['unesco', 'ghost'])
  expect(got).toEqual([{ id: 'entities/unesco', text: '유네스코' }])
})
it('caps each page at 6,000 chars and all pages at 20,000', async () => {
  const pages = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`concepts/p${n}`, '가'.repeat(9000)]))
  const got = await readChapterPages(wikiOf(pages), Object.keys(pages))
  expect(got.map((p) => p.text.length)).toEqual([6000, 6000, 6000, 2000])
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(report-writer): reasoning-aware budgets, plan validation, wiki material by the index`

### Task 5: The pipeline `writeReport` and the progress view

**Files:** Create `packages/report-writer/src/run.ts`, `src/progress-view.ts`; Test `tests/run.test.ts`, `tests/progress-view.test.ts`

**Interfaces:**
- Consumes Tasks 1–4.
- Produces: `writeReport(req: ReportRequest, ports: ReportPorts, signal?: AbortSignal): Promise<ReportOutcome>`.
  Order: `progress({kind:'reading'})` → maps (whole text when total < 30,000) → `progress({kind:'planning'})` → `planWikiMaterial` (skipped when `wiki` is null or fails) → `askJson(planPrompt)` + `validatePlan` → `lander.skeleton({ title, withSummary, chapters })` (`withSummary` = `!(req.kind === 'proposal' && plan.tocFromAttachment)`) → per chapter: `progress(chapter)`, attachment text (whole when < 30,000 else its parts capped 24,000), `readChapterPages`, `askChapter(chapterPrompt)`, `parseChapterAnswer`, `lander.chapter(no, blocks)` and ledger += `${no}장: claim`; failure → `lander.chapterFailed` + `progress(chapter-failed)` → when `withSummary`: `progress(summary)`, `askChapter(summaryPrompt)` → `lander.summary`; gaps non-empty and not a TOC-fixed proposal → `askChapter(gapsPrompt)` → `lander.gaps` → `lander.finish()` → `progress(done)`. Abort at any point: `lander.abandon()`, `progress(cancelled)`, `{ ok: false, error: 'cancelled', written }`.
- `deriveReportProgressView(events: ReportProgress[]): { title: string; steps: Array<{ label: string; state: 'done' | 'running' | 'failed' | 'waiting' }>; finished: boolean }` — labels are i18n keys (`report.reading`, `report.planning`, `report.chapter` with `{no, of, title}`, `report.summary`, `report.done`, `report.cancelled`, `report.error`); the view keeps one row per chapter.

- [ ] **Step 1: Failing tests** (fake ports: an `llm` that answers by prompt kind, a recording lander, a recording progress)

```ts
it('lands the skeleton before any chapter and the chapters in order', async () => { expect(lander.calls.map((c) => c[0])).toEqual(['skeleton', 'chapter', 'chapter', 'chapter', 'summary', 'gaps', 'finish']) })
it('a chapter call never contains another chapter\'s pages or the whole wiki', async () => { /* wiki with 50 pages; assert chapter prompts contain only their wikiPages ids and are under 60,000 chars */ })
it('runs without the wiki when the wiki port fails', async () => { /* wiki.catalog throws → still skeleton + chapters, prompts say 위키 자료 없음 */ })
it('a plan that never parses lands nothing', async () => { expect(lander.calls).toEqual([]); expect(outcome).toMatchObject({ ok: false }) })
it('a failed chapter is marked and the run goes on', async () => { /* chapter 2 always empty → chapterFailed(2) then chapter 3 */ })
it('cancel keeps landed chapters and removes open placeholders', async () => { /* abort during chapter 3 → calls end with abandon; outcome.written === 2 */ })
it('a proposal whose attachment fixes the TOC gets no summary and no gaps table', async () => { /* plan tocFromAttachment true, kind proposal → no summary/gaps calls */ })
it('stops before planning when an attachment is empty', async () => { /* attachments [{name:'a.pdf', text:''}] → ok:false error names a.pdf, no llm call */ })
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS (whole package suite).
- [ ] **Step 5: Commit** `feat(report-writer): writeReport pipeline and progress view`

### Task 6: Shared progress card and the model port over aiStream

**Files:**
- Create: `packages/ui/src/ReportProgressCard.tsx` (export from `packages/ui` index); Test `packages/ui/tests/ReportProgressCard.test.tsx`
- Create: `packages/report-writer/src/ipc-llm.ts`; Test `tests/ipc-llm.test.ts`
- Modify: `packages/i18n` (or each app's locale files, whichever slides uses for its deck card) — keys `report.reading`, `report.planning`, `report.chapter`, `report.summary`, `report.done`, `report.cancelled`, `report.error`, `report.failedChapter`, `report.cancel` in ko and en

**Interfaces:**
- `ReportProgressCard(props: { view: ReturnType<typeof deriveReportProgressView>; t: (key: string, vars?: Record<string, unknown>) => string; onCancel?: () => void })`.
- `createIpcLlm(api: { aiStream(req: { requestId: string; settings: unknown; system: string; messages: Array<{ role: 'user'; text: string }>; maxTokens?: number; thinking?: 'off' }): Promise<unknown>; aiStreamCancel(id: string): Promise<unknown>; onAiStream(h: (c: { requestId: string; type: string; text?: string; error?: string; stopReason?: string }) => void): () => void }, getSettings: () => unknown, silenceMs?: number): LlmPort` — collects `delta` text only (not `reasoning`), `done` + `stopReason === 'max_tokens'` → `max_tokens`, `done` with blank text → `empty`, `error` → `error`, abort → `aiStreamCancel` + `stopped`, silence watchdog (`IPC_STREAM_SILENCE_TIMEOUT_MS` from agent-core, re-armed by any chunk incl. `ping`) → `error`. Always sends `thinking: 'off'`.

- [ ] **Step 1: Failing tests** — `ipc-llm`: deltas joined; reasoning chunks ignored; `stopReason:'max_tokens'` → status `max_tokens`; blank done → `empty`; abort calls `aiStreamCancel` and resolves `stopped`; the request carries `maxTokens` and `thinking:'off'`. Card: renders one row per chapter with its state and a cancel button only while running.
- [ ] **Step 2: Run** `npm run test -w @genoffice/report-writer` and `npm run test -w @genoffice/ui` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(report-writer,ui): model port over aiStream and the shared progress card`

### Task 7: Word editor — lander, tool and wiring

**Files:**
- Create: `apps/docs/src/renderer/ai/report/docs-lander.ts`, `apps/docs/src/renderer/ai/report/report-skill.ts`
- Modify: `apps/docs/src/renderer/ai/AiPanel.tsx` (add the skill to `composeSkills('docs+files', …)` at :758-783; render `ReportProgressCard` for a running/finished report on the assistant message, like the slides deck card; give the skill the attachments list the files skill holds and `createIpcLlm(window.docsApi, getSettings)`), `apps/docs/src/renderer/ai/styles-skill.ts` prompt (`styles-skill.ts:24-29`: whole documents from material → `write_report`; `write_styled_document`/`write_document` stay for short pieces and edits)
- Tests: `apps/docs/tests/report-lander.test.ts`, `apps/docs/tests/report-skill.test.ts`

**Interfaces:**
- `createDocsLander(deps: { editor(): Editor; style: DocxStyle; numIds(): NumIds; track?(): AiTrack | undefined; runId: string }): Lander`
  - Block → nodes: `chapter`→role of kind `heading` level 1, `section`→heading 2, `subsection`→heading 3, `paragraph`→kind `body`, `bullet`/`numbered`→kind `list` (bullet/number per the role's bullet setting, else body text prefixed `• `/`n. `), title→kind `title`; built with `styledBlockNodes`. `table`→`parseHtmlFragment('<table>…</table>', numIds)` (header row as `<th>`).
  - Placeholders: one paragraph per open slot whose text is `⟦${runId}:${slot}⟧ 쓰는 중…` (`slot` = `summary`, `c1`…`cN`, `gaps`); located before every replacement by scanning `editor.state.doc` top-level children for the marker; replacement via `replaceBlockRange(editor, i, i, nodes, track)`.
  - Skeleton: blank document → `replaceBlockRange(editor,0,0,…)`; otherwise `insertBlocksAfter(editor, lastIndex, …)`. Content: title, `요약` placeholder (when `withSummary`), heading `목차` + one body line per chapter (`N. 제목`) and section, then one placeholder per chapter, then the `gaps` placeholder.
  - `chapterFailed` replaces the placeholder with `이 장을 쓰지 못했습니다: N. 제목`; `abandon` deletes every placeholder still present; `gaps` with no blocks deletes its placeholder.
- `createReportSkill(deps: { lander(style: DocxStyle, runId: string): Lander; llm: LlmPort; wiki(): WikiPort | null; attachments(): Promise<Attachment[]>; readStyle(id: string): Promise<DocxStyle | null>; progress(e: ReportProgress): void }): AgentSkill` with one tool `write_report { request: string; style?: string; length?: string }`. Style: the given id, else `docx-bid-proposal` when the request is a proposal and an attachment is present, else `docx-report`. `kind` = proposal when the style id contains `proposal`. `styleRules` = the style page's description (first 3,000 chars). The tool result summarises written/failed chapters and the gaps count.
  - `attachments()` reads every attached text file fully through `window.docsApi.readAttachment(path, offset, 24000)` until `totalChars`; a read error → the tool fails before planning naming the file.

- [ ] **Step 1: Failing tests** (`report-lander.test.ts` with the docs editor test harness used by the existing `styles-skill` tests)

```ts
it('lands the title, TOC and one placeholder per chapter into a blank document')
it('replaces chapter 2\'s placeholder with heading, body, list and table nodes in the style\'s roles')
it('finds the placeholder after blocks were inserted above it')
it('appends after the last block in a non-blank document and keeps the existing blocks')
it('abandon removes the placeholders still open and keeps landed chapters')
it('a failed chapter shows its failure line')
```
`report-skill.test.ts`: `write_report` picks `docx-report` by default and `docx-bid-proposal` for a proposal with an attachment; an unreadable attachment fails before any model call.

- [ ] **Step 2: Run** `npm run test -w @genoffice/docs -- report` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `npm run typecheck -w @genoffice/docs`.
- [ ] **Step 5: Commit** `feat(docs): write_report — plan, live skeleton and chapters in the open document`

### Task 8: Hangul editor — tables in the styled builder and bytes without a file

**Files:**
- Modify: `apps/hwp/src/main/styled-document.ts` (`StyledBlock` gains `{ role: 'table'; rows: string[][] }`; such a block scaffolds as an empty paragraph, then after styling an edit chain inserts `insert_table` at that paragraph (`rows`, `cols`) and `set_cell` for every cell, `table` index = count of earlier table blocks; header row cells bold through the existing char-format op if one exists, else plain), `apps/hwp/src/main/hwp-main.ts` (new handler `buildStyledBytes(request: { style: string; blocks: StyledBlock[] }) → { ok: true; data: Uint8Array } | { ok: false; error: string }` — same validation as `createStyledDocument`, no file, no tab), `apps/hwp/src/shared/ipc.ts` (channel `hwp:build-styled-bytes`, `HwpApi.buildStyledBytes`), `apps/hwp/src/preload/index.ts`
- Create: `apps/hwp/resources/doc-styles/report.md` — Hangul narrative report style page (id `report`, title `보고서 (한글)`, roles `title`, `chapter`, `section`, `subsection`, `body`, `bullet`, `numbered`; sizes and spacing modelled on `docx-report` converted to the Hangul schema; `draft: true`; skeleton slots title + body)
- Tests: `apps/hwp/tests/styled-document.test.ts` (existing file or new), `apps/hwp/tests/doc-styles-report.test.ts`

- [ ] **Step 1: Failing tests** — a table block yields, with the fake `run`, one `insert-table --rows 2 --cols 3 --section 0 --para i` step and six `set-cell` steps with the right `--table` index; two table blocks use table indexes 0 and 1; a table with ragged rows is rejected with an error naming the block; `report.md` loads through `packages/doc-styles` and lists the seven roles; `buildStyledBytes` returns bytes and writes no file in `ai-created`.
- [ ] **Step 2: Run** `npm run test -w @genoffice/hwp -- styled` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. Then one real-binary check: build a two-table document with the bundled rhwp (`apps/hwp` real-binary test pattern, skipped when the binary is absent) and assert the result opens (`rhwp export-text` shows the cell texts).
- [ ] **Step 5: Commit** `feat(hwp): tables in styled documents, styled bytes without a file, a narrative report style`

### Task 9: Hangul editor — lander, tool and wiring

**Files:**
- Create: `apps/hwp/src/renderer/ai/report/hwp-lander.ts`, `apps/hwp/src/renderer/ai/report/report-skill.ts`
- Modify: `apps/hwp/src/renderer/ai/assistant-skill.ts` (compose the report skill next to the files and wiki skills), `apps/hwp/src/renderer/ai/AiPanel.tsx` (progress card; attachments; `createIpcLlm(window.hwpApi, …)`), `apps/hwp/src/renderer/ai/hwp-skill.ts` prompt (`hwp-skill.ts:41`: whole documents from material → `write_report`), `apps/hwp/src/renderer/ai/context.ts` (`HwpAiApi` adds `buildStyledBytes`)
- Tests: `apps/hwp/tests/report-lander.test.ts`, `apps/hwp/tests/report-skill.test.ts`

**Interfaces:**
- `createHwpLander(deps: { ctx: HwpAiContext; style: DocStyle; styleId: string; roleMap: HwpRoleMap; live: boolean; fileName: string }): Lander` — keeps the ordered slot list (title, summary, toc, chapters, gaps) as `StyledBlock[]` per slot; placeholder slots hold one body block `N. 제목 — 쓰는 중…`.
  - `live` (the open document was blank at the start): after `skeleton` and after every `chapter`/`summary`/`gaps`/`chapterFailed`, `api().buildStyledBytes({ style: styleId, blocks: all })` then `editor.loadFile(bytes, fileName, { skipUnsavedGuard: true })`, pushing the previous snapshot on `ctx.stack` first so AI undo works; `markAiDirty()`.
  - Not live: nothing reloads; `finish()` calls `api().createStyledDocument({ style: styleId, blocks: all, fileName })` once (staged in drafts of ≤ 200 blocks when longer).
  - `abandon()` drops open placeholder slots (live: rebuild once more).
- `type HwpRoleMap = Record<ReportBlock['type'] | 'title', string>`; `ROLE_MAPS: Record<string, HwpRoleMap>` for `report` (identity), `bid-proposal` and `oda-proposal` (`title`→`cover-title`, `chapter`→`chapter`, `section`→`section`, `subsection`→`item-1` (oda: `subsection`), `paragraph`→`item-1`, `bullet`→`bullet`, `numbered`→`item-2`), `seoul-report` (`title`→`cover-title`, `chapter`→`heading-1`, `section`→`item-1`, `subsection`→`item-2`, `paragraph`→`item-2`, `bullet`→`item-3`, `numbered`→`item-3`); a style without a map is refused by the tool with the list of supported styles.
- `createReportSkill` for Hangul: same tool shape as Task 7; default style `report`, `bid-proposal` for a proposal with an attachment; attachments read through `window.hwpApi.readAttachment(path, offset, 24000)` until done (only files granted to this view).

- [ ] **Step 1: Failing tests** — live lander: skeleton → `buildStyledBytes` called with title, TOC lines and placeholders, then `loadFile`; chapter 2 replaces only its slot; abandon rebuilds without open placeholders; non-live: no `loadFile` until `finish`, which calls `createStyledDocument` once; role maps map every block type; tool default style is `report`.
- [ ] **Step 2: Run** `npm run test -w @genoffice/hwp -- report` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `npm run typecheck -w @genoffice/hwp`.
- [ ] **Step 5: Commit** `feat(hwp): write_report — live skeleton and chapters in a blank document, one new document otherwise`

### Task 10: Whole-suite check, end-to-end run with the company model, release

**Files:**
- Modify: `MODIFICATIONS.md` (new entry under the AI features: whole-document writing from attachments and the work wiki in the Word and Hangul editors), `apps/shell/package.json` + `package-lock.json` (0.5.3)
- Create (untracked, local): `scripts/drivers/driver.write-report.mjs`

- [ ] **Step 1:** `npm run typecheck`, `npm run lint`, and every workspace's tests (the root chain stops at the known Windows-only `electron-utils` failures; run each workspace and compare failures against `og-v0.5.2` — new failures block).
- [ ] **Step 2: End to end.** Build (`npm run dist:win` with the company env from `CLAUDE.local.md`), then with `release/win-unpacked` and a temporary profile whose work wiki is a copy of the 0.5.2 UNESCO test wiki (`scratchpad/unesco-wiki-052`): in the Word editor and in the Hangul editor (blank document), ask "유네스코 지침을 바탕으로 교육청 정책 담당자용 보고서를 써 줘", once without and once with the UNESCO PDF attached. Pass when: the title, TOC and placeholders appear before the first chapter; every chapter lands (none failed); no chapter prompt exceeds the caps (log prompt sizes); the Hangul tables are real tables; the run finishes in under 10 minutes. Back up and restore LLM Wiki's `app-state.json`; stop only the test processes.
- [ ] **Step 3:** Hand the Word result to a fresh blind reviewer with the rubric from the experiment; note the scores in the release notes.
- [ ] **Step 4: Release** per `CLAUDE.local.md`: `chore(release): v0.5.3`, push `main` and `migrate/upstream-2026-10` to `private`, tag `og-v0.5.3`, GitHub release (Korean notes; no installer), installer path reported. (The LLM Wiki fork is unchanged: no fork tag.)
