# Writing a whole report from attachments and the work wiki (Word and Hangul editors)

## Intent

Users ask the AI panel for whole documents built from material: "유네스코 지침을 바탕으로 교육청용
보고서를 써 줘", a proposal from an RFP, a plan from last year's report. Today the Word editor
writes the whole thing in one streamed answer (`write_document`) or in role-styled batches the
model sequences itself (`write_styled_document`); the Hangul editor appends role-styled blocks to
a hidden draft that becomes a new file only at the end (`create_styled_document`). Nothing fixes
the outline before writing, nothing keeps chapters consistent with each other, and the model's
context is whatever it chose to read.

We tested ways of writing one report with the company model (`deepseek-flash` behind LiteLLM)
from a wiki built from UNESCO's 2023 *Guidance for generative AI in education and research*
(44 pages), and had each result judged blind by a fresh reviewer:

- **Writing rules mattered most.** Every section opens with its point; facts come only from the
  given material with the page named; the author's own proposals are marked "(제안)" and carry no
  source; no blanks in the body, anything missing is collected in one "확인 필요 사항" table at
  the end. Without these rules the one-call report credited its own invented roadmap to UNESCO.
- **A fixed outline with stances keeps chapters consistent.** When chapters were written
  separately without fixed stances, they contradicted each other and deferred topics to each
  other.
- **Hidden reasoning eats the output budget.** `deepseek-flash` always reasons before answering
  (thinking cannot be switched off: `thinking: disabled`, `reasoning_effort` and the LLM Wiki
  `reasoning: off` all had no effect), and that reasoning counts against `max_tokens`. Budgets
  of 4K–8K came back cut or empty; the model's real output cap is 393,216 tokens.
- Verification passes (per-chapter fact check, review, revision) improved faithfulness but took
  the run from ~1 minute to ~20 minutes.

The user decided the shape of the feature from these results:

- Title and table of contents go into the document first, and the chapters are filled one after
  another while the user watches, without stopping for approval (like Claude Docs). Every
  chapter call carries the topic and the whole outline.
- No verification pass for now: speed matters.
- The wiki is not poured into the context. The plan reads the wiki's **index** and picks the
  pages each chapter uses; a chapter gets only its pages. A page the plan picked that does not
  exist means that chapter is written **without** the wiki (no fallback search).
- Files the user attached are **mandatory, first-priority material**: they are always read, the
  outline follows them, and where they disagree with the wiki the attachment wins. Attachments
  vary in kind and size from request to request.
- Both the Word editor (`apps/docs`) and the Hangul editor (`apps/hwp`) get it.

## Goals

1. A user request for a whole document from material starts one pipeline, `write_report`,
   available in the Word and Hangul AI panels.
2. The document shows the title, the table of contents and one "쓰는 중" placeholder per chapter
   within the first planning call, then each chapter replaces its placeholder in order.
3. The outline follows the attachments when there are any (an RFP's chapters, writing rules and
   evaluation items), and fixes for every chapter: its point (one sentence), the topics it owns,
   its stances, its sections, the attachment parts and wiki pages it uses.
4. Every model call's input stays bounded no matter how large the wiki or the attachment is:
   the plan sees the wiki index and an attachment map, a chapter sees only its assigned material.
5. The writing rules above hold in every chapter; a summary chapter written last sits at the
   top; a "확인 필요 사항" table collects what the material could not support (proposals differ:
   see "Styles, proposals and tables").
6. No chapter lands cut: a chapter that stops at the token limit is asked again or continued.
7. The user sees progress (planning, chapter n of N, summary) and can cancel; chapters already
   written stay.

## Non-goals

- Verification, review and revision passes (fact check per chapter against its pages). The
  pipeline should leave room to add one later (a chapter's text and its material are kept
  together until the run ends) but does not run it.
- Web search or any material outside the attachments and the work wiki.
- Rewriting an existing document section by section; editing after the run is the panel's normal
  tools.
