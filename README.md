<img src="assets/open-genoffice-icon-1024.png" alt="Open GenOffice icon" width="96" />

# Open GenOffice

> An independent fork of
> [GenOffice](https://github.com/genspark-ai/genoffice) that keeps Genspark
> available while adding first-class bring-your-own-provider support.

An AI-native office suite for macOS and Windows: word processor, spreadsheet,
presentations, PDF, and Hangul (`.hwp`/`.hwpx`) — five Electron apps sharing one
engine layer, built around AI editing as a first-class workflow rather than a
bolted-on chat box.

## Download

Signed installers built from `main`:

- **macOS** (Apple Silicon): [OpenGenOffice-0.4.0-arm64.dmg](https://github.com/sergedoub/open-genoffice/releases/download/v0.4.0/OpenGenOffice-0.4.0-arm64.dmg)
- **Windows** (x64): [OpenGenOfficeSetup-v0.4.0-x64.exe](https://github.com/sergedoub/open-genoffice/releases/download/v0.4.0/OpenGenOfficeSetup-v0.4.0-x64.exe)

Other versions are on the [Releases](https://github.com/sergedoub/open-genoffice/releases) page.

## What this fork changes

- Keeps Genspark as a built-in provider and migration default.
- Uses your ChatGPT plan through Codex by default: the official Codex
  app-server ships with the app, and Settings › AI signs in with ChatGPT (browser
  or device code) or an OpenAI API key, shows the account and plan, and signs
  out. API-key providers keep working alongside it.
- Adds OpenRouter, Anthropic, OpenAI, DeepSeek, GLM (Z.ai), Kimi (Moonshot),
  and MiniMax with user-supplied API keys.
- The AI panels show what the model is thinking in a collapsible "Thinking" box:
  live while it thinks, one line afterwards. Codex shows its reasoning
  summaries; DeepSeek (`deepseek-flash`, `deepseek-v4-pro`) shows its reasoning
  and gets it back on the next request, so tool-heavy edits keep their chain of
  thought.
- Adds a Hangul (`.hwp`/`.hwpx`) module as a fifth shell tab: open existing
  documents, create new blank documents from Home, and ask the AI to read,
  edit, format, fill forms in, or generate documents. The assistant reads the
  open document through the bundled rhwp engine (structure, page text, search
  coordinates, table grids, form fields) and edits existing text, tables,
  footnotes/headers and paragraph formatting as verified file edits with a
  one-step undo; quoted document text is fenced as data before it reaches the
  model.
- "HWP from a form" on Home opens a copy of any `.hwp`/`.hwpx` form you have as
  a new, untitled document (the form file itself is never written to; Save As
  proposes `<form>_작성`), and the assistant fills it: `form_map` reads every
  form field, table cell and paragraph in one call, `delete_table` removes
  guidance tables, and forms whose layout the engine cannot round-trip exactly
  are checked by their field/table/paragraph summary instead.
- The Hangul AI can _create_ rich documents (reports, syllabi, announcements)
  — text **and real tables** in one file — by generating `.hwpx` through the
  HwpForge engine (MIT/Apache-2.0), and ships a built-in K-12 school-form
  pack (`가정통신문`, lesson plans, performance-assessment rubrics, …).
- Encrypts provider keys through Electron `safeStorage`; raw keys remain in the
  main process and never enter office documents.
- Adds one suite-wide default plus sticky per-document provider/model routes.
- Lets users change models between prompts without silently falling back to a
  different provider.
- Isolates the application identity and update channel from upstream builds.

See [MODIFICATIONS.md](MODIFICATIONS.md) for the derivative change record and
[docs/upstream-provenance.md](docs/upstream-provenance.md) for ancestry and
upstream maintenance.

### Screenshot

![Open GenOffice Docs with the OpenRouter model selector open](assets/open-genoffice-model-selector.jpeg)

## Upstream and acknowledgments

This project exists because Mainfunc released GenOffice under Apache-2.0. We
appreciate the substantial editor, file-format, rendering, and application work
they made available. See [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) for full
credit and links to the upstream project.

Open GenOffice is not affiliated with or endorsed by Mainfunc, Genspark,
Apache OpenOffice, or Microsoft. GenOffice and Genspark are trademarks of
Mainfunc, Inc.; other names belong to their respective owners.

## Apps

| App           | Product                   | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/docs`   | **Open GenOffice Docs**   | `.docx` word processor. Byte-preserving round trip: only dirty paragraphs are regenerated (paragraph patch), everything else in the original file is kept byte-for-byte, so opening and saving never breaks layout in Word. Paginated view whose line metrics reproduce the original document's layout, tracked changes, comments, styles, equations, ink.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/sheets` | **Open GenOffice Sheets** | `.xlsx` spreadsheet. UI built on the open-source [Univer](https://github.com/dream-num/univer) core (Apache-2.0) with a large layer of in-house extensions; xlsx import/export runs through an in-house Rust sidecar (calamine + IronCalc), charts are rendered in-house (Konva), plus pivot tables, slicers, conditional formatting, and formula tracing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/slides` | **Open GenOffice Slides** | `.pptx` presentations. In-house pptx parse/render/edit engine with masters, charts, cropping, ink, and text shaping (HarfBuzz metrics).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/pdf`    | **Open GenOffice PDF**    | PDF viewer/editor on pdf.js + pdf-lib: annotations, forms, outlines, stamps, signatures, page operations, print.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/hwp`    | **Open GenOffice HWP**    | Hangul word processor (`.hwp`/`.hwpx`) built on the MIT-licensed [rhwp](https://github.com/edwardkim/rhwp) engine (Rust + WASM; the rhwp studio UI is built from the pinned rhwp release at build time and bundled with the app, so Hangul editing works offline). Opens and edits existing documents (text, formatting, tables, save-back in the source format) and creates new blank documents from Home. The AI assistant reads the open document through the bundled rhwp CLI (overview, page text, search with edit coordinates, table grids, 누름틀 fields), edits existing paragraphs, tables, footnotes, headers/footers and paragraph formatting as verified file edits (snapshot → `rhwp edit` chain → reload; `undo_ai_edit` reverts), fills 누름틀 form fields, and generates whole documents — including real tables — into a new tab via the [HwpForge](https://github.com/ai-screams/HwpForge) generator (Markdown → `.hwpx`). Includes a built-in Korean K-12 school-form pack (가정통신문, 교수·학습과정안, 수행평가·루브릭, 상담일지, 회의록, 출장복명서, 주간 학습 안내장, 방과후 운영계획) that starts from the AI panel. |
| `apps/shell`  | **Open GenOffice**        | The suite shell: home screen and tabbed hosting of the editors. Auto-update is optional and disabled unless a derivative update feed is configured at packaging time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Every app embeds the same AI panel: block-granular AI editing with version
snapshots and diffs in docs, a tool-calling agent over workbook/slide/PDF/Hangul
state in the others.

**AI providers.** Genspark remains available through its account sign-in. The
derivative also supports device-local OpenRouter, Anthropic, OpenAI, DeepSeek,
GLM (Z.ai), Kimi (Moonshot), and MiniMax keys, with a suite default and sticky
per-document provider/model routes. Bring-your-own keys are encrypted in the
Electron main process and are not exposed to renderers or stored in office
documents.

**Hangul document creation and editing.** In a Hangul tab, ask the AI to write
a document (e.g. "강의 실라버스 만들어줘") and it produces a finished `.hwpx` —
headings, paragraphs, and real tables with cell text — that opens in a new tab;
the same engine backs the K-12 school-form buttons in the AI panel's empty
state ("문서 양식으로 바로 만들기"). To change an open document, the AI first
reads it through the bundled rhwp engine (`get_document_overview`, `find`,
`read_table`, …) and then applies text, table, element and formatting edits as
a verified file edit: the document bytes are snapshotted, `rhwp edit` runs on
the snapshot, the result is checked against the live document (nobody typed in
between) and reloaded. Every AI edit is one undo step ("AI 편집 되돌리기" in the
panel or the `undo_ai_edit` tool). Text quoted from the document is fenced with
a per-call nonce so it is treated as data, never as instructions.

## Engine packages

All pure TypeScript, no Electron dependency, unit-tested (except the UI kit):

- `packages/docx-engine` — docx parsing → block tree (with `docxIndex`
  anchors and passthrough), OOXML fragment generation, byte-level paragraph
  patching.
- `packages/pptx-engine` / `packages/pptx-render` — pptx model and rendering.
- `packages/file-parse` — text extraction for AI attachments (office formats,
  text formats).
- `packages/agent-core` — the AI agent loop and skill composition shared by
  every app.
- `packages/ai-provider` — provider abstraction and streaming for the model
  backends.
- `packages/ai-search` — Genspark auth + web/image search tools.
- `packages/i18n`, `packages/ui`, `packages/project-store`,
  `packages/electron-utils` — shared i18n core, React UI kit, recent-files
  store, and Electron main-process helpers.

## Development

```bash
npm ci
npm run fixtures     # generate test .docx fixtures
npm run build:hwp-studio  # build the bundled Hangul editor (rhwp studio); needs git + network once, before npm run dev
npm run fetch:rhwp-cli    # download + verify the matching rhwp CLI binary for this platform
npm test             # engine + app unit tests (docs/sheets/slides need no display)
npm run typecheck    # tsc --noEmit across every workspace
npm run dev          # all five editors + shell against Vite dev servers
npm run dev:docs     # a single app (same pattern works per workspace)
npm run dist:mac     # package macOS dmg (regenerates third-party notices)
npm run dist:win     # package Windows nsis installer
```

The sheets app additionally needs Rust. The repository's
`rust-toolchain.toml` pins the tested toolchain; rustup selects it
automatically. `npm run build -w @genoffice/sheets` compiles the sidecar.

Local UI/e2e driver scripts (Playwright + Electron, for local acceptance, not
committed by default) live in [`scripts/drivers/`](scripts/drivers/README.md).

## Architecture notes (docx round trip)

```
open docx ─► archive original by hash (never touched)
          ─► docx-engine parses word/document.xml top-level elements (w:p / w:tbl / …)
          ─► Block tree, each block anchored by docxIndex + original XML slice
          ─► TipTap streaming editor (manual + AI editing, dirty tracking)
save      ─► dirty blocks → OOXML fragments (referencing existing styles only)
          ─► splice into original document.xml (untouched blocks keep original bytes)
          ─► repack zip; all other entries copied byte-for-byte
```

The same philosophy holds in sheets and slides: the original file is the
source of truth, edits are applied as narrow patches, and everything the
editor didn't touch survives the round trip untouched.

## Security

See [SECURITY.md](SECURITY.md) for the process security posture (renderer
sandboxing, IPC validation, external-link gating) and the threat models for
AI-generated content.

## Third-party notices

`npm run notices` regenerates the bundled third-party license summary
(`tools/gen-third-party-notices.mjs`); all runtime dependencies are
MIT/Apache-2.0/OFL, and the bundled fonts (Liberation, Carlito, Caladea, Noto
CJK subsets) are OFL/Apache.

## License

The source published in this repository is licensed under the
[Apache License 2.0](LICENSE). The separately licensed upstream `ee/` subtree
is intentionally not included in Open GenOffice.

The original Mainfunc copyright and attribution are preserved in
[NOTICE](NOTICE). Open GenOffice modifications are identified there and in
[MODIFICATIONS.md](MODIFICATIONS.md). The Apache-2.0 license does not grant
trademark rights.
