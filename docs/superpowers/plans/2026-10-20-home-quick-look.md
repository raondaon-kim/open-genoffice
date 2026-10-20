# Home Quick Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Space on a Home file row shows an overlay preview (embedded thumbnail, start of the
text, or the image); Space/Esc closes, ↑/↓ steps, Enter opens.

**Architecture:** A main-process `quickLook(path)` builds a payload (image or thumbnail data URL,
text excerpt) with a small cache, exposed as `home:quick-look`. A `QuickLook` overlay component
in the Home renderer fetches and shows it and owns the keys; Home rows hand it their list.

**Tech Stack:** TypeScript, Electron IPC, React 19, jszip, cfb, Vitest (jsdom for UI).

**Spec:** `docs/superpowers/specs/2026-10-20-home-quick-look-design.md`

## Global Constraints

- Images ≤ 8 MB (png, jpg, jpeg, gif, webp, bmp; no SVG); thumbnails ≤ 2 MB, png/jpeg by magic
  bytes; text ≤ 6,000 characters; extractor limit 64 MB; cache 20 entries keyed path+size+mtime.
- Docs and comments English-only (CJK only inside string tables); CSS tokens only.
- Home never opens a file on Space; Space is ignored in text inputs and on missing-file rows.

## Review Focus

1. Space while typing in the search box or a rename input must type a space, not preview.
2. Fast ↑/↓ through a long list shows the reply for the file now selected, never a late one.
3. A huge or broken file (corrupt zip, truncated hwp) shows "could not read", the overlay stays
   usable, and the main process does not hang.
4. Closing returns keyboard focus to the row that was previewed.
5. Dark theme: overlay, text and borders stay readable.

---

### Task 1: `quickLook` in the main process

**Files:** Create `apps/shell/src/main/quick-look.ts`, `apps/shell/tests/quick-look.test.ts`;
modify `apps/shell/package.json` (devDependencies `cfb`, `jszip` — bundled into main).

**Produces:** `quickLook(path: string, deps?: { extractText?: typeof extractText }): Promise<QuickLookPayload>`,
`clearQuickLookCache()`, type `QuickLookPayload` (exported from `apps/shell/src/shared/home-api.ts`
so the renderer shares it).

- [ ] **Step 1: tests** — temp dir fixtures built in the test:
  - a 1×1 PNG file → `image` starts with `data:image/png;base64,`, no `text`;
  - a docx-shaped zip (`word/document.xml` + `docProps/thumbnail.jpeg` with JPEG magic) and an
    injected `extractText` returning "Hello" → `image` is `data:image/jpeg…`, `text` "Hello";
  - an hwpx-shaped zip with `Preview/PrvImage.png` → png thumbnail;
  - an HWP5 OLE file written with `CFB.utils.cfb_new()` + `cfb_add(…, 'PrvImage', png)` → png
    thumbnail;
  - a `.txt` whose extracted text is 10,000 chars with `[page 1]` lines and 4 blank lines in a
    row → `text.length === 6000`, `truncated`, no `[page`, no triple newlines;
  - `.exe` → ok, no image, no text;
  - missing path → `{ ok: false, error: 'missing' }`;
  - extractor throws → ok with no text (thumbnail still shown when present); zip that is not a
    zip → ok, no image;
  - cache: second call with the same mtime does not call the extractor again; after `utimes`
    it does.
- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3: implement** (sketch):

```ts
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}
const MAX_IMAGE = 8 * 1024 * 1024,
  MAX_THUMB = 2 * 1024 * 1024,
  MAX_TEXT = 6000,
  CACHE = 20
const OOXML = new Set(['docx', 'xlsx', 'pptx'])
function sniff(b: Uint8Array): string | null // png 89 50 4E 47 / jpeg FF D8 FF
async function thumbnailOf(path: string, ext: string): Promise<string | undefined>
// ooxml: JSZip.loadAsync(bytes) → docProps/thumbnail.(jpeg|jpg|png); hwpx: Preview/PrvImage.png;
// hwp: CFB.read(bytes, { type: 'buffer' }) → CFB.find(cfb, 'PrvImage'); size + sniff gate; errors → undefined
function tidy(text: string): { text: string; truncated: boolean }
// drop /^\[page \d+\]\s*$/gm, collapse \n{3,} → \n\n, trim, cut at MAX_TEXT
export async function quickLook(path, deps = {}): Promise<QuickLookPayload>
// stat (ENOENT → missing); cache by `${path}|${size}|${mtimeMs}`;
// image ext → data URL when ≤ MAX_IMAGE; else thumbnailOf + extractText (kind 'text' only);
// any other exception → { ok: false, error: 'unreadable' }
```