- Slides, Sheets, PDF, Markdown, HTML editors.

## Anti-goals (a run that does these has failed even if a document appears)

- Putting the whole wiki, or a large attachment whole, into a chapter call.
- Citing a page's "## 활용 메모 (원문 아님)" section as what the source says.
- Presenting the author's proposals, schedules or criteria as coming from the attachment or wiki.
- Landing a chapter that was cut at the token limit, or a run that silently skips a chapter.
- Blocking the panel without progress or a way to cancel.

## Constraints

- Model calls go through the existing renderer path (`streamText` in `packages/agent-core`, which
  reports `complete` / `partial` with reason `max_tokens` / `empty`; `AiStreamRequest` takes
  `maxTokens` and `thinking: 'off'`). Keep `thinking: 'off'` (it helps other providers) but do not
  rely on it for `deepseek-flash`.
- Budgets (reasoning-aware): plan (JSON) starts at 16,384 and on a `max_tokens` stop is asked again
  at 32,768 then 65,536; a chapter starts at 32,768. A chapter that stops at the limit with almost
  no visible text (under ~500 chars) is asked again with twice the budget (up to 65,536); one that
  stops with substantial text is continued ("continue right after the last sentence, do not
  repeat"), at most two continuations. Still cut after that: the chapter fails (see errors).
- Wiki access is the existing renderer API `window.workWiki` (`catalog`, `index`, `search`,
  `read`, `status`) from `packages/work-wiki`. The two-level index (`wiki/index.md` ≤ 4,000 chars,
  `wiki/index/<category>.md`, groups and parts when large) is what the plan reads.
- Attachments are read with the existing `@genoffice/file-parse` path the panels already use
  (`files:read` in docs, `attachments.ts` in hwp: pages of 24,000 chars, 50 MB per file). Word,
  PowerPoint and Excel text keeps headings (`#`, `## Slide N`, `# Sheet`); PDF and Hangul text
  comes as plain text with page markers and no headings.
- Style pages (`apps/hwp/resources/doc-styles`, loaded by `packages/doc-styles`) define the roles a
  document may use: `docx-*` pages for the Word editor (e.g. `docx-report`: title, heading-1..3,
  body, list), `hwp` pages for the Hangul editor (e.g. bid-proposal: cover-title, toc-title,
  toc-line, chapter, section, item-1, item-2, bullet, note).
- Work wiki pages from sources end with "## 활용 메모 (원문 아님)" (0.5.2): usable as guidance,
  never as a source.

## How it works

### 1. Start

The panel's agent calls `write_report` when the user asks for a whole document built from
material (report, proposal, plan, white paper). Arguments: the request in the user's words, the
style page to use if the user named one, and a length hint if the user gave one. The panel
prompt tells the agent to use `write_report` instead of `write_document` /
`write_styled_document` / `create_styled_document` for such requests, and to keep using those
tools for short pieces and edits.

### 2. Material

- **Attachments** (every file attached in this conversation, all of them, in attachment order):
  read in full by code before planning (not left to the model). Each becomes an **attachment map**:
  parts cut at headings when the text has headings; otherwise at page markers, grouped to about
  4,000 chars a part; otherwise at about 4,000 chars on paragraph breaks. A part has an id, its
  heading or page range, its length and its first ~300 chars.
- **Parts the plan must see whole** (our call, no extra model call): when the attachments are over
  the 30,000-char threshold, code also gives the plan, in full, the attachment's first part (it
  usually carries the cover and table of contents) and every part whose heading or text contains
  table-of-contents, writing-rule or evaluation wording (목차, 작성 요령, 작성 지침, 작성 방법,
  평가 항목, 평가 기준, 배점, 제출, 요구사항, 과업 내용), up to about 20,000 chars together, most
  matches first. For PDF and Hangul text without headings the search runs over the page groups.
  Previews cover the rest.
