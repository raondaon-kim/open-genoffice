# Open GenOffice modifications

Open GenOffice is derived from
[`genspark-ai/genoffice`](https://github.com/genspark-ai/genoffice). Since
2026-10-07 it is based on upstream main `2490e20d` (it started from upstream
`4da673d4` in August 2026 and was moved onto the current upstream instead of
porting upstream changes one by one). The upstream copyright and attribution
remain in `LICENSE` and `NOTICE`.

The fork's material changes on top of upstream:

- **Hangul documents (`.hwp`/`.hwpx`)** as a shell tab, built on the
  MIT-licensed rhwp editor: the rhwp studio UI is built from the pinned upstream
  release and served from a loopback origin, and the HwpForge generator and the
  rhwp CLI ship as application resources. Home has "New HWP" and "HWP from a
  form" (a copy of the user's form opens as an untitled document; the form file
  is never written). The Hangul assistant reads the open document through the
  rhwp CLI (structure, page text, search, table grids, form fields), edits text,
  tables, footnotes/headers and paragraph formatting as verified file edits with
  a one-step undo, fills forms (`form_map`, `delete_table`,
  `insert_paragraph_like`) and fences document text as data before it reaches
  the model. It uses upstream's shared AI channels and settings-wide model
  choice, upstream's project chat persistence, and the suite's theme tokens.
  File > Save As (Ctrl+Shift+S) picks the format by file type; every `.hwp` is
  written so Hangul 2005 opens it too (compressed streams re-packed with a 4 KB
  window and Hangul's CRC32/size trailer, `apps/hwp/src/main/hwp5-legacy.ts`),
  while `.hwpx` needs Hangul 2010 or later.
  A save keeps the user's original as `<name>.bak` before the app's first overwrite of an
  existing file in a session, refuses bytes that are not the format the file name says, and
  checks the Hangul 2005 re-pack (compound file, deflate streams, CRC32 + size trailers) before
  writing it, falling back to the bytes rhwp wrote if it does not check out.
- **Document-style wiki** (`packages/doc-styles`, pages in
  `apps/hwp/resources/doc-styles`, packaged as `modules/hwp-doc-styles`):
  markdown pages with measured role values for Hangul, Word and PowerPoint
  document types. The assistants read the wiki before writing a new document
  and fall back to writing it themselves when no page fits:
  - Hangul: `list_document_styles`, `read_document_style`,
    `create_styled_document`, `export_document_styles`;
  - Word: `write_styled_document` builds the blocks as editor nodes that carry
    the role's paragraph and run formatting (including the East Asian font) and
    inserts them in one step (one undo, tracked as insertions only);
  - PowerPoint: the wiki's deck types are offered to `generate_deck` as
    `wiki:<id>` style templates (a Style Skill plus a layout skeleton), so the
    upstream deck pipeline composes the deck in the organization's colors,
    fonts, sizes and title positions.
- **Work wiki** (`packages/work-wiki`):
  - **What is kept:** every document saved in the seven editors (Hangul, Word, PowerPoint,
    Excel, PDF, Markdown, HTML), files dropped into `raw/sources/`, and durable points from chat
    are learned into a small wiki of works (업무), working methods (작업 방식) and clients (기관).
  - **Saved documents for LLM Wiki:** a saved document is also copied as it is into
    `raw/sources/genoffice-saved/` (Hangul as Markdown text) under a name no other source uses,
    replaced only when its content changed and at most once an hour, so LLM Wiki learns it too.
    A changed source is rewritten: LLM Wiki drops the pages only it produced and ingests it
    again. On by default; Settings › Work wiki can switch it off, and the first copy shows a
    one-time notice.
  - **Folder:** the LLM Wiki folder format, `Documents\GenOffice 업무위키` by default. Our pages
    live in `wiki/work`, `wiki/methods` and `wiki/clients`; LLM Wiki owns the rest.
  - **Bundled LLM Wiki:** the Windows installer carries a modified [LLM Wiki](https://github.com/nashsu/llm_wiki)
    (GPL-3.0) as a separate program in `resources/llm-wiki/`, with its license and the exact
    source location. It runs hidden while GenOffice runs, learns the files the user adds
    (File menu or Home: add material), and stops when GenOffice quits. Its settings are seeded
    from GenOffice's AI settings. The assistants search both wikis through one `wiki_search`
    (pages are named by path, e.g. `work/koica-health`, `entities/koica`).
  - **How it learns:**
    - The first save sends an outline digest; later saves send only the changed paragraphs.
    - A plan call and 1–3 merge calls (thinking off) keep the pages under their caps.
    - Code maintains the work page's related-documents list.
  - **How the assistants use it:** every AI panel (all seven editors) gets a catalog built for
    the newest message (matching pages first, then the wiki's categories, within 3,000 chars;
    earlier catalogs are removed from the history), plus `wiki_search`, `wiki_read`,
    `wiki_index` and `wiki_remember`. Wiki text is fenced as data.
  - **Index:** the bundled LLM Wiki builds its index from the pages on disk instead of having the
    model rewrite it: a top `wiki/index.md` (at most 4,000 chars) and one list per category in
    `wiki/index/`, split into groups and parts when large. Prompts get the part of the index
    that matches what they read.
  - **Settings:** on/off and the folder, in Settings → AI media.
- **Public bid proposals**: wiki pages for a Hangul technical proposal
  (`bid-proposal`) and an A4-landscape PowerPoint proposal
  (`deck-bid-proposal`); PowerPoint pages may carry deck-type rules, and an A4
  wiki deck type makes `generate_deck` build A4-landscape slides. The assistants
  read an attached RFP (제안요청서) and follow its table of contents, writing
  rules and evaluation items, and leave placeholders instead of inventing facts
  about the bidder.
- **Hangul attachments**: `.hwp`/`.hwpx` attachments are read through the
  bundled rhwp CLI (`export-text`) in every assistant, and the Hangul assistant
  gains an attach button and `read_attachment`.
- **LiteLLM provider and organization defaults**: a `litellm` provider
  (OpenAI-compatible base URL plus a per-user virtual key, models from the
  proxy's `/models`). A company build sets `OPEN_GENOFFICE_LITELLM_URL` and
  `OPEN_GENOFFICE_LITELLM_MODEL` at packaging time; the values ship as
  `org-defaults.json` and seed the AI settings on a first run only. No internal
  address is stored in the repository. In such a build the LiteLLM model is fixed to the
  build's model: Settings shows it read-only without the proxy's list, and a different stored
  LiteLLM model is rewritten at startup.
  Settings › AI model offers LiteLLM, Codex and own API keys as three connection modes;
  the LiteLLM card prefills the build's address (also on an existing install) and defaults to
  `deepseek-flash`.
- **Scanned PDFs:** the Windows installer carries Tesseract with Korean and English data
  (`tools/fetch-tesseract.mjs`, pinned and hash-checked); LLM Wiki reads scanned PDFs with it, so
  nothing extra is installed.
- **Codex connection:** the Windows installer carries the unmodified Codex CLI (Apache-2.0,
  pinned and integrity-checked by `tools/fetch-codex-cli.mjs`) in `resources/codex/`; Settings
  can sign in to it and connect, and the work wiki can learn through it.
- **docx-engine**: an explicit zero space-before is written back on save, like
  space-after.
- **Independent identity**: app id `com.sergedoub.opengenoffice`, product and
  installer name Open GenOffice, its own dev userData folder, Open GenOffice
  icons; the update feed comes from `OPEN_GENOFFICE_UPDATE_URL` only (HTTPS,
  never a Genspark feed), and the manual download page is this fork's releases.
- **Windows packaging**: `OPEN_GENOFFICE_WIN_SIDECAR_TARGET` selects the cargo
  target the Sheets sidecar is taken from (for example the MSVC target on a
  build machine without the GNU toolchain).

- **Home Quick Look** (ported from IeumOffice, Apache-2.0): Space on a Home file row shows a
  preview (thumbnail, structured text, tables, slides, images); ↑/↓ step, Enter opens. Its
  Explorer/desktop keyboard hook, the C# helper and the tray mode are not included.
- **Split view** (ported from IeumOffice, Apache-2.0): two documents side by side in one window
  (drag a tab to the right or bottom edge, or the tab menu), a draggable divider, one AI panel
  for the focused pane, a prompt before a save overwrites what the other copy of the same file
  saved, and the arrangement restored on the next launch. The Hangul editor's part is
  re-implemented for this app's editor; IeumOffice's mind map and help-tab parts are not included.
- **PDF annotation list, selection shortcuts and per-PDF notes** (ported from IeumOffice,
  Apache-2.0): H/U/S/N on the selection bar (plus a memo button), an Annotations sidebar view
  listing saved and unsaved marks with the text under them (filters, Markdown/Word export), and
  a Markdown note per PDF that list items can be added to without leaving the PDF. The link
  between a PDF and its note is kept by path in this app; IeumOffice's reading assistant (AI
  highlights, passage cards, side-by-side translation) is not included.

Features of the August fork that upstream now provides itself (bring-your-own-
key providers including DeepSeek, GLM, Kimi, MiniMax, OpenRouter and a custom
endpoint, Codex, DeepSeek V4 names) use upstream's implementation. Not carried
over: the per-document model picker, the bundled Codex app-server and its
sign-in card, the thinking box, and encrypted key storage (upstream stores keys
in `ai-settings.json`; see the migration plan in `docs/superpowers/plans`).
