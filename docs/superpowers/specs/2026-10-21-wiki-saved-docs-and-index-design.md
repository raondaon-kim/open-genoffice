# Saved documents in the work wiki, and a two-level index that keeps AI context bounded

## Intent

The work wiki has two engines sharing one folder (`Documents/GenOffice 업무위키` by default):

- **LLM Wiki** (the bundled fork, `raondaon-kim/llm_wiki`) turns files in `raw/sources/` into
  `wiki/sources`, `wiki/entities`, `wiki/concepts` pages and keeps `wiki/index.md`.
- **GenOffice's own engine** (`packages/work-wiki`) learns from documents the user saves and
  keeps `wiki/work`, `wiki/methods`, `wiki/clients`.

Today only materials added by hand reach LLM Wiki, and GenOffice learns only from `.hwp`,
`.hwpx`, `.docx`, `.pptx` saved in three editors. The user wants every saved document to reach
LLM Wiki too, and GenOffice's learning widened to the same formats. Feeding that many documents
breaks today's index handling, so the index changes in the same piece of work:

- LLM Wiki sends the whole `index.md` to the model on every ingest and has the model rewrite the
  whole file. Input grows without bound, and once the index no longer fits the output budget
  (16,384 tokens, shared with the new pages) entries are lost silently. At the observed rate
  (about 15 pages and about 1 KB of index per document) that starts after a few dozen documents.
- Deleting a source leaves index lines whose form the cleanup does not recognise (18 such lines
  are in the user's index now).
- GenOffice's editor AI panels get a catalog of its own pages cut at 3,000 chars, oldest first
  out, appended to every user message (so it piles up in history).

## Goals

1. **Saved documents reach LLM Wiki.** Saving in any of the seven editors (Hangul, Word,
   Slides, Sheets, PDF, Markdown, HTML) puts a copy of the document into the wiki's sources, and
   a later save updates that copy, so LLM Wiki ingests and re-ingests it.
2. **GenOffice learns from the same seven formats.** Its work / method / client pages keep being
   made, now also from `.xlsx`, `.pdf`, `.md`, `.html` saves.
3. **A two-level index maintained by code.** A small top index lists the categories; each category
   has its own index; a category that grows past a size limit is split by page tag. The model never
   rewrites an index; code rebuilds them from the pages on disk.
4. **Bounded context.** LLM Wiki's ingest sends the model the top index plus only the relevant
   index entries, within a fixed budget. GenOffice's AI panels send a question-relevant catalog
   within its cap, carry it only on the latest message, and can open a category index with a
   tool. All seven editor panels get the wiki tools.

## Non-goals

- Live sync of the two engines' pages or merging them into one engine.
- Changing how LLM Wiki writes source, entity and concept pages, or how GenOffice writes its
  pages (caps, prompts), beyond the context they are given.
- Embedding search in GenOffice.
- Rewriting `overview.md` handling (only its size in the prompt is capped).

## Anti-goals

- A save must never be blocked or slowed by the wiki (all of this runs after the save, debounced).
- No index entry may be lost when the wiki grows; after every rebuild the index matches the pages
  on disk exactly.
- The original document is never moved or modified; only a copy goes to the wiki.
- A document in an excluded folder, a temp/lock file, or a file inside the wiki folder never
  reaches the wiki.

## Decided

### A. Saved documents into LLM Wiki (GenOffice)

- **Trigger.** Every successful save in the seven editors reports the path to the work wiki. The
  shell already forwards saves from Hangul, Docs and Slides (`workWikiDocumentSaved`); Sheets,
  PDF, Markdown and HTML get the same hook. _(decided)_
- **Timing.** The mirror runs in the engine's existing document job: 120 s after the last save of
  that path, so a burst of saves or autosaves is handled once. _(decided)_
- **On by default, with a switch.** Settings › Work wiki gets "Also put saved documents into the
  wiki" (on by default) next to the existing exclude-folders list. The copy is the original as it
  is (no masking), so LLM Wiki reads PDFs, images and tables fully. The first time a saved
  document is copied, a one-time notice says that whole saved documents are copied into the wiki
  folder and where to switch it off. _(asked: copy as is, switchable; default on and the notice
  are my call)_
- **Where.** `raw/sources/genoffice-saved/` in the wiki folder, a fixed name independent of the UI
  language so a language change never splits it. _(my call)_
- **Name.** LLM Wiki keys a source by its bare file name (ingest cache, `.cache/<name>.txt`,
  `wiki/media/<stem>/`, `sources:` front matter, the delete cascade), so the mirror name must be
  unique across the whole `raw/sources` tree and the names in `.llm-wiki/ingest-cache.json`:
  `<stem>.<ext>`, else `<stem> (2).<ext>` and so on. `.hwp`/`.hwpx` become `<stem>.md` with the
  extracted text, as "Add material" does today. The map from the original's canonical path to its
  mirror name lives next to the existing dedupe index,
  `<userData>/work-wiki/<wiki id>/saved-index.json`. Uniqueness is checked against what is on disk,
  so two people sharing a wiki folder never overwrite each other's copy. _(builder check: decided
  here)_
