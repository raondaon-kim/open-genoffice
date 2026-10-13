# Work wiki: automatic work memory for the assistants

Date: 2026-10-13. Status: design, awaiting review.

## Goal

The assistants (Hangul, Word, PowerPoint) remember the user's **work** — what jobs were done, a
short summary of each, and **how the work is done** — and use it on their own when writing the next
document. Nobody manages the wiki: it is built and updated automatically from the documents the
user saves and from what the user says in chat, and the assistants look it up by themselves.

The method is the LLM Wiki pattern (Karpathy): knowledge is compiled once into a small set of
maintained pages and updated incrementally, instead of re-reading raw documents on every request.

## Decisions taken with the user

| Question                 | Decision                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How to bring LLM Wiki in | Implement the pattern in GenOffice's own code (Apache-2.0). LLM Wiki is GPL-3.0; none of its code is copied. The folder format matches LLM Wiki so the same folder opens in LLM Wiki or Obsidian. |
| Where the wiki lives     | `Documents\GenOffice 업무위키` by default; a setting can point it at a shared folder.                                                                                                             |
| How it is filled         | Automatically: every saved document (first save and every revision), files dropped into `raw/sources/`, and durable facts the user states in chat. No approval step, no "remember this" needed.   |
| UI                       | None for managing the wiki. The assistants read and write it; a small settings block only switches it on/off, moves the folder and excludes folders.                                              |
| What is kept             | Work, summary and working methods — not document contents. Pages are short and capped.                                                                                                            |
| How it is searched       | By **work** (업무), not by document. Documents only appear as one-line entries inside a work page.                                                                                                |

## Non-goals (first version)

- No vector/embedding search, no knowledge graph, no wiki browser UI.
- No copying of document text into the wiki; the source file stays where the user saved it.
- No multi-user locking for a shared folder beyond atomic writes (last writer wins per page).

## Folder layout

```
<wiki root>/
  purpose.md                 why this wiki exists (written on first run, company default)
  schema.md                  page types and rules (written on first run)
  raw/sources/               files the user drops in to be learned
  raw/sources/genoffice/     notes GenOffice writes from chat (wiki_remember)
  wiki/index.md              catalog: one line per page, kept by code
  wiki/log.md                what was learned when, kept by code
  wiki/work/<slug>.md        업무 — one page per job/project
  wiki/methods/<slug>.md     작업 방식 — how a kind of work is done
  wiki/clients/<slug>.md     기관 — preferences of a client/agency
  .genoffice-wiki/           engine state (not wiki content)
    documents.json           saved-document registry
    queue.json               pending learn jobs
```

### Page types and caps

| Type               | Folder          | Holds                                                                                                                               | Cap         |
| ------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| work (업무)        | `wiki/work/`    | what the job is, client, purpose, status, key decisions, lessons, and a **관련 문서** list (title · date · one-line summary · path) | 1,500 chars |
| method (작업 방식) | `wiki/methods/` | patterns seen across documents: structure/order, emphasis, wording rules, formats used, **how the user revises drafts**             | 2,000 chars |
| client (기관)      | `wiki/clients/` | what a client prefers, how it evaluates, past outcomes                                                                              | 800 chars   |

Every page has front matter compatible with LLM Wiki:

```yaml
---
type: work # work | method | client
title: KOICA 인도네시아 보건인력 PMC 제안
aliases: [인니 보건 PMC, R25BK01238511]
summary: 인도네시아 보건인력 관리체계 개선사업 PMC 용역 제안 (2025-12)
tags: [ODA, KOICA, 보건]
related: [koica, oda-proposal-method]
sources: [D:/…/제안서.hwp]
created: 2026-10-13
updated: 2026-10-13
---
```

The body uses `[[slug]]` links and ends with a `## 이력` section that holds one line per superseded
value. When a page would exceed its cap, the merge step condenses it (older detail collapses into
`## 이력` lines).

## How the wiki is filled

### Trigger 1: a document is saved

- Each app's main process calls a new `onDocumentSaved(path)` hook after every successful write
  (`hwp:save`, `docs:save` / `docs:save-new`, `slides:save` / `slides:save-as`). The shell forwards
  it to the work-wiki engine. (Today only first saves and save-as notify the shell.)
- Formats: `.hwp`, `.hwpx`, `.docx`, `.pptx`. Files inside the wiki root, temp files and excluded
  folders are ignored.
- Debounce: a job runs 2 minutes after the last save of that path, or when its tab closes, on the
  latest version only.
- Text comes from the saved file in main (`file-parse` for docx/pptx, the bundled rhwp
  `export-text` for hwp/hwpx), split into paragraphs.

### Trigger 2: files in `raw/sources/`

A folder watcher queues new or changed files; the same pipeline runs with "source file" in place of
"saved document".

### Trigger 3: chat

Every assistant gets `wiki_remember(points: string[], work?: string)`. Its prompt rule: when the
user states something durable about the work or how they want work done (who, which client, a
standing preference such as "실적 표는 항상 맨 앞"), call it — without being asked. It writes a dated
note to `raw/sources/genoffice/` and queues it. The chat shows one line: `업무 위키에 기억함: …`.

### Document registry

`documents.json` maps a canonical path to `{ hash, paragraphs (hashes), work slug, learnedAt }`.

- Same hash as last time → nothing to do.
- First time → **first learn**.
- Changed → **revision learn** with only the changed paragraphs (added / removed / modified,
  matched by paragraph hash and position).

### The learn pipeline (LLM Wiki method)

