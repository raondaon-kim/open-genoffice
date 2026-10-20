# Home Quick Look (spacebar preview)

## Goal

On Home, look inside a file without opening a tab: press Space on a file row and a preview
appears over Home — the document's own first-page thumbnail when it carries one, the start of
its text, or the image itself. Space or Esc closes it, ↑/↓ steps through the list, Enter opens
the file. Inspired by IeumOffice 0.12.2's Quick Look (Apache-2.0); written for this codebase.

## Decisions

- Home only (recent files, folder file list, search results). No Windows Explorer / desktop
  hook: a system-wide keyboard hook is a security-sensitive surface and draws antivirus alerts.
- The previewed row is the keyboard-focused row; when no row has focus, the row under the mouse
  pointer. (A click opens the file today, so there is no row selection to use.)
- The preview is an overlay inside the Home renderer, not a separate window.
- Text first: spreadsheets and decks show their extracted text, not a grid or slide strip.

## User flow

1. A file row has focus (Tab/↑↓) or the pointer is over it; the user presses Space.
2. An overlay opens over Home: header (type badge, name, size, modified date, "Open" button,
   close button) and a body (thumbnail and/or text, or the image).
3. ↑/↓ moves to the previous/next file of the same list and the preview follows; the row focus
   follows too, so closing leaves the user where they are.
4. Space or Esc closes; Enter or "Open" opens the file (and closes the overlay).
5. Space is ignored while typing (search box, rename input) and on rows of missing files.

## Main process

`apps/shell/src/main/quick-look.ts`

```ts
type QuickLookPayload =
  | {
      ok: true
      path: string
      name: string
      ext: string
      sizeBytes: number
      mtimeMs: number
      /** data: URL — the image file itself, or the thumbnail the document carries */
      image?: string
      /** start of the document's text, whitespace-tidied */
      text?: string
      /** text was cut at the preview limit */
      truncated: boolean
    }
  | { ok: false; path: string; name: string; error: 'missing' | 'too-large' | 'unreadable' }
```

- Images (png, jpg, jpeg, gif, webp, bmp) ≤ 8 MB → `image` as a data URL. SVG is excluded.
- Embedded thumbnails (≤ 2 MB, png/jpeg only, checked by magic bytes):
  - docx / xlsx / pptx: zip entry `docProps/thumbnail.jpeg|jpg|png`.
  - hwpx: zip entry `Preview/PrvImage.png`.
  - hwp (HWP5, OLE compound file): stream `PrvImage`.
- Text via the existing `file-index/extract.ts` `extractText` (Hangul through rhwp, PDF and
  Office through `@genoffice/file-parse`, HTML stripped). Kept: first 6,000 characters, runs of
  blank lines collapsed, `[page N]` markers removed; `truncated` when cut.
- Files over 64 MB (the extractor's limit) get name and size only (`text` absent).
- A missing file → `{ ok: false, error: 'missing' }`; an exception → `'unreadable'`.
- Cache: the last 20 payloads keyed by path + size + mtime.

IPC: `HOME_CHANNELS.quickLook = 'home:quick-look'` (path: unknown → payload; non-string or
relative paths get `unreadable`); preload `aiOffice.quickLook(path)`.

## Renderer

- `apps/shell/src/renderer/src/QuickLook.tsx`: overlay component
  `QuickLook({ items, index, lang, onIndex, onOpen, onClose })` where `items` is the list the
  preview walks (`{ path, name, ext }[]`). It fetches `aiOffice.quickLook(items[index].path)`
  (ignoring stale replies), shows a loading state, and handles Space/Esc/↑/↓/Enter. Focus moves
  into the overlay (dialog semantics: `role="dialog"`, `aria-modal`, labelled by the file name)
  and returns to the row on close.
- Home: rows of `renderFileRow` and `renderSearchRow` handle Space (and remember the hovered
  row); a Home-level Space handler covers the hovered-row case. The overlay is given the list
  the row belongs to (the sorted folder list, the recent list, or the search hits).
- Labels in `quick-look-strings.ts` (`Record<Lang, …>`, all 21 Home languages): open, close,
  loading, no preview for this format, file missing, too large to preview, could not read,
  "showing the beginning", previous/next file.
- Styles in Home's CSS with design tokens only; dark mode follows Home's theme.

## Error handling

- The overlay never throws: an IPC rejection shows "could not read".
- Navigating fast: only the latest request's reply is shown.

## Testing

- Unit (main): image file, docx thumbnail, hwpx thumbnail, hwp5 thumbnail, text truncation and
  tidy, unsupported format, missing file, cache hit and refresh after mtime change.
- Unit (renderer, jsdom): overlay renders text/image/errors, Space/Esc close, ↑/↓ call
  `onIndex` within bounds, Enter calls `onOpen`, stale replies ignored, labels for 21 languages.
- Built app: Home with a folder of sample files; Space on a focused row and on a hovered row,
  ↑/↓, Enter; screenshots per format.
