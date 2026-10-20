# Chat attachments → work wiki ("업무 자료로 추가")

## Goal

A file attached to an AI chat is used only by that conversation today (`read_attachment`). The
user wants to keep such a file as work material with one click from the attachment chip, so it
becomes LLM Wiki pages and every later task can find it — without leaving the chat for Home's
"업무 자료 추가" dialog. The button must look native in every editor.

## Decisions (from the conversation)

- Option A: one small icon button per attachment chip, inside the card on the right. Never
  automatic, no composer-wide toggle.
- A file whose content is already in the wiki is not copied again; the chip shows "already
  added".
- The Hangul chip becomes the same card as the other editors (it is a plain text pill today), so
  the button sits in the same place everywhere. Hangul turns on screen tips like the other
  editors. Drag/drop and paste attachments for Hangul stay out of scope.

## User flow

1. The user attaches files with 📎 (or drop/paste where the editor supports it).
2. A chip whose format the wiki accepts shows the button (book-plus icon, screen tip "업무 자료로
   추가 — 이후 작업에서도 AI가 참고합니다").
3. Click → the button dims while adding → a check icon (tip "업무 자료에 추가됨 — 정리가 끝나면
   AI가 참고합니다", or "이미 업무 자료에 있습니다" for a duplicate).
4. On failure the icon becomes a warning; the tip and the editor's existing notice line say why.
5. The current conversation keeps reading the attachment directly; the wiki serves later tasks
   (LLM Wiki ingests in tens of seconds to ~2 minutes).

The button is hidden when the work wiki is off and for formats the wiki does not take (images,
csv, code files, doc/ppt/xls …). Accepted: hwp, hwpx, docx, pptx, xlsx, pdf, md, txt (same as
Home's dialog).

## Architecture

```
editor chip ── AttachmentWikiButton (@genoffice/ui) ── window.workWiki.addMaterial([path])
                                                              │ wiki:add-material
shell main ── registerWorkWikiIpc ── HWP grant check ── addMaterial(+ dedupe index)
                                                              │
                                    <wiki>/raw/sources/<file> ── LLM Wiki ingests
```

### 1. `packages/work-wiki` (shared contract)

- `WIKI_CHANNELS.status = 'wiki:status'`, `WIKI_CHANNELS.addMaterial = 'wiki:add-material'`.
- `WIKI_MATERIAL_EXTS = ['hwp','hwpx','docx','pptx','xlsx','pdf','md','txt']` and
  `isWikiMaterial(name: string): boolean` (by extension, case-insensitive).
- Types:
  - `WikiMaterialSkip = 'unsupported' | 'too-large' | 'no-text' | 'unreadable' | 'too-many' |
'wiki-off' | 'not-attached'`
  - `WikiMaterialResult = { path: string; status: 'added' | 'duplicate' | 'skipped';
reason?: WikiMaterialSkip }`
- `WorkWikiApi` gains `status(): Promise<{ enabled: boolean }>` and
  `addMaterial(paths: string[]): Promise<WikiMaterialResult[]>`;
  `createWorkWikiPreloadApi` maps both.

### 2. `apps/shell/src/main/add-material.ts`

- `addMaterial({ files, rawSources, extractText, indexPath })` returns one
  `WikiMaterialResult` per input file (input order), with reason codes instead of English text.
- Dedupe: `indexPath` is a JSON file `{ [sha256]: targetPath }` in the wiki's state directory
  (`<userData>/work-wiki/<key>/material-index.json`, outside `raw/` so LLM Wiki never reads it).
  The hash is of the source file's bytes (for Hangul: of the .hwp/.hwpx, not the converted .md).
  If the hash is in the index and its target still exists → `duplicate`, nothing copied. If the
  target was deleted, the file is added again and the index updated. Two identical files in one
  call → the second is `duplicate`. A missing or unreadable index starts empty.
- Existing rules stay: copy docx/pptx/xlsx/pdf/md/txt, convert hwp/hwpx to `<stem>.md`, never
  overwrite (`name (2).ext`), at most 50 files (`too-many` for the rest), 100 MB per file.
- Home's "업무 자료 추가" dialog uses the same function, so it also skips duplicates; its message
  box lists duplicates as "already in the work wiki" (zh/en/ko, like its other lines).

### 3. Shell IPC (`apps/shell/src/main/work-wiki.ts`)

- `wiki:status` → `{ enabled: settings.enabled && engine?.enabled === true }`.
- `wiki:add-material` (paths: unknown):
  - not an array of ≤ 50 strings (each ≤ 4096 chars) → reject (`[]`);
  - wiki off → every path `skipped`/`wiki-off`;
  - a path from an HWP view that was not attached in that view → `skipped`/`not-attached`;
  - otherwise `addMaterial` into `<folder>/raw/sources`.
- Never throws to the renderer; one result per path.

### 4. HWP grant (`apps/hwp/src/main/attachments.ts`)

- HWP already grants picked paths per view. Export
  `hwpAttachmentGate(webContentsId, path): boolean | null` — `null` when the id is not an HWP
  view (the gate does not apply), else whether the path was attached there.
- HWP views are recorded when created (`createHwpView`) and dropped on `destroyed`.
- Docs, Slides, Sheets and HTML have no grants (their `files:read` already reads any accepted
  path the renderer sends); the wiki handler keeps the same trust level: real files only,
  accepted extensions only, size and count limits.

### 5. Shared button (`packages/ui`)

- `AttachmentWikiButton({ path, name, lang, api })`:
  - `api` is `window.workWiki` (may be undefined → renders nothing).
  - Asks `api.status()` once per mount (shared cache with a short TTL so many chips make one
    call); hidden while unknown, when disabled, or when `!isWikiMaterial(name)`.
  - States: idle → adding → added | duplicate | failed(reason). Clicking in `failed` retries.
  - Renders `<button type="button" className="ai-attachment-wiki-btn" data-state=… data-tip=…
aria-label=…>` with 16px stroke icons (book-plus, check, warning) in the panel icon style.
  - `onResult?(result)` lets the editor show a failure in its existing notice line.
- Labels: `ATTACHMENT_WIKI_LABELS: Record<Lang, {...}>` in `strings-attachment-wiki.ts`, all 21
  locales (like `strings-ai-panel-side.ts`): add, adding, added, duplicate, and one line per skip
  reason.
- CSS `packages/ui/src/attachment-wiki.css` (tokens only): the button sits at the card's right
  edge, vertically centred (absolute, `right: 8px`), 24×24, radius 6, `--color-text-secondary`,
  hover `--color-bg-subtle`; `data-state=added|duplicate` uses `--color-brand-secondary`,
  `failed` uses `--danger`. `.ai-attachment-card:has(.ai-attachment-wiki-btn)` widens its right
  padding so the name ellipsizes before the button.

### 6. Editors

| Editor | Where the button goes         | Notice on failure        | Preload               |
| ------ | ----------------------------- | ------------------------ | --------------------- |
| Docs   | card chip (`AiPanel.tsx`)     | `attachNotice`           | has `window.workWiki` |
| Slides | card chip (`AiPanel.tsx`)     | `attachNotice`           | has `window.workWiki` |
| Sheets | card chip (`AiChatPanel.tsx`) | `attachNotice` (via App) | expose `workWiki`     |
| HTML   | card chip (`AttachmentList`)  | `attachNotice`           | expose `workWiki`     |
| HWP    | new card chip                 | `modelNotice`            | has `window.workWiki` |

- Only composer chips get the button; the read-only echo on sent messages does not.
- Each editor imports `@genoffice/ui/attachment-wiki.css`.
- HWP: the chip becomes `.ai-attachments` / `.ai-attachment-card` with type icon, truncated
  name, size and the round × badge (icons and CSS copied from Docs, hwp/hwpx use the document
  icon); `main.tsx` calls `installScreenTips()` and imports `@genoffice/ui/screentip.css`.

## Error handling

- Wiki off between status and click → `wiki-off` → failed state with "업무 위키가 꺼져 있습니다".
- IPC failure → failed (`unreadable`).
- The button never blocks sending a message or removing the chip; removing the chip after adding
  keeps the material in the wiki.

## Testing

- `add-material`: dedupe by content (same name, different name, after target deleted, two in one
  call, hwp hashed by source), reason codes, existing rules (50 files, no overwrite).
- Shell IPC: status on/off; add-material wiki-off, invalid input, HWP not-attached vs attached,
  non-HWP views unaffected.
- `AttachmentWikiButton`: hidden when api missing / disabled / unsupported ext; idle → added,
  duplicate, failed + retry; labels exist for all 21 locales.
- Each editor: the composer card shows the button for a pdf and not for a png; HWP card chip
  replaces the pill (existing HWP panel tests updated).
- Built app (separate profile): attach a pdf and a hwp in Docs and HWP, add, file appears in
  `raw/sources` (hwp as .md), second add → duplicate; screenshots of all five composers.
