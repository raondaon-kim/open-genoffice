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
  address is stored in the repository.
- **docx-engine**: an explicit zero space-before is written back on save, like
  space-after.
- **Independent identity**: app id `com.sergedoub.opengenoffice`, product and
  installer name Open GenOffice, its own dev userData folder, Open GenOffice
  icons; the update feed comes from `OPEN_GENOFFICE_UPDATE_URL` only (HTTPS,
  never a Genspark feed), and the manual download page is this fork's releases.
- **Windows packaging**: `OPEN_GENOFFICE_WIN_SIDECAR_TARGET` selects the cargo
  target the Sheets sidecar is taken from (for example the MSVC target on a
  build machine without the GNU toolchain).

Features of the August fork that upstream now provides itself (bring-your-own-
key providers including DeepSeek, GLM, Kimi, MiniMax, OpenRouter and a custom
endpoint, Codex, DeepSeek V4 names) use upstream's implementation. Not carried
over: the per-document model picker, the bundled Codex app-server and its
sign-in card, the thinking box, and encrypted key storage (upstream stores keys
in `ai-settings.json`; see the migration plan in `docs/superpowers/plans`).
