# PDF annotation list, selection shortcuts and per-PDF notes — from IeumOffice

## Intent

IeumOffice (pblsketch/openoffice, Apache-2.0, a fork of the same upstream) advertises "PDF
highlighter and memo": select text, press H to highlight, U to underline, N for a memo; every
mark is gathered in a list beside the page so it is easy to find again; marks can be sent to a
Markdown note kept with the PDF. Our PDF editor already makes highlights, underlines,
strikeouts and margin notes, but has no keyboard path from a selection, no place that lists the
marks of a document, and no note. This brings those three pieces over.

In IeumOffice they are part of a larger "PDF reading assistant" (merge 62228930) built on its
`packages/pdf-structure` (AI page reading, translation, EPUB), which this app does not have and
which is out of scope. The three pieces below do not need it once their references to passage
cards and the reading store are removed.

## Goals

1. **Selection shortcuts.** While the selection bar (the popup over a text selection,
   `selPopup` in `apps/pdf/src/renderer/App.tsx`) is up: `H` highlight, `U` underline,
   `S` strikeout, `N` memo. Judged by `KeyboardEvent.code` so they work with the Korean IME
   on; ignored while composing, in editable fields, with Ctrl/Alt/Meta, and on key repeat.
   File edits on a read-only document are refused with the same reason the bar's buttons
   give. Tooltips and accessible names show the key. The bar gains a **Memo** button (it has
   none today); `N` and the button open a note draft at the end of the selection, exactly as
   the note tool's draft card does.
2. **Annotation list.** A third left-sidebar view, **Annotations**, next to Thumbnails and
   Outline (one at a time), switched from the View ribbon tab like the other two.
   - Lists, for the whole document: saved highlights / underlines / strikeouts with the text
     under them; saved notes with their first two lines and reply count; other saved
     annotation kinds (ink, shapes, stamps, free text…) by kind name; and the not-yet-saved
     markups, notes and drawings of this session.
   - Filters by kind, color, page range and text; sorts by page or by creation order.
   - A click scrolls to the mark and briefly flashes it; a note opens its margin thread.
   - Panel menu: **Copy as Markdown**, **Open as Markdown document**, **Open as Word
     document**, each using the currently filtered list, no AI. The two "open" items use the
     existing `createDocument` channel (`apps/pdf/src/shared/ipc.ts`, request
     `{type, title, content}`; docx takes restricted HTML, md takes Markdown).
3. **Per-PDF note.** **Open note** (View tab and the panel header) and **Add to note** (on each
   panel item).
   - The first Open note on a PDF shows a save dialog defaulting to `<PDF stem> <localized
"Note">.md` in the PDF's folder. Choosing an existing file links it as it is (never
     overwritten); a new file is created with a title line. Later, Open note brings that
     note's Markdown tab forward or opens it.
   - Add to note appends to the end of the note's Markdown tab as an unsaved change (the file
     is not written; the user saves in the note tab). The text is IeumOffice's
     `noteInsertText`: a quote of the marked text and a `[p.N](...#page=N)` link to the PDF
     page, relative to the note; for a memo, its text. Only highlight, underline, strikeout
     and memo items get the button (drawings, shapes and stamps have no text to add).
     _(builder check: decided here, following IeumOffice)_
   - **Add to note keeps the PDF in view** (unlike IeumOffice, which activates the note tab
     on every add). If the note has no tab yet, it is opened without being activated, and the
     text is queued for it. A short toast confirms "Added to the note" with an **Open note**
     action. With a split open, nothing is rearranged; a note already showing in the other
     pane updates in place. _(asked and agreed: repeated adds from the list should not pull
     the user away from the PDF, and activating would replace the PDF's pane in a split)_
   - **Open note** activates the note tab under the normal tab and split rules.
   - A PDF that has never been saved answers "Save the PDF first". Outside the shell
     (standalone PDF window) the note actions explain they need the app.

## Non-goals

- AI highlight suggestions, passage cards (explain / translate a passage), side-by-side
  translation, document overview, suggested questions, paragraph citations — all need
  IeumOffice's reading store / AI page reading.
- Re-linking a note after the PDF is moved or renamed outside the app (IeumOffice falls back
  to the document hash from its reading store). Here the link follows Save As and in-app
  renames only.
- Help topics (this app has no help tab).

## Anti-goals

- A shortcut must never fire while the user types: in the AI panel, a note card, the search
  box, a form field, or during IME composition.
- Add to note must never write the note file behind the user's back, and must never touch
  an untitled Markdown tab.
- Opening a note on an existing file must never overwrite it.
- The list must not change what is saved: listing, filtering and exporting are read-only.

## Approach (decided)

Port IeumOffice's code with authorship credited, removing what we do not have, the same way as
the split view: their files are written against the same upstream PDF editor modules we have
(`annotations.ts`, `note-threads.ts`, `DrawLayer.tsx`, `edit-state.ts`, `createDocument`).

| Piece               | IeumOffice source                                                                                                                                       | Adaptation                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Shortcuts           | `apps/pdf/src/renderer/reading/shortcuts.ts` and its App.tsx wiring in `20f27eb5`                                                                       | keep `highlight`, `underline`, `strikeout`, `note`; drop `explain`, `translate`, `ask`; add the Memo button our bar lacks |
| List                | `apps/pdf/src/renderer/annot-panel/*` from `3c002a56` (`scan`, `items`, `text-under`, `filter`, `export`, `AnnotPanel`, `AnnotPanelHost`, `AnnotFlash`) | remove passage-card items and the `pdf-structure` imports; keep the extension points only if used                         |
| Note, PDF side      | `apps/pdf/src/main/note-link.ts`, `renderer/notes/*`, channels in `6c33de7a`                                                                            | link storage below instead of the reading store; drop the hash fallback                                                   |
| Note, Markdown side | `apps/markdown/src/main/note-append.ts`, `renderer/note-append.ts`, channels in `6c33de7a`                                                              | as is                                                                                                                     |
| Note, shell         | the "bring forward or open the note tab, then queue the text" wiring in `6c33de7a`                                                                      | use our `findMarkdownTabByPath` / `openMarkdownTab`                                                                       |

The full-document scan for the list is the panel's own (`scan.ts`, via pdf.js
`getAnnotations` per page), not our lazy per-page `loadSavedAnnots`, because the latter drops
color, author and date of saved markups and only covers visible pages.

