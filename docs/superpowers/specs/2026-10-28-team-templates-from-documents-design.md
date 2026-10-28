# Team templates made from the team's saved documents (Word first)

> Status: design, 2026-10-28. Builds on the team library of 0.5.7 (`1d391df7`, `b3f8ebd7`):
> Home's 팀 템플릿 / 팀 문서 over the NAS folders `GenOffice-Templates` and `GenOffice-Documents`,
> every upload masked by `packages/doc-mask`.

## Intent

The team saves its documents from GenOffice to the team NAS (`\\192.168.50.60\GenOffice-Documents`,
masked, one copy per document under `<project>/<member>/<kind>/`). The team wants those documents
to become **templates** in `GenOffice-Templates`, and wants GenOffice to **write a new document
from a template**: the template gives the form, the AI fills the content from the attachments and
the work wiki (LLM Wiki).

The user's definitions (2026-10-28):

- **A template is the form of a document, not its words.** The form is the table of contents
  (chapter and section structure, order, numbering) and the formatting (heading levels, body, list
  and table look, page setup, cover layout, headers and footers). "장 구성(목차)도 템플릿에 들어가게
  되어야 맞을꺼야."
- **The content comes from the LLM Wiki** (and the attachments). "내용은 llmwiki 를 따르면 되잖아?"
- **A template is a set: the document plus an md file** that says what the template is.
  "템플릿 문서와 관련된 md 파일이 세트로 규정되어야 어떤 문서의 템플릿인지 알 수 있지 않을까?"
- **The set must hold together as templates pile up, and GenOffice must find them without reading
  everything.** A team `index.md` in the templates folder, kept up to date, is what GenOffice reads
  to find templates. "index.md 를 읽고 문서를 찾는게 맞지 않을까?"
- **Which documents become templates is not known in advance.** The user could not say who would
  pick them or when, so the app proposes candidates and a person confirms.

## What was learned from the spike (2026-10-28, throwaway, not in the repo)

A script took the Word ODA proposal sample from the NAS (40 headings, 6 tables, every paragraph one
run), had the company LiteLLM (`deepseek-flash`) write a "template card" (purpose, materials,
rules, per-section guidance: 24 s), then rewrote the body section by section from a work-wiki
selection (10 pages picked by the model) and one attachment:

- Formatting held completely when only `w:t` text was replaced: headings identical, the same
  paragraph styles and run formats, table column counts kept, XML valid.
- Sending a whole Heading2 chapter per call overflowed the output (two chapters cut at max
  tokens). **Per Heading3 subsection** (33 calls, 4 in parallel) worked: 142 s for the document.
- Missing facts became placeholders (`[대표자 성명 기재]`, `[○]명`) as asked; no RFP attached, so
  many (303).
- The model's card skipped one block; code must check the card covers every section.
- The spike kept the old body as an example and rewrote it. **The user rejected that**: a template
  holds no words of the old document. This design replaces it.

NAS facts (measured from this PC, 1 Gbps, SMB): listing 65–84 ms, small-file read 7 ms, large
transfers ~52–56 MB/s, but **creating a file ~650 ms, rename ~1.5 s, mkdir ~690 ms**. Reads are
cheap; every file created or renamed on the NAS costs about a second.

## Goals

1. **Candidates.** GenOffice finds Word documents in `GenOffice-Documents` whose form repeats (or,
   while the team is testing, any single Word document) and shows them as template candidates.
2. **Templatize.** From a candidate, one action makes a template set in `GenOffice-Templates`: an
   emptied form file plus a `template.md` drafted by the AI, which a person reviews and confirms.
3. **Find.** GenOffice lists templates by reading one `index.md`, opens only the chosen set, and
   notices and repairs a set or an index that no longer matches the folders.
4. **Write.** Opening a template gives a local working copy of the form; the Word AI writes the
   document into it, keeping the template's table of contents and formatting, with content from
   the attachments and the work wiki.