- [ ] **Step 4:** PASS; `npm run typecheck -w @genoffice/shell`.
- [ ] **Step 5:** commit `feat(shell): Quick Look payloads for Home (thumbnail, text, image)`.

### Task 2: IPC and preload

**Files:** `apps/shell/src/shared/home-api.ts` (type + `quickLook: 'home:quick-look'` + API
method), `apps/shell/src/main/index.ts` (handler), `apps/shell/src/preload/index.ts`.

- [ ] Handler: `ipcMain.handle(HOME_CHANNELS.quickLook, (_e, path: unknown) => typeof path === 'string' && path && path.length <= 4096 && isAbsolute(path) ? quickLook(path) : { ok: false, path: String(path ?? ''), name: '', error: 'unreadable' })`.
- [ ] Preload: `async quickLook(path) { return (await ipcRenderer.invoke(HOME_CHANNELS.quickLook, path)) as QuickLookPayload }`.
- [ ] Typecheck shell; commit `feat(shell): home:quick-look channel`.

### Task 3: `QuickLook` overlay and labels

**Files:** Create `apps/shell/src/renderer/src/QuickLook.tsx`,
`apps/shell/src/renderer/src/quick-look-strings.ts`, `apps/shell/tests/quick-look-ui.test.ts`.

**Produces:** `QuickLook({ items: { path: string; name: string; ext: string }[]; index: number;
lang: Lang; onIndex(i: number): void; onOpen(path: string): void; onClose(): void })`.

- [ ] **Step 1: tests (jsdom, `window.aiOffice.quickLook` stubbed):** text payload renders name,
      text and "showing the beginning" when truncated; image payload renders `<img>`; error
      payloads render their label; Esc and Space call `onClose`; ArrowDown calls `onIndex(1)`,
      ArrowUp at 0 does nothing, ArrowDown at the end does nothing; Enter and the Open button call
      `onOpen(path)`; a slow first reply arriving after the index changed is not shown; every label
      exists for the 21 languages.
- [ ] **Step 2:** FAIL. **Step 3:** implement (dialog with `role="dialog"`, `aria-modal="true"`,
      `aria-labelledby`; keydown on the dialog; focus the dialog on mount; request sequence counter).
      Labels: `open, close, loading, unsupported, missing, tooLarge, unreadable, truncated, previous, next`.
- [ ] **Step 4:** PASS; commit `feat(shell): Quick Look overlay for Home`.

### Task 4: Home wiring and styles

**Files:** `apps/shell/src/renderer/src/Home.tsx`, `apps/shell/src/renderer/src/home.css`.

- [ ] `renderFileRow` / `renderSearchRow`: `onKeyDown` Space (target is the row, not missing) →
      `preventDefault()`, open the overlay with the row's list; `onMouseEnter/Leave` remember the
      hovered row and its list. A `keydown` listener on Home: Space with no overlay, no focused
      row/input/textarea/contenteditable and a hovered row → open for it.
- [ ] State `{ items, index } | null`; `onIndex` also focuses that row (`data-path` lookup);
      `onClose` restores focus to the row; `onOpen` → `window.aiOffice.openPath`.
- [ ] Lists: global rows use the list rendered (`renderFileRow(entry, 'global')` call site's
      array), folder rows `sortedFiles`, search rows the current page hits.
- [ ] CSS: `.quick-look-backdrop`, `.quick-look` (centred, max 860×80vh, radius, shadow token),
      header, body (thumbnail max-height 50vh, text `white-space: pre-wrap`, scroll), tokens only.
- [ ] Typecheck + shell suite (minus the known Windows files); commit
      `feat(shell): Space previews Home files`.

### Task 5: Built-app check

- [ ] Build shell; driver with a temp profile and a folder of samples (pdf, docx with thumbnail,
      hwpx, png, txt): Space on a focused row, Space on a hovered row, ↓ twice, Esc, Enter opens a
      tab; screenshots light and dark. Expected: payload shown per type, no tab opened by Space.