**Note link storage (decided):** a small JSON file in userData, `pdf-note-links.json`,
mapping the canonical PDF path to the note path, written by the PDF main process.

- Save As keeps the original open and opens the copy in a new tab (the shell may copy the
  file itself without the PDF main process), so the link is **copied** to the new path, not
  moved: both PDFs share the note. The same for the copy a redaction or certificate signing
  produces. The hook sits where the shell completes those copies. _(decided)_
- In-app moves and renames go through the shell's `afterFileMoved`: moving or renaming a
  linked PDF moves its entry, and moving or renaming a linked note file updates the note path,
  including folder moves and folder renames. _(decided)_
- A link whose note file no longer exists is treated as no link (the next Open note asks
  again). Moves outside the app are not tracked.

## Constraints

- Docs and comments English-only; renderer CSS uses theme tokens only (CI gates
  `check:english-comments`, `check:theme-colors`); Prettier and lint clean.
- PDF strings: every new key needs all 21 languages (`apps/pdf/tests/i18n-strings.test.ts`
  checks key parity, no empty values, same placeholders). IeumOffice's `annot-panel`, `notes`
  and `reading` shards carry translations for the keys we keep; reuse them.
- Markdown strings follow the Markdown app's own i18n rules.
- Sandboxed preloads must bundle workspace packages (see existing preload configs).
- Credit IeumOffice in README / MODIFICATIONS / ACKNOWLEDGMENTS, as for Quick Look and the split
  view.

## Left to the builder

- How the list refreshes on edits and page operations (rotate, delete, reorder), within
  "always reflects the document and the pending edits".
- The flash's look (theme tokens, short and unobtrusive).
- Exact layout of the panel within the existing sidebar width and resizer.

## Testing

- Unit tests come with the ported files (IeumOffice `annot-panel-items`, `annot-panel-text-under`,
  `annot-panel-ui`, `note-link`, `note-link-handler`, `note-append`, `note-append-editor`), trimmed
  to what we keep; new tests for the shortcut judgement (IME, editable targets, modifiers,
  read-only) and the link store (Save As copies it, in-app moves of the PDF or the note update
  it, missing note file means no link).
- Built-app check with a driver: select text → H/U/S/N; list shows saved + pending marks with
  text; filters; click → scroll + flash; Copy/Open as Markdown/Word; Open note (dialog, then
  reuse); Add to note appends unsaved; untitled PDF message; light and dark.
