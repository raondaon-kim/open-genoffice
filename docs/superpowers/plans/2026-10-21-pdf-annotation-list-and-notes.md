# PDF annotation list, selection shortcuts and per-PDF notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** H/U/S/N on the PDF selection bar, an Annotations sidebar view with filters and
Markdown/Word export, and a Markdown note per PDF that list items can be added to.

**Architecture:** Port IeumOffice's code (pblsketch/openoffice, remote `ieum`) with
`git show <sha>:<path>` into this app's paths, removing passage cards, AI highlights and
`packages/pdf-structure`. The list is renderer-only (its own pdf.js scan). The note spans
three processes: the PDF main process owns the link store and builds the inserted text, the
shell opens or finds the note's Markdown tab, and the Markdown editor appends queued text.

**Tech Stack:** Electron (WebContentsView), React 19, TypeScript, pdf.js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-pdf-annotation-list-and-notes-design.md`

## Global Constraints

- Docs and comments English-only (`npm run check:english-comments`); renderer CSS uses theme
  tokens only (`npm run check:theme-colors`); Prettier and lint clean.
- Every new PDF string key has all 21 languages (`apps/pdf/tests/i18n-strings.test.ts`); take
  the translations from IeumOffice's `apps/pdf/src/renderer/i18n/{annot-panel,notes,reading}/*`.
- Ported files keep a first-line comment naming their IeumOffice source commit.
- Add to note never writes the note file and never activates the note tab; Open note never
  overwrites an existing file.
- Known Windows-only test failures are not regressions (shell `default-app`, `folder-tree`,
  `headless-export`, flaky `update-resume`; sheets `promote-file-atomically`; pdf
  `generated-output`, `text-insert-fallback`; markdown `image-export`; electron-utils
  `default-save-dir`, `dialog-memory`; docs `protect-dialog` under load).

## Review Focus

1. Shortcut keys reaching a text field that has focus while the bar is still up (note draft
   card, AI composer, search box, form field), and IME composition: the key must type, not mark.
2. Text under markups on rotated pages and quads in any corner order: the list shows the
   right words.
3. A document with hundreds of pages or no text layer (scans): the list loads without
   freezing and a closed or switched document cancels the scan.
4. Note paths with spaces, parentheses, Korean names, or on another drive: the page link in
   the note opens the PDF.
5. Add to note when the note is open in a detached window, in the other split pane, or its
   file was deleted since it was linked.

---

### Task 1: Selection-bar shortcuts and the Memo button

**Files:**

- Create: `apps/pdf/src/renderer/selection-shortcuts.ts` (from
  `ieum/main:apps/pdf/src/renderer/reading/shortcuts.ts`)
- Modify: `apps/pdf/src/renderer/App.tsx` (bar render ~8426-8495; a keydown effect next to
  the global handler ~5794)
- Modify: `apps/pdf/src/renderer/i18n/strings.ts` (memo button key)
- Test: `apps/pdf/tests/selection-shortcuts.test.ts` (from IeumOffice
  `apps/pdf/tests/reading-shortcuts.test.ts`, 20f27eb5)

**Interfaces:**

- Produces: `type SelectionBarAction = 'highlight' | 'underline' | 'strikeout' | 'note'`;
  `selectionBarKey(e: SelectionBarKeyEvent, ctx: { visible: boolean; readOnly: boolean }):
SelectionBarKeyVerdict | null`; `labelWithKey(label: string, action: SelectionBarAction):
string`; `isEditableTarget(target: EventTarget | null): boolean`.

- [ ] **Step 1:** Port the test, dropping the `explain`/`translate`/`ask` cases; add:
      `KeyE`, `KeyT` and `Enter` return `null`; a target inside `[contenteditable]` and a
      `TEXTAREA` return `null`; `isComposing: true` returns `null`; `KeyN` on read-only returns
      `{ blocked: 'note', reason: 'read-only' }`.
- [ ] **Step 2:** Run `cd apps/pdf && npx vitest run tests/selection-shortcuts.test.ts`.
      Expected: FAIL, module not found.
- [ ] **Step 3:** Port `shortcuts.ts` with the four actions only.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Wire App.tsx: a `keydown` listener active while `selPopup !== null` calls
      `selectionBarKey`; `highlight`/`underline`/`strikeout` call `applyMarkup(type)`; `note`
      opens the note draft (`setNoteDraft({ origIdx, at })`) at the end of the selection's last
      quad in PDF space, then clears `selPopup`; a blocked verdict shows the bar's existing
      read-only reason. `preventDefault` only when an action ran. Add a **Memo** button to the bar
      (hidden when `readOnly`, same `onMouseDown` preventDefault); button `data-tip` and
      `aria-label` use `labelWithKey`.
- [ ] **Step 6:** Run `cd apps/pdf && npx vitest run tests/selection-shortcuts.test.ts
tests/i18n-strings.test.ts` and `npx tsc --noEmit -p apps/pdf/tsconfig.json`. Expected: pass,
      no errors.
- [ ] **Step 7:** Commit `feat(pdf): H/U/S/N shortcuts and a memo button on the selection bar`.

### Task 2: Annotation list model (pure)

**Files:**

- Create in `apps/pdf/src/renderer/annot-panel/`: `items.ts`, `scan.ts`, `text-under.ts`,
  `filter.ts`, `export.ts` (from 3c002a56)
- Test: `apps/pdf/tests/annot-panel-items.test.ts`, `annot-panel-text-under.test.ts` (from
  3c002a56)

**Interfaces:**

- Consumes: `annotations.ts` (`LocalMarkup`, `PageGeom`, `pdfToView`, `quadToRect`),
  `note-threads.ts` (`parsePdfDate`, `toSavedNote`, `PdfJsAnnotData`), `CreateDocumentRequest`.
- Produces: `buildAnnotItems(o: AnnotBuildInput): AnnotItem[]`; `scanDocumentAnnots(doc,
...)`, `loadPageTextRuns(doc, origIdx)`; `textUnderQuads(runs, quads): string`;
  `filterAnnotItems`, `sortAnnotItems(items, sort: 'page' | 'created')`, `kindOptions`,
  `colorOptions`, `EMPTY_FILTER`; `annotMarkdown({title, items, t})`, `annotHtml(...)`,
  `openAnnotDocument(...)`. `AnnotItem.kind` is `'highlight' | 'underline' | 'strikeout' |
'note' | 'other'` (no `'card'`).

- [ ] **Step 1:** Port both tests; delete every passage-card case and fixture.
- [ ] **Step 2:** Run `cd apps/pdf && npx vitest run tests/annot-panel-items.test.ts
tests/annot-panel-text-under.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3:** Port the five files: remove the `pdf-structure` and `reading/*` imports, the
      `'card'` kind and its build branch, the `PassageCard` input; keep the category/facet
      extension points only where `filter.ts` needs them to compile.
- [ ] **Step 4:** Run the tests and `npx tsc --noEmit -p apps/pdf/tsconfig.json`. Expected:
      PASS, no errors.
- [ ] **Step 5:** Commit `feat(pdf): annotation list model (scan, text under marks, filters,
export)`.

### Task 3: Annotations sidebar view

**Files:**

- Create in `apps/pdf/src/renderer/annot-panel/`: `AnnotPanel.tsx`, `AnnotPanelHost.tsx`,
  `AnnotFlash.tsx` (from 3c002a56)
- Create: `apps/pdf/src/renderer/i18n/strings-annot.ts` (per-language records spread into
  each language of `strings.ts`, like `fillFormStringsFor`)
- Modify: `apps/pdf/src/renderer/App.tsx` (sidebar union ~320 → `'thumbs' | 'outline' |
'annots' | null`; `viewNavGroup` ~6220 button; pane next to outline ~7023; resizer
  condition ~7175); `apps/pdf/src/renderer/styles.css`
- Test: `apps/pdf/tests/annot-panel-ui.test.ts` (from 3c002a56)

**Interfaces:**

- Consumes: Task 2.
- Produces: `<AnnotPanelHost doc unsavedMarkups drawings annotDeletes noteEdits displayPage
geomOf onActivate ... />` (no `cards`); `useAnnotFlash()`, `<AnnotFlash>`;
  `AnnotPanelProps.renderItemActions?: (item: AnnotItem) => ReactNode` (Task 6 fills it).

- [ ] **Step 1:** Port the UI test without card cases; add: the View tab shows an
      **Annotations** button that toggles the sidebar to `'annots'` and back; replacing `doc`
      while a scan is running discards that scan's results (the list shows the new document's
      items only); a page with no text runs lists its markups with empty text, not an error.
- [ ] **Step 2:** Run `cd apps/pdf && npx vitest run tests/annot-panel-ui.test.ts`. Expected:
      FAIL.
- [ ] **Step 3:** Port the three components without cards; add the sidebar view and button;
      click → `scrollToPage` plus a flash over the item's rect (the `gotoMatch` geometry,
      `pdfRectToCss`), a note item opens its margin thread. The two "open as" menu items call
      `window.pdfApi.createDocument`; without it they show the reason. Copy as Markdown uses
      `navigator.clipboard.writeText(annotMarkdown(...))`. Port the strings into
      `strings-annot.ts` and the CSS (tokens only).
- [ ] **Step 4:** Run `cd apps/pdf && npx vitest run tests/annot-panel-ui.test.ts
tests/i18n-strings.test.ts`, `npm run check:theme-colors`, typecheck. Expected: pass.
- [ ] **Step 5:** Commit `feat(pdf): Annotations sidebar view with filters and export`.

### Task 4: Note link store and note service (PDF main)

**Files:**

- Create: `apps/pdf/src/main/note-links.ts` (new: the store)
- Create: `apps/pdf/src/main/note-link.ts` (from 6c33de7a, adapted)
- Modify: `apps/pdf/src/shared/ipc.ts` (`PDF_CHANNELS.noteOpen = 'pdf:note-open'`,
  `noteInsert = 'pdf:note-insert'`; `PdfNoteOpenRequest`, `PdfNoteInsertRequest` (the
  `'quote'` variant only), `PdfNoteResult`; `PdfApi.noteOpen`, `PdfApi.noteInsert`),
  `apps/pdf/src/preload/index.ts`, `apps/pdf/src/main/pdf-main.ts` (handlers;
  `configurePdfRuntime({ noteHost?: NoteHost })`)
- Test: `apps/pdf/tests/note-links.test.ts` (new), `note-link.test.ts`,
  `note-link-handler.test.ts` (from 6c33de7a)

**Interfaces:**

- Produces:
  - `createNoteLinkStore(file: string): NoteLinkStore` with `get(pdfPath): Promise<string |
null>` (null when the note file is gone), `set(pdfPath, notePath): Promise<void>`,
    `copy(fromPdf, toPdf): Promise<void>` (no-op when `toPdf` already has one),
    `movePdf(oldPath, newPath): Promise<void>`, `moveNote(oldPath, newPath): Promise<void>`.
    Keys are canonical paths (resolved; lower-case on win32). File:
    `join(app.getPath('userData'), 'pdf-note-links.json')`, written atomically.
  - `export function copyPdfNoteLink(from: string, to: string): void`,
    `movePdfNoteLink(oldPath: string, newPath: string): void` from pdf-main (fire-and-forget
    wrappers the shell calls; `movePdfNoteLink` handles both PDF and `.md` paths).
  - `interface NoteHost { openNote(path: string): boolean | Promise<boolean>;
insertIntoNote(path: string, text: string): boolean | Promise<boolean> }`.
  - `noteInsertText(...)` and `defaultNotePath(...)` as in IeumOffice.

- [ ] **Step 1:** Write `note-links.test.ts`: set/get round trip; `get` returns null after
      the note file is deleted; `copy` gives both PDFs the note and does not replace an existing
      link of the target; `movePdf` moves the key; `moveNote` rewrites every entry pointing at the
      old note path; keys match across `C:\A\x.pdf` and `c:/a/x.pdf` on win32.
- [ ] **Step 2:** Port `note-link.test.ts` and `note-link-handler.test.ts`: drop the
      doc-hash fallback and `afterSave` cases and the `'overview'` insert kind; the deps use the
      new store. Keep the link-encoding cases and add one: a PDF named `보고서 (최종).pdf` next to
      the note gives `[p.3](%EB%B3%B4%EA%B3%A0%EC%84%9C%20%28%EC%B5%9C%EC%A2%85%29.pdf#page=3)`.
- [ ] **Step 3:** Run `cd apps/pdf && npx vitest run tests/note-links.test.ts
tests/note-link.test.ts tests/note-link-handler.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement the store; port `note-link.ts` against it (no `hashFile`, no
      `pdf-structure`); register the two handlers in `pdf-main.ts` (the PDF path is the view's
      own open path, never from the renderer; an untitled PDF answers `reason: 'unsaved'`; no
      `noteHost` answers `'unavailable'`); expose them in the preload.
- [ ] **Step 5:** Run the tests and typecheck. Expected: PASS.
- [ ] **Step 6:** Commit `feat(pdf): note link store and note open/insert in the PDF main
process`.

### Task 5: Markdown tab takes appended text

**Files:**

- Create: `apps/markdown/src/main/note-append.ts`, `apps/markdown/src/renderer/note-append.ts`
  (from 6c33de7a)
- Modify: `apps/markdown/src/shared/ipc.ts` (`noteAppendTake: 'markdown:note-append-take'`,
  `noteAppendReady: 'markdown:note-append-ready'`), `apps/markdown/src/preload/index.ts`,
  `apps/markdown/src/main/markdown-main.ts`, `apps/markdown/src/renderer/App.tsx`
- Test: `apps/markdown/tests/note-append.test.ts`, `note-append-editor.test.ts` (from 6c33de7a)

**Interfaces:**

- Produces: `queueMarkdownNoteAppendFor(contents: NoteAppendContents, path: string, text:
string): boolean` (false for an untitled tab or a tab showing another file);
  `appendMarkdownAtEnd(editor, text): boolean`; `joinNoteAppends(texts): string`.

- [ ] **Step 1:** Port both tests as they are.
- [ ] **Step 2:** Run `cd apps/markdown && npx vitest run tests/note-append.test.ts
tests/note-append-editor.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Port the code and wiring; the appended text marks the document dirty and is
      never saved by this path.
- [ ] **Step 4:** Run the tests and typecheck. Expected: PASS.
- [ ] **Step 5:** Commit `feat(markdown): append queued note text at the end of a note tab`.

### Task 6: Shell wiring and the note actions in the PDF editor

**Files:**

- Create: `apps/shell/src/main/pdf-note-tabs.ts` (from `ieum/main`, adapted)
- Modify: `apps/shell/src/main/tab-manager.ts` (`openMarkdownTab(openPath?: string, options?:
{ activate?: boolean })`, default `true`)
- Modify: `apps/shell/src/main/index.ts`: `configurePdfRuntime({ ..., noteHost })`; call
  `movePdfNoteLink(oldPath, newPath)` in `afterFileMoved` (~3225) and in the
  `setPdfRenamedHook` handler; call `copyPdfNoteLink(tab.filePath, target)` in `savePdfAs`
  (~5915) after the copy is written; in the `setPdfRedactionSavedHook` handler (~3565) copy
  from the tab's previous path before `setTabFileFor`. Check the other PDF `setTabFileFor`
  sites (~3518-3573): if the certificate-signed copy uses a different hook, copy there too.
- Create: `apps/pdf/src/renderer/notes/NoteActions.tsx`, `notes/note-requests.ts` (from
  6c33de7a, adapted); modify App.tsx (Open note on the View tab and the panel header; Add to
  note via `renderItemActions` on highlight / underline / strikeout / note items; a toast
  "Added to the note" with an **Open note** action; reason messages)
- Test: `apps/shell/tests/pdf-note-tabs.test.ts` (from `ieum/main`, adapted),
  `apps/shell/tests/tab-manager.test.ts` (activate:false), `apps/pdf/tests/notes-ui.test.ts`
  (from 6c33de7a, trimmed)

**Interfaces:**

- Consumes: Task 4 `NoteHost`, `copyPdfNoteLink`, `movePdfNoteLink`; Task 5
  `queueMarkdownNoteAppendFor`.
- Produces: `NoteTabHost { find(path: string): NoteAppendContents | undefined; focus(path:
string): NoteAppendContents | undefined; openNew(path: string, activate: boolean):
NoteAppendContents | undefined }`; `openNoteTab(host, path)` (focus or open, activated);
  `insertIntoNoteTab(host, path, text)` (find or open **not activated**, then queue).

- [ ] **Step 1:** Tests: `tab-manager.test.ts` — `openMarkdownTab('/n.md', { activate: false
})` adds the tab, keeps the active tab and leaves an existing split unchanged;
      `pdf-note-tabs.test.ts` — insert into an existing tab does not call `focus`; insert with no
      tab calls `openNew(path, false)`; open calls `focus`, else `openNew(path, true)`; a missing
      note file returns null; a note shown in a detached window is found and queued there
      without opening a tab; `notes-ui.test.ts` — Add to note shows on markup and note items
      only, success shows the toast with Open note, `'unsaved'` shows the save-first message.
- [ ] **Step 2:** Run `cd apps/shell && npx vitest run tests/pdf-note-tabs.test.ts
tests/tab-manager.test.ts` and `cd apps/pdf && npx vitest run tests/notes-ui.test.ts`.
      Expected: FAIL.
- [ ] **Step 3:** Implement as in Interfaces; detached windows are found before tabs, as in
      IeumOffice.
- [ ] **Step 4:** Run the tests, typecheck shell and pdf, `check:english-comments`. Expected:
      PASS.
- [ ] **Step 5:** Commit `feat(pdf,shell): open a PDF's note and add list items to it`.

### Task 7: Whole tree, credits, built-app check

**Files:**

- Modify: `README.md`, `MODIFICATIONS.md`, `ACKNOWLEDGMENTS.md` (credit IeumOffice for the
  annotation list, selection shortcuts and per-PDF notes, as for Quick Look)
- Create (untracked): `scripts/drivers/driver.pdf-annots.mjs`

- [ ] **Step 1:** Run `npm run typecheck`, `npm run lint`, `npm run check:english-comments`,
      `npm run check:theme-colors`, Prettier on changed files, and the pdf, markdown, shell,
      electron-utils suites. Expected: green apart from the known Windows-only failures.
- [ ] **Step 2:** Credits; commit `docs: credit IeumOffice for the PDF annotation list and
notes`.
- [ ] **Step 3:** `npm run build:all`, then the driver on a temp profile (work wiki off):
      select text → H/U/S/N; list shows saved + pending marks with their text; filter by kind
      and color; click → scroll + flash; Copy as Markdown; Open as Word document opens a Docs tab;
      Open note (dialog → file next to the PDF → tab), Add to note keeps the PDF active and the
      note tab shows the appended text unsaved; untitled PDF shows save-first; light and dark
      screenshots. Expected: every check true.