- **Wiki**: the catalog for the request (`window.workWiki.catalog(request)`), the top index, and
  the category lists the catalog points to (through `index(category)`), within a plan budget of
  about 12,000 chars for the wiki side.

### 3. Plan (one call, JSON)

Input: the request; the style page's roles and its description; the attachment — whole when all
attachments together are under about 30,000 chars, otherwise the attachment maps; the wiki index
material above; the writing rules.

Output:

- `brief`: purpose (the decision the reader makes), reader, 3–5 key messages, terms.
- `title`.
- `chapters` (count from the length hint; otherwise what the material calls for, typically 4–7;
  an RFP's required chapters win): `no`, `title`, `point` (the chapter's conclusion, one
  sentence), `owns` (topics only this chapter explains), `stances` (2–4, no two chapters
  contradicting), `sections` (titles with one line each), `attachmentParts` (ids from the maps),
  `wikiPages` (page names exactly as listed in the index).

Rules given to the plan: the outline follows the attachments when present; every topic is owned
by exactly one chapter; pick only pages that appear in the index given.

### 4. Skeleton

Right after the plan, the document receives: the title, a "요약" placeholder, the table of contents
(chapter and section titles), and one placeholder per chapter showing its title and "쓰는 중…".
Placeholders must be findable again after the user scrolls or the document shifts (see Landing).

### 5. Chapters, in order

Each chapter call gets:

- the brief and the title;
- the whole outline (every chapter's title, point, owned topics, stances, sections);
- the claims ledger: the 3–5 key claims each earlier chapter reported (see below);
- its attachment parts, in full (all of an attachment when the whole attachment set is under the
  30,000-char threshold; otherwise only the assigned parts, capped at about 24,000 chars);
- its wiki pages, read with `window.workWiki.read`, each capped at about 6,000 chars, at most
  about 20,000 chars together; pages the plan named that do not exist are dropped and the chapter
  is written without them (the prompt says the wiki has nothing for it);
- the writing rules and the style's roles.

The chapter answer is the chapter body followed by two marked lists: `<<주장>>` (3–5 key claims,
appended to the ledger) and `<<부족>>` (what the chapter could not support from its material,
collected for the table). Material priority stated in the prompt: attachment over wiki; where
they differ, follow the attachment.

The body lands in place of the chapter's placeholder. A chapter that fails after its retries
leaves a visible placeholder "이 장을 쓰지 못했습니다" and the run goes on; the final message
names it. This is text only (our call): no retry button and no run state kept after the run; the
user asks the panel to write that chapter again with its normal tools.

The style page's own writing rules (its description and rules, e.g. the bid-proposal section
pattern, sentence endings, answering every requirement ID) go into every chapter prompt next to
the writing rules above.

### 6. Summary and gaps

After the last chapter: one call writes the summary from the brief, the chapter points and the
claims ledger (nothing outside the ledger), which replaces the "요약" placeholder; one call turns
the collected `<<부족>>` items into the "확인 필요 사항" table (item | why it matters for the
decision | chapter, at most 10 rows), appended at the end. No gaps: no table.

### 7. Landing

- **Word editor (`apps/docs`)**: the skeleton is written into the open document (a blank document
  is replaced; otherwise it goes after the last block), using the style's roles
  (`styledBlockNodes`). Each chapter replaces its placeholder range with role-styled blocks
  through `replaceBlockRange`. Blocks are addressed by top-level index and indexes shift as the
  user edits, so placeholders carry a marker the code can find again (for example a unique
  placeholder text per chapter, located by scanning the document before each replacement).
  Chapters may stream into the placeholder live (as `DraftLanding` does) or land whole when done;
  builder's choice.
- **Hangul editor (`apps/hwp`)**: today role-styled writing only builds a **new** file at the end
  of a hidden draft. Our call: create the new document from the skeleton right after the plan and
  open it, then after each chapter rebuild that document from the draft and refresh its tab, so
  the user watches it fill like in the Word editor. If refreshing the open tab cannot be made to
  work cleanly, fall back to showing the outline with per-chapter status in the progress card and
  building the document once at the end; say which in the plan.