All calls use the model from GenOffice's AI settings, from the main process, with thinking turned
off where the vendor allows it.

1. **Digest (code).** First learn: the outline (headings) plus the first lines of each section,
   capped at 12,000 chars. Revision learn: the changed paragraphs, capped at 6,000 chars, labelled
   added/removed/modified.
2. **Classify and plan (1 LLM call).** Input: `wiki/index.md` (work and method lines with aliases)
   plus the digest. Output (JSON):
   - which work this document belongs to: an existing slug, or a new work with title/aliases;
   - the one-line document entry for that work's 관련 문서 list;
   - points to add or change on the work page (summary, status, decisions);
   - method points: for a first learn, the structure and conventions this document follows; for a
     revision, **what the user changed and in which direction** (e.g. "moved the track-record table
     forward", "turned prose into bullet points");
   - client points, if a client is evident;
   - conflicts with what the pages say now.
3. **Merge (1 LLM call per touched page, usually 1–3).** Input: the current page (or nothing for a
   new one), its cap, and the planned points. Output: the full new page.
4. **Check and write (code).**
   - The front matter parses and the type matches the folder.
   - The page is under its cap (one retry asking to condense, otherwise truncate at a section
     boundary).
   - `sources` is the union of old and new; `updated` is today.
   - A page that would lose its `## 이력` or an existing heading is merged back by appending
     instead of replacing.
   - Write atomically, then rebuild `index.md` from all front matter and append a `log.md` line.

Budget per saved document: 2–4 short calls. Revisions send only the change. Jobs run one at a time
from `queue.json` and resume after a restart; a failed job is retried once and then logged and
skipped.

### Identity of works

Works are matched by slug and `aliases` (project names, numbers, client names). The classify step
always sees the alias list, so a second document about the same job lands on the same page instead
of creating a duplicate.

## How the assistants use it

- **Always in the prompt** (one shared skill added to every assistant's `composeSkills`):
  - the rule text;
  - `purpose.md` (short);
  - a catalog of work and method pages, one line each (title — summary). Work pages are listed
    newest first, and the catalog is capped at about 1,000 tokens.
- **Tools:**
  - `wiki_search(query)`: keyword search over work, method and client pages. Korean-aware
    tokenization (word + character bigrams); title, aliases and summary are weighted. Returns the
    top 5 with their summaries.
  - `wiki_read(slug)`: one page.
- **Rule:**
  1. Before writing a document, look up the work (or the kind of work) and the matching method page.
  2. Follow the method.
  3. Name the wiki pages used.
  4. Information not in the wiki stays a placeholder, as today.
- Wiki text reaches the model fenced as data. hwp's nonce fence (`provenance.ts`) moves to a shared
  package and is used by all three apps.

## Settings

A small block in Settings → AI media (stored with the AI settings, sanitized by
`ai-settings-guard`):

- 업무 위키 on/off (default on);
- folder (default `Documents\GenOffice 업무위키`);
- excluded folders.

## Privacy

- Before any page or note is written, resident registration numbers, card numbers and bank account
  numbers are masked by pattern.
- Excluded folders are never read.
- The wiki stays on the user's disk (or the shared folder they choose).

## Components

| Unit                             | Where                                        | Does                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@genoffice/work-wiki` (node)    | `packages/work-wiki/src/node/*`              | folder bootstrap, page I/O and front matter, index/log, registry and diff, queue, learn pipeline (LLM via an injected `complete(system, user)`), search index, masking |
| `@genoffice/work-wiki` (browser) | `packages/work-wiki/src/*`                   | shared assistant skill (prompt block + `wiki_search` / `wiki_read` / `wiki_remember`) over an injected API; data fence                                                 |
| Shell wiring                     | `apps/shell/src/main/index.ts`               | creates the engine, registers `wiki:*` IPC once, forwards `onDocumentSaved`                                                                                            |
| App hooks                        | hwp-main, docs-main, slides-main             | call `onDocumentSaved(path)` after a successful write                                                                                                                  |
| Preloads                         | hwp, docs, slides                            | expose `wikiSearch`, `wikiRead`, `wikiRemember`, `wikiCatalog`                                                                                                         |
| Settings                         | ai-provider types/guard, shell SettingsModal | the three settings above                                                                                                                                               |

The LLM function given to the engine is built in the shell from the live AI settings with
`streamForProvider` (thinking off). The engine has no Electron dependency, so it can be tested
with a fake `complete`.

## Errors

- The wiki folder is missing or unwritable → the engine disables itself and logs once. Assistants
  then see no wiki block, and saving documents is never blocked.
- An LLM error or invalid JSON → retry once, then log to `log.md` (`실패: …`) and drop the job.
- Text extraction fails (encrypted or corrupt file) → skip and log.

## Testing

- **Unit:**
  - front matter round trip;
  - caps and condense fallback;
  - index rebuild;
  - registry diff (first / unchanged / revised);
  - queue resume;
  - alias matching;
  - search ranking on Korean text;
  - masking;
  - settings sanitize.
- **Pipeline with a fake model:**
  - a first learn creates work and method pages;
  - a revision touches only the affected pages and records the direction of change;
  - an unchanged save makes no LLM call.
- **In the built app (driver):**
  1. Save a proposal → the work, method and client pages appear.
  2. Change the staffing and save → the work page updates and 이력 gains a line.
  3. In a new document, "KOICA 제안서 써 줘" → the assistant reads the work and method pages,
     follows the method and names the pages.
  4. Say "실적 표는 항상 맨 앞에" in chat → `wiki_remember` runs, and the next document follows it.