- **Already added as material.** When a document's first mirror has the same content hash as a
  copy in the "Add material" index, that copy becomes the document's mirror (updated in place from
  then on) instead of a second source. _(my call)_
- **Update.** The copy is replaced atomically only when the content hash changed; an unchanged
  save does nothing. A document's copy is replaced at most once an hour; changes in between are
  held and the latest content is written when the hour is up (or at the next save after it).
  _(my call: every save of a large document would otherwise re-run a whole LLM Wiki ingest)_
- **Older documents.** A document saved before this feature joins the wiki at its next save; there
  is no bulk import (the "Add material" card covers that). **Save As** to a new path is a new
  document with its own copy. _(my call)_
- **Excluded.** Files inside the wiki folder, temp/lock files (`~$*`, `*.tmp`), the user's
  exclude list, and files over 100 MB (the "Add material" limit). _(decided)_
- **Original deleted:** the copy stays (the wiki keeps what it learned). **Original moved or
  renamed in the app** (`afterFileMoved`): the map key follows; the copy keeps its name. _(my
  call)_
- The work wiki switched off: nothing is mirrored (as today for learning).

### B. GenOffice learning widened (GenOffice)

- Learned extensions become `.hwp .hwpx .docx .pptx .xlsx .pdf .md .html` (`LEARNED` in
  `packages/work-wiki/src/node/engine.ts`). _(decided)_
- Text comes from `@genoffice/file-parse` `parseFileToText` for the new formats (it already reads
  xlsx, pdf, html, md). The existing digest caps (12,000 first learn / 6,000 revision) apply.

### C. Two-level index (LLM Wiki fork)

- **Owner.** The fork gains an index builder (TypeScript, `src/lib/`) that rebuilds every index
  file from the pages on disk. It is the only writer of index files. _(decided)_