5. **Manage.** Templates are managed inside GenOffice ("앱에 들어가지 않으면 따로 프로젝트를
   만들어 관리해야 하니 앱에 들어가는게 맞는것 같은데"), but **a confirmed template is never
   edited** ("템플릿은 고치지 않을꺼야"): it is either made again from another team document or
   deleted. Writing edits back to the slow NAS was the main bottleneck ("이게 병목의 주 원인이야").

## Non-goals (this version)

- Hangul (`.hwpx`), PowerPoint and Excel templates. Word only ("시험문서는 word 로 하는게 좋겠어").
  The set layout, `index.md` and candidate logic are format-neutral so the others can follow.
- Automatic confirmation. A candidate becomes a template only when a person confirms it.
- Learning from templates into the LLM Wiki, and changes to the LLM Wiki fork.
- Templates from documents that are not in `GenOffice-Documents` (the existing "템플릿 등록" from a
  local file stays as it is, see Compatibility).
- Scale beyond a team's tens of templates. Test with 10–20 sets; 100+ is not required.
- Editing a confirmed template in the app (see Manage).
- Keeping the app in the system tray after its windows close. Discussed (it would make
  background work such as the team document sync survive a closed window) but not needed here,
  since templates are written only at 확정 and 삭제; a separate project if wanted.

## Anti-goals (a failure even if it technically works)

- **Words of the source document reach a template.** No body sentence, project name, number or
  table value of the source may remain in `form.docx` or `template.md`. Headings that name the
  old project (e.g. "인도네시아 보건인력 현황") are generalized, not copied.
- **A template disappears or a wrong one opens** because `index.md` is stale, corrupt or was
  overwritten by another PC.
- **Saving gets slower.** Nothing new runs on the save path; the team sync stays as it is.
- **Listing templates reads every file on the NAS.** The list comes from `index.md`.
- **The written document drops or reorders the template's chapters**, or its content looks
  formatted differently from the template's body.

## The template set

One folder per template. The folder moves, renames and copies as a unit in Explorer, so the pair
cannot come apart the way two side-by-side files can.

```
GenOffice-Templates/
├── index.md                                 ← the catalog GenOffice reads
├── Word/
│   └── KOICA-ODA-기술제안서/
│       ├── template.md                      ← what the template is
│       └── form.docx                        ← the form, emptied
├── Hangul/ …  PowerPoint/ …                 (later formats, same shape)
```

- The kind folders (`Word`, `Hangul`, `PowerPoint`, `Excel`) are the ones the 0.5.7 library
  already creates (`teamDocumentType`).
- The set folder's name comes from the template's title (`teamFolderName`), made unique.

### form.docx (the form)

Made from the source document by removing content and keeping form:

- Kept: styles part, numbering, section properties (page size, margins, orientation), headers and
  footers, the heading paragraphs (text generalized where it names the source, see below), cover
  paragraphs with their formatting, every table's header row and column layout.
- Emptied: body paragraphs between headings are reduced to **one empty paragraph per section in
  the style the section's body used** (a slot the writer fills); table body rows are reduced to
  one empty row in the source row's formatting; cover values become placeholders
  (`[사업명]`, `[발주기관]`, `[제출일]`).
- Removed: comments, tracked changes, document properties' text (title, author, keywords),
  thumbnails, custom XML, embedded objects and images that are not in headers/footers (my call:
  images in the body are content; a logo in a header is form).
- Text that stays (headings, header/footer text, table header rows, cover labels such as
  "발주기관 :") is generalized by the AI in the same draft as `template.md` (step 2 of
  Templatize) and shown to the reviewer (my call).
- Before it is written to the NAS, the form passes two gates (my call):
  - **the source-words gate:** code collects the source's body paragraphs, cover values and table
    body cells; no run of 8 or more characters (whitespace and numbering ignored) from them may
    appear anywhere in `form.docx` or `template.md`. Heading texts, table header rows and cover
    labels are form and are not part of the collected text. A hit blocks confirmation and shows
    the offending line to the reviewer;
  - the doc-mask verification gate, like every other NAS upload.

### template.md (the definition)

Markdown, readable and editable in the GenOffice Markdown editor. Its formatting block uses the
**existing document-style page format** (`packages/doc-styles`, the ```` ```json style ```` block of
`apps/hwp/resources/doc-styles/docx-*.md`), so the Word AI's existing style path can read it. New
parts are a fixed outline and a header with the set's facts.

```markdown
# KOICA ODA 기술제안서 (Word)

- 용도: KOICA 용역 입찰의 기술제안서 본문. 제안요청서가 첨부되면 그 평가 항목과 분량 비율을 따른다.
- 상태: 확정 · 2026-10-28 · 공용
- 근거 문서: 3건
- 형태 파일: form.docx · sha256 3f9a…
- 필요한 자료: 제안요청서, 회사소개서, 투입인력 이력
- 참고할 업무 위키: methods/pmc-제안서-목차-구성-방식, methods/제안사-정보-기재-방식

## 목차
- Ⅰ. 제안사 소개 — 일반현황·연혁·조직을 증빙 위주로. 분량 ≤10%.
  - 1. 일반현황 및 연혁
    - 1-1. 회사 일반현황 — 회사명·대표자·주소·설립연도를 글머리로. 모르는 값은 [○○ 기재].
- Ⅲ. 사업관리 부문
  - 1. 투입인력 현황 및 운용계획
    - 1-1. 투입인력 현황 — 표(등급·중요도·투입일수·담당업무·성명).

```json style
{ "format": "docx", "id": "team-koica-oda-proposal", "title": "…", "roles": [ … ], "page": { … } }
```
```

Rules:

- `상태` is `확정 · <date> · <author>`; the author is the member name from the team settings
  (`공용` in the example is that name, not a scope). `확정` is the only stored state; "md 갱신
  필요" and "깨진 템플릿" are computed when the set is read, never written (my call).
- `근거 문서` is a count plus, for matching only, the documents' outline-signature hashes on a
  separate `근거 서명:` line; never paths or names, which carry project and member names (my call).
- **`template.md` is the source of truth for the table of contents** (my call). During review the
  user may rename headings and edit guidance; adding, deleting or reordering headings is not
  offered in this version (re-templatize from another document instead). On confirmation the
  form's heading texts are rewritten from the md, so the two match.
- The `## 목차` list mirrors `form.docx`'s headings one to one, in order. When a hand edit breaks
  the mirror later, opening the set marks it "md 갱신 필요" and writing follows the md's outline
  matched to the form's headings by position and level; a mismatch in count or level is an error
  that names the first differing heading (my call). Each entry may carry a
  `— guidance` text (what to write, form, length share). This list is the template's table of
  contents.
- The header lines are fixed `key: value` lines (용도, 상태, 근거 문서, 형태 파일, 필요한 자료,
  참고할 업무 위키) so code can parse them; other prose is allowed after them.
- The `json style` block is measured from the source document (fonts, sizes, spacing, indents of
  the heading levels, body, list, table and cover paragraphs, page setup), not invented.
- The form file's sha256 is recorded; a different hash later means the form was changed by hand
  and the md must be reviewed ("md 갱신 필요").
- The md never contains the source's sentences, names or numbers. The AI drafts the guidance from
  the source's form ("회사 일반현황을 글머리로"), not its content; doc-mask's detectors run on the
  md before it is written.

### index.md (the catalog)

At the root of `GenOffice-Templates`. Human-readable, with fixed line shapes the app parses:

```markdown
# 팀 템플릿 목록
갱신: 2026-10-28 15:20 · 공용 · 템플릿 2개

## Word
- [KOICA ODA 기술제안서](Word/KOICA-ODA-기술제안서/) — KOICA 용역 입찰의 기술제안서 본문 · 확정 · 3f9a1c2e
- [국내 연구용역 결과보고서](Word/국내-연구용역-결과보고서/) — … · 확정 · 77b0d1aa

## 정리되지 않은 파일
- [GenOffice_기술제안서_샘플_경기도_도시생태현황지도.docx](Word/GenOffice_기술제안서_샘플_경기도_도시생태현황지도.docx)
```

- One line per set: title, relative folder link, 용도 (one line), 상태, the first 8 hex of the
  form's hash.
- **The index is derived data.** Everything in it comes from the sets' `template.md` files, so it
  can always be rebuilt from the folders. That is what makes concurrent writers and hand edits in
  Explorer survivable.
- Loose files that are not in a set (the 0.5.7 layout, e.g. today's `Word/*.docx`,
  `Hangul/*.hwpx`) are listed under "정리되지 않은 파일" so they stay usable and can be turned into
  sets.

## Flows

### 1. Candidates (from GenOffice-Documents)

- Shown in the 팀 템플릿 space as a "후보" section, computed when the user opens it (or presses
  refresh), never on save.
- For each Word document under `GenOffice-Documents` (bounded like the current listing: depth,
  count, recycle folders skipped), read its **outline signature**: the heading sequence (level +
  heading text with numbering and project-specific words normalized away) and each table's column
  headers.
- Signatures are cached on the PC keyed by NAS path + size + mtime, so a second visit reads only
  new or changed documents (reads are cheap, but the folder grows without bound).
- Documents whose signatures match closely enough form a group; a group is a candidate. While the
  team is testing, a single document is a candidate too; the threshold (1 → 2) is a setting the
  builder exposes, default 1 for now (user's direction: start testing now, repetition later).
- A candidate already covered by a set (an outline at least 80% alike the set's `## 목차`, or one
  of its `근거 서명` hashes) is shown as "이미 템플릿 있음" with a link. Computing candidates never
  writes to the NAS. There is no "add to the set's 근거 문서" action: it would edit a confirmed
  template, which the user ruled out; a form that grew is taken in with 다시 만들기 (2026-10-28,
  after the 0.5.8 review).
- A candidate of several documents lets the user choose the representative document the form is
  built from (default: the newest).
- Heading detection uses Word heading styles (`Heading1..n` / outline level). Documents without
  heading styles fall back to numbering patterns (Ⅰ., 1., 1-1., 가.) and run size; such guesses are
  marked as less certain in the candidate card.

### 2. Templatize

From a candidate (or a loose file), "템플릿 만들기":

1. Build `form.docx` from the group's representative document (newest, or the user's pick).
2. Ask the AI (main process, the user's configured AI connection, like the work wiki's
   `createWikiComplete`) for the `template.md` draft: title, 용도, 필요한 자료, 참고할 업무 위키
   (chosen from the wiki's index), per-section guidance, and generalized heading texts where the
   headings name the source. When the group has several documents, the AI sees all their outlines,
   so what they share is form and what differs is content.
3. Measure the `json style` block from the representative document in code.
4. Show the draft for review in a dialog or in the Markdown editor; the user edits and confirms.
   Nothing is written to the NAS before confirmation.
5. On confirmation: run the doc-mask gate on both files; create the set folder; write both files
   (staged name, then rename, as the team library does); update `index.md`.

### 3. Find

- The 팀 템플릿 list reads `index.md` plus one directory listing of each kind folder (`Word/`, …,
  not recursive, no file reads; ~70 ms each). An entry in a kind folder that the index does not
  know (a set copied in by hand, a loose file from "템플릿 등록" or from a 0.5.7 client) is shown
  at once and added to the index on the next index write (my call: a mixed-version team is
  supported; 0.5.7 clients will list a set's `form.docx` as a loose file, which is accepted).
- A member with read-only access to the templates folder repairs in memory only: the list is
  right on their PC, `index.md` is left for a member who can write (my call).
- Opening a set reads its `template.md`, checks `form.docx` exists and its hash matches.
- Repair, without reading everything:
  - set folder missing (moved/deleted in Explorer) → rescan that kind folder only (`Word/`),
    rebuild those lines of the index, tell the user what changed;
  - hash mismatch → open anyway, mark the set "md 갱신 필요";
  - `index.md` missing or unparsable → full rebuild from the sets' `template.md` files;
  - a "목록 다시 만들기" button does the full rebuild on demand.
- Writing `index.md`: re-read it, apply the change, write to a staged name and rename over it. A
  lost update between two PCs is possible and is repaired by the next rebuild; nothing is ever
  deleted from a set because of the index.
- The Word AI can read `index.md` (read-only tool) to suggest a template for a request such as
  "KOICA 제안서 써 줘", then the user opens it.

### 4. Write

- "선택" on a set copies `form.docx` to the local working folder (existing `createWorkingCopy`
  behaviour) and opens it in Word. The opened document **knows its template** (set id and the
  `template.md` text travel with it to the Word AI panel; how is the builder's call).
- In that document, `write_report` uses the template instead of planning a table of contents:
  - the outline is the `## 목차` list, fixed: no chapter added, dropped or reordered; the plan step
    only assigns material (attachment parts, wiki pages) and points to each section;
  - each section is written into its slot under its heading, in the form's own body/list/table
    formatting, per **Heading3-level section** (or the deepest heading level the template uses),
    as the spike showed;
  - the per-section guidance from `template.md` goes into that section's prompt; the template's
    "참고할 업무 위키" pages are read first;
  - the cover placeholders (`[사업명]`, `[발주기관]`, `[제출일]`, …) are filled from the request and
    the attachments first; any left unfilled stay as placeholders and are listed in the
    "확인 필요 사항" table (my call);
  - facts only from the attachments and the wiki; missing facts as `[○○ 기재]`, and the existing
    "확인 필요 사항" table at the end;
  - an RFP attachment can still override the outline only if the user asks; by default the
    template wins (my call: the user said the table of contents belongs to the template).
- Existing behaviour stays: progress card with cancel, one AI-undo step, tracked when track
  changes is on.

#### The LLM Wiki must be up when a template is filled

The user's concern (2026-10-28): the LLM Wiki has to be active again after GenOffice is
restarted. Today `startWorkWiki` → `startLlmWiki` (`apps/shell/src/main/work-wiki.ts`) starts it
hidden at every launch and clears a stale process through `llm-wiki.pid`, but a failed start only
becomes a status shown in Settings (`llmWikiStatus`); nothing tells the user, and a fill would
quietly run without the wiki. So (my calls on the details):

- Before a template fill starts, GenOffice checks that the LLM Wiki answers (its health check /
  `llmWiki.status()` is `running`). If it is starting, wait for it (bounded, e.g. 30 s, shown in
  the progress card as "업무 위키 준비 중…").
- If it is stopped with an error, try one restart (`startLlmWiki`) and check again.
- If it is still not up, ask before writing: "업무 위키를 사용할 수 없습니다 (<reason>). 첨부
  자료만으로 쓸까요?" with 그대로 쓰기 / 취소. A fill never runs without the wiki silently.
- The work wiki's own pages (`wiki/work`, `methods`, `clients`, read by the GenOffice engine) are
  used even when the LLM Wiki program is down; only LLM Wiki's search and pages are missing then.
  The message says so.
- The same check covers a fill started right after launch, before the LLM Wiki has finished
  starting.

### 5. Manage

The NAS is written at exactly two moments, both while the user is in front of a dialog with a
progress indicator: **확정** (a new template, or 다시 만들기) and **삭제**. Nothing is written
on save, on tab close, on quit or in the background, so no write-back queue, quit handling or
conflict merging is needed.

Actions on a set in the 팀 템플릿 list, for members who can write to the templates folder (a
permission error hides or disables them; detection is the builder's call):

| Action | What happens |
|---|---|
| 다른 문서로 다시 만들기 | Templatize again from a chosen candidate (or loose file) into this set: a new form and a new md draft, reviewed like a new template. On 확정 both files are replaced (staged, then renamed) and the index line is rewritten. |
| 삭제 | After a confirmation dialog, deletes the set folder (the NAS's network recycle bin keeps it) and removes its index line. |

- **No in-app editing** of a confirmed `template.md` or `form.docx`. To change a template, the
  team edits a document as usual, lets it reach `GenOffice-Documents`, and makes the template
  again from it, so templates always come from team documents.
- Hand edits made in Explorer are not prevented; they show as "md 갱신 필요" (hash mismatch) or
  "깨진 템플릿" when read, and 다시 만들기 is the way to settle them. There is no "확인함" action.
- Before 다시 만들기 replaces the files, the set's current `template.md` hash is compared with the
  one read when the dialog opened; if another member replaced it meanwhile, the user is told and
  asked to look again (no merge).
- A template opened with "선택" is an ordinary local working copy (as in 0.5.7); saving it never
  writes to `GenOffice-Templates`. Being a normal document, a user save of it is sent to
  `GenOffice-Documents` by the existing team sync like any other document.

## Compatibility with 0.5.7

- Loose files in `GenOffice-Templates` keep working: listed under "정리되지 않은 파일", openable as
  today, and each can be turned into a set with "템플릿 만들기".
- "템플릿 등록" (publish a local file) stays; it creates a loose file as today. Turning it into a
  set is the same "템플릿 만들기" step.
- Team document sync, masking and the `GenOffice-Documents` layout are unchanged.

## Constraints

- NAS file creation and rename cost ~1 s each: templatizing writes ~4 files (two staged + renames,
  index) and should show progress; listing must not create files.
- Theme, i18n and build rules of `CLAUDE.md` apply (new strings in every locale shard; shell main
  changes need a shell rebuild).
- The AI connection is the user's configured one (the company build: LiteLLM `deepseek-flash`).
- Template content must pass doc-mask verification before reaching the NAS.

## Left to the builder

- Signature normalization and the similarity measure; the exact candidate threshold setting.
- How the opened working copy carries its template to the Word AI panel.
- How the Word lander writes into the form's slots (replacing slot paragraphs vs inserting after
  headings) as long as the form's formatting is used.
- The review UI for the md draft (dialog vs opening the md in the Markdown editor).
- Cache location and format for outline signatures.
- Module layout (e.g. a `packages/team-templates` package for form building, md/index
  parse/write and signatures; shell main for NAS I/O; docs renderer for the template-aware
  `write_report`).

## Testing expectations

- Unit: outline signature extraction (styled and unstyled headings), grouping, form building
  (no body text, table values or properties left; styles/sections/headers kept), `template.md` and
  `index.md` parse/write round trips, index rebuild from sets, hash mismatch detection.
- Anti-goal tests: a source with a project name in headings, numbers in tables, comments and
  tracked changes produces a form and md with none of them.
- `write_report` with a template: chapters equal the template's outline in order; content lands
  in the form's formatting; a failed section is marked, others continue.
- Manage: 다시 만들기 replaces both files and the index line; a set replaced by another member
  while the dialog was open is not overwritten silently; delete removes the folder and the index
  line; nothing is written to the templates folder on save, tab close or quit.
- Live, on the team NAS with 10–20 sets: list time from `index.md`; Explorer rename/move/delete of
  a set and of one file inside a set; two PCs confirming templates at once; index deleted.
- LLM Wiki after restart: quit and relaunch GenOffice, then fill a template at once (waits for
  the wiki); with the LLM Wiki program made unavailable (renamed exe, killed process), the fill
  retries once and then asks before writing without it.
- Real document: templatize the ODA proposal sample, then write the Rwanda proposal (the spike's
  scenario) from it and compare with the spike's result.