- **Body format the model writes**: one structured form for both editors that code maps onto the
  style's roles: chapter heading, section heading, sub-heading, paragraph, bullet list, numbered
  list, table. The mapping per style page (e.g. section → `heading-2` in docx-report,
  `section` in bid-proposal) is code, not left to the model.

### 8. Progress and cancel

A progress card in the Word and Hangul panels, modelled on the Slides `generate_deck` card
(`DeckProgressEvent`, `deck-progress-view.ts`): planning → skeleton → chapter n/N (title) →
summary → done, with failures listed. Cancel stops the current call; landed chapters stay, open
placeholders are removed, and the final message lists what was written.

## Errors

- Plan fails (no valid JSON after its budgets): nothing lands; the panel says why.
- A chapter fails: placeholder marks it, the run continues, the final message names it.
- The wiki is off or slow: the plan runs without the wiki (attachments only, or the model's own
  knowledge marked by the rules).
- An attachment cannot be read: the run stops before planning and names the file (attachments
  are mandatory material).

## Testing

- Unit tests (fakes for the model, wiki and attachment reader): attachment maps (headings, page
  markers, plain text); plan validation (unknown pages dropped, every topic owned once, RFP chapter
  order kept); budget handling (reasoning-empty cut asks again larger; cut with text continues;
  still cut fails the chapter); chapter context stays within its caps whatever the wiki size;
  missing wiki pages mean no wiki in that chapter; ledger and gaps collection; cancel keeps landed
  chapters.
- Landing tests per editor: skeleton, placeholder found after edits above it, chapter replaced
  with the right roles, failed chapter placeholder.
- End to end with the company model: the UNESCO report request on the 0.5.2 test wiki
  (`unesco-wiki-052`) in both editors, with and without an attached PDF. Record per-call input
  tokens, time and the result; hand the result to a blind reviewer as in the experiment.

## Styles, proposals and tables (decided)

- **Default style.** A request that names no style uses a report style in both editors: the
  Word editor's `docx-report`, and in the Hangul editor a **new narrative report style page**
  (`hwp` format) with the same structure as `docx-report`: title, chapter heading, section
  heading, sub-heading, body paragraph, bulleted and numbered lists, table. The existing Hangul
  styles (bid-proposal, oda-proposal, press-release, seoul-gian, seoul-report) stay and are used
  when the user names them or the request is clearly that kind of document (e.g. an RFP-based
  proposal → bid-proposal / docx-bid-proposal, as today's prompts already say).
- **Proposals keep blanks in the body.** When the document is a proposal (a proposal style is in
  use, or an RFP is attached and the request is a proposal), facts about the bidder that the
  material does not hold (track record, staff, prices) are left as inline blanks the user fills
  in, e.g. `[회사 실적 기재]`, as the proposal rules do today. When the attachment fixes the table of
  contents, no "요약" chapter and no "확인 필요 사항" table are added beyond it. Every other
  document follows the report rules above (no blanks in the body; the gaps table at the end;
  the summary at the top).
- **Tables in both editors, now.** The Hangul styled-document builder
  (`apps/hwp/src/main/styled-document.ts`, paragraphs only today) gains a table block, so chapter
  tables and the gaps table are real tables in Hangul as in Word. The new Hangul report style and
  `docx-report` both get a table role.

## Left to the builder

- Where the orchestration lives (a renderer-side shared package with injected ports for model,
  wiki, attachments, landing and progress is the expected shape) and how the progress card is
  shared between the two panels.
- The exact char caps around the numbers above, the attachment map cut rules, and the prompt
  wording (the writing rules' content is fixed above).
- Streaming chapters live vs landing them whole in the Word editor.
- How placeholders are marked and found.