- **Categories** are the top-level folders under `wiki/` that hold pages (`sources`, `entities`,
  `concepts`, and GenOffice's `work`, `methods`, `clients`, plus any other folder that appears).
  Known folders get display names (자료, 인물·기관, 개념, 작업물, 작업 방식, 발주처 in Korean; the
  wiki's output language decides); unknown folders show their folder name. _(decided)_
- **Files.**
  - `wiki/index.md` (top index): one block per category with its display name, a one-line
    description, page count, last update, and its five most recently updated pages. Capped at
    4,000 chars (the list of recent pages shrinks first). _(decided; numbers my call)_
  - `wiki/index/<category>.md`: one line per page,
    `- [[slug]] — title — summary` where the summary is the first body line that is not a
    heading, cut to 120 chars, newest first. _(decided)_
  - **Split:** a category with more than 200 pages instead lists its groups with counts, and each
    group gets `wiki/index/<category>/<group>.md`. _(decided: "kinds first, tags when big"; the
    rules below are my call after the builder check found real pages' first tags often repeat the
    category and GenOffice pages have none)_
    - A page goes to the group of its first tag that is not the category's own name or display
      name (e.g. `개념` on a concept page, `출처` on a source page are skipped).
    - Groups with fewer than 5 pages, and pages with no usable tag, go to "기타".
    - At most 30 groups are listed (largest first); the rest join "기타".
    - GenOffice `work` pages are grouped by the year of `updated`; `methods` and `clients` (no
      tags) go straight to numbered parts.
    - Any group, and any category index file, over 200 lines is cut into numbered parts, so every
      index file stays under `wiki_index`'s 6,000-char cap.
- **Rebuild triggers.** After every ingest, after any page deletion or cleanup (including
  `cleanupDeletedWikiPages`, cascade delete and dedup), when LLM Wiki starts, and through a new
  authenticated HTTP endpoint `POST /projects/:id/index/rebuild` that GenOffice calls after its
  own engine writes pages. _(decided)_
- **A changed source is rewritten, not merged.** When a source file is modified (a saved
  document's copy replaced, or any other source edited), LLM Wiki first removes the pages whose
  only source is that file (the same rule `deleteSourceFiles` applies on deletion), then ingests
  it again, so the wiki matches the document's latest content. Pages that other sources also use
  are still merged as today. A hand edit to a removed page is lost; that is accepted. _(asked:
  rewrite)_
- **Ingest prompt.** The model no longer emits `wiki/index.md`: the generation prompt drops the
  "preserve all existing entries" instruction and any index FILE block in the output is ignored.
  The index context becomes the top index plus the index entries most relevant to the source,
  chosen by code (keyword overlap with the source text and the analysis step's output) within the
  existing `computeContextBudget` index budget (5% of `maxContextSize`). `overview.md` in the
  prompt is capped at 6,000 chars. _(decided; overview cap my call)_
- The other readers of the whole index (`enrich-wikilinks`, `deep-research`, chat) use the same
  relevance slice.
- **Migration.** The first rebuild replaces today's `index.md`; stale lines disappear because the
  index now comes from the files. `schema.md`'s instructions about keeping the index are updated
  to say code maintains it. Page walkers (search, graph, lint, GenOffice's foreign-page reader)
  skip `wiki/index/` like they skip `index.md` today.
- **LLM Wiki not running.** It is the only index writer, so pages GenOffice writes while it is off
  (not installed, failed to start, API switched off) are indexed at its next start. Meanwhile
  GenOffice's catalog works as today (own pages plus search) and `wiki_index` answers that the
  index is not available yet and to use `wiki_search`. _(my call: one writer, no duplicated
  builder)_
- **Shipping.** The fork change is committed there, `tools/llm-wiki.pin.json` in GenOffice moves
  to the new commit, and the installer is rebuilt.

### D. Bounded context in GenOffice's AI panels (GenOffice)

- **Catalog.** `buildContext()` builds a catalog for the current question: pages found by
  `wiki_search` for the user's message (both engines) first, then the top index's category lines,
  then recent GenOffice pages, within the existing 3,000-char cap. _(decided)_
- **Latest message only.** The catalog is attached to the newest user message only; earlier
  catalogs are removed from the history sent to the model (agent-core). _(decided)_
- **New tool `wiki_index`.** No argument: the top index. With a category (and optional tag):
  that index file. Capped at 6,000 chars per call; a cut result says how to narrow it. _(decided)_
- **All seven panels.** Sheets, PDF, Markdown and HTML panels get the work wiki skill (catalog
  and tools) that Docs, Slides and Hangul have. _(my call: they already use agent-core skills)_
- GenOffice's own learn step uses the same relevance slice for its 6,000-char catalog.

## Constraints

- Docs and comments English-only; renderer CSS tokens only; Prettier and lint clean (GenOffice
  CI gates). The fork follows its own lint and tests.
- No internal address or key in either repository.
- Windows is the target; paths with Hangul and spaces must work.
- The user's real wiki and LLM Wiki state must not be touched by tests (temp folders; back up and
  restore `%APPDATA%\com.opengenoffice.llmwiki\app-state.json` around packaged runs).

## Left to the builder

- How an `.xlsx` digest presents sheets and tables within the cap.
- The keyword-overlap scoring for the relevance slice, within the stated budget.
- One-line category descriptions.
- Where in agent-core the old catalogs are stripped, as long as every editor gets it.

## Testing

- **Fork:** unit tests for the index builder (categories, top-index cap, the 200-page split, tags,
  "기타", stale entries gone), the relevance slice within budget, ingest output no longer
  writing `index.md`, rebuild after deletion, and the rebuild endpoint.
- **GenOffice:** tests for the save hooks of the four new editors, the mirror (name, collision,
  hwp → md, unchanged save skipped, exclusions, size limit, move), the widened learn formats, the
  question-relevant catalog, the latest-message-only rule, `wiki_index`, and the skill in all
  seven panels.
- **Scale:** a synthetic wiki of 1,000+ pages keeps the top index under its cap, splits big
  categories, and keeps the ingest index context within budget.
- **Built app:** save one document of each of the seven types in a temp profile and wiki →
  copies in `raw/sources/genoffice-saved/`, LLM Wiki pages, GenOffice pages, and index files
  that list every page; an AI panel answers using a page found through `wiki_index`.
