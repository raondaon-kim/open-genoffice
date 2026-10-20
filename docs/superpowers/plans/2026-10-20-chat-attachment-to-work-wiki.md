# Chat attachment → work wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One icon button on each AI-chat attachment card adds that file to the work wiki
(`raw/sources`, LLM Wiki ingests it), in Docs, Slides, Sheets, HTML and Hangul, looking native
everywhere.

**Architecture:** A pure contract module in `@genoffice/work-wiki` (`./material`), two new
`wiki:*` IPC channels handled in the shell on top of the existing `addMaterial` (now with
content-hash dedupe), an HWP grant gate, and one shared `AttachmentWikiButton` in `@genoffice/ui`
(21-locale labels, token-only CSS) dropped into each editor's attachment card. Hangul's pill chip
becomes the shared card.

**Tech Stack:** TypeScript, React 19, Electron IPC, Vitest (jsdom for UI), Playwright driver for
the built app.

**Spec:** `docs/superpowers/specs/2026-10-20-chat-attachment-to-work-wiki-design.md`

## Global Constraints

- Accepted formats: `hwp, hwpx, docx, pptx, xlsx, pdf, md, txt` (one list, `WIKI_MATERIAL_EXTS`).
- Limits: ≤ 50 paths per request, each path absolute and ≤ 4096 chars, file ≤ 100 MB.
- Dedupe index lives at `<userData>/work-wiki/<key>/material-index.json` (never under `raw/`).
- Renderer CSS uses design tokens only (`tools/check-theme-colors.mjs`); raw colors only on
  custom-property definition lines.
- No change to how the AI reads attachments (`read_attachment`) or to the wiki skill.
- Push only to `private`; never print API keys; built-app checks use a separate profile.

## Review Focus

1. Same file attached twice in two chats → second click must say "already added", not copy
   `name (2)`; a file deleted from `raw/sources` must be addable again.
2. Hangul view sending a path it never attached → `not-attached`, nothing copied (others views
   unaffected).
3. Work wiki off (or folder unusable) → no button at all; turned off after the chip rendered →
   click shows the wiki-off failure, nothing copied.
4. Long file names and long locales (de, ru) → name ellipsizes before the button; button never
   overlaps the × badge.
5. Rapid double click → one request, one copy.

---

### Task 1: Material contract in `@genoffice/work-wiki`

**Files:**

- Create: `packages/work-wiki/src/material.ts`
- Modify: `packages/work-wiki/src/types.ts`, `packages/work-wiki/src/preload.ts`,
  `packages/work-wiki/src/index.ts`, `packages/work-wiki/package.json` (exports `./material`)
- Test: `packages/work-wiki/tests/material.test.ts`

**Interfaces:**

- Produces: `WIKI_MATERIAL_EXTS`, `isWikiMaterial(name)`, `WikiMaterialSkip`,
  `WikiMaterialResult`, `WikiMaterialApi`, `WIKI_CHANNELS.status|addMaterial`,
  `WorkWikiApi extends WikiMaterialApi`.

- [ ] **Step 1: failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { isWikiMaterial, WIKI_MATERIAL_EXTS } from '../src/material'
import { createWorkWikiPreloadApi, WIKI_CHANNELS } from '../src/index'

describe('wiki material contract', () => {
  it('accepts the formats Home’s dialog takes, by extension, any case', () => {
    expect([...WIKI_MATERIAL_EXTS]).toEqual([
      'hwp',
      'hwpx',
      'docx',
      'pptx',
      'xlsx',
      'pdf',
      'md',
      'txt',
    ])
    expect(isWikiMaterial('제안요청서.PDF')).toBe(true)
    expect(isWikiMaterial('a.hwpx')).toBe(true)
    expect(isWikiMaterial('photo.png')).toBe(false)
    expect(isWikiMaterial('data.csv')).toBe(false)
    expect(isWikiMaterial('README')).toBe(false)
  })

  it('the preload API calls the two new channels', async () => {
    const invoke = vi.fn(async () => 'ok')
    const api = createWorkWikiPreloadApi(invoke)
    await api.status()
    await api.addMaterial(['C:/a.pdf'])
    expect(invoke).toHaveBeenCalledWith(WIKI_CHANNELS.status)
    expect(invoke).toHaveBeenCalledWith(WIKI_CHANNELS.addMaterial, ['C:/a.pdf'])
    expect(WIKI_CHANNELS.status).toBe('wiki:status')
    expect(WIKI_CHANNELS.addMaterial).toBe('wiki:add-material')
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/material.test.ts` in `packages/work-wiki` → FAIL (module missing).
- [ ] **Step 3: implement**

`packages/work-wiki/src/material.ts`:

```ts
/** Files a user can add to the work wiki (Home's "업무 자료 추가" and the chat attachment button). */
export const WIKI_MATERIAL_EXTS = [
  'hwp',
  'hwpx',
  'docx',
  'pptx',
  'xlsx',
  'pdf',
  'md',
  'txt',
] as const

/** by extension, case-insensitive; a name without an extension is not material */
export function isWikiMaterial(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return false
  return (WIKI_MATERIAL_EXTS as readonly string[]).includes(name.slice(dot + 1).toLowerCase())
}

/** why a file was not added */
export type WikiMaterialSkip =
  'unsupported' | 'too-large' | 'no-text' | 'unreadable' | 'too-many' | 'wiki-off' | 'not-attached'

export interface WikiMaterialResult {
  path: string
  status: 'added' | 'duplicate' | 'skipped'
  reason?: WikiMaterialSkip
}

/** what an editor needs to offer "add to work material" */
export interface WikiMaterialApi {
  status(): Promise<{ enabled: boolean }>
  addMaterial(paths: string[]): Promise<WikiMaterialResult[]>
}
```

`types.ts`: `import type { WikiMaterialApi } from './material'`; `export interface WorkWikiApi
extends WikiMaterialApi { … }`; add `status: 'wiki:status', addMaterial: 'wiki:add-material'` to
`WIKI_CHANNELS`. `preload.ts`: add
`status: () => invoke(WIKI_CHANNELS.status) as ReturnType<WorkWikiApi['status']>` and
`addMaterial: (paths) => invoke(WIKI_CHANNELS.addMaterial, paths) as ReturnType<WorkWikiApi['addMaterial']>`.
`index.ts`: `export * from './material'`. `package.json` exports: `"./material": "./src/material.ts"`.

- [ ] **Step 4:** test PASS; `npm run typecheck -w @genoffice/work-wiki` clean (fix any test
      stubs of `WorkWikiApi` elsewhere by adding the two methods: `grep -rn "WorkWikiApi" apps packages`).
- [ ] **Step 5: commit** `feat(work-wiki): material contract and channels for adding chat attachments`

---

### Task 2: `addMaterial` per-file results and content dedupe

**Files:**

- Modify: `apps/shell/src/main/add-material.ts`, `apps/shell/src/main/work-wiki.ts`
  (`addWikiMaterialFromDialog` + `MATERIAL_TEXT`)
- Test: `apps/shell/tests/add-material.test.ts` (rewrite to the new shape)

**Interfaces:**

- Consumes: `WikiMaterialResult`, `WikiMaterialSkip`, `WIKI_MATERIAL_EXTS` from
  `@genoffice/work-wiki/material`.
- Produces: `addMaterial(opts: { files: string[]; rawSources: string; extractText:
(p: string) => Promise<string | null>; indexPath?: string }): Promise<WikiMaterialResult[]>`
  (one result per input, input order).

- [ ] **Step 1: tests** (replace the file)

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addMaterial } from '../src/main/add-material'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mat-'))
  const rawSources = join(dir, 'raw', 'sources')
  const indexPath = join(dir, 'state', 'material-index.json')
  const src = (name: string, text = 'x') => {
    const p = join(dir, name)
    writeFileSync(p, text)
    return p
  }
  return { dir, rawSources, indexPath, src }
}
const none = async () => null

describe('addMaterial', () => {
  it('converts Hangul to Markdown without page markers and copies the other formats', async () => {
    const { rawSources, src } = setup()
    const hwp = src('회사소개서.hwp')
    const pdf = src('실적.pdf', 'PDFDATA')
    const r = await addMaterial({
      files: [hwp, pdf],
      rawSources,
      extractText: async () => '[page 1]\n회사 개요\n주요 실적\n\n[page 2]\n연락처',
    })
    expect(r).toEqual([
      { path: hwp, status: 'added' },
      { path: pdf, status: 'added' },
    ])
    const md = readFileSync(join(rawSources, '회사소개서.md'), 'utf8')
    expect(md).toContain('# 회사소개서')
    expect(md).not.toContain('[page')
    expect(readFileSync(join(rawSources, '실적.pdf'), 'utf8')).toBe('PDFDATA')
  })

  it('never overwrites: a different file with the same name gets a number', async () => {
    const { rawSources, src } = setup()
    const a = src('a.md', 'first')
    await addMaterial({ files: [a], rawSources, extractText: none })
    writeFileSync(a, 'second')
    const r = await addMaterial({ files: [a], rawSources, extractText: none })
    expect(r).toEqual([{ path: a, status: 'added' }])
    expect(readFileSync(join(rawSources, 'a.md'), 'utf8')).toBe('first')
    expect(readFileSync(join(rawSources, 'a (2).md'), 'utf8')).toBe('second')
  })

  it('reports files it cannot use with reason codes', async () => {
    const { rawSources, src } = setup()
    const bad = src('x.exe')
    const empty = src('빈문서.hwpx')
    const missing = join(rawSources, '..', 'no-such.docx')
    const r = await addMaterial({
      files: [bad, empty, missing],
      rawSources,
      extractText: async () => '  ',
    })
    expect(r).toEqual([
      { path: bad, status: 'skipped', reason: 'unsupported' },
      { path: empty, status: 'skipped', reason: 'no-text' },
      { path: missing, status: 'skipped', reason: 'unreadable' },
    ])
    expect(existsSync(join(rawSources, '빈문서.md'))).toBe(false)
  })

  it('does not take more than fifty files at once', async () => {
    const { rawSources, src } = setup()
    const files = Array.from({ length: 52 }, (_, i) => src(`f${i}.md`, `f${i}`))
    const r = await addMaterial({ files, rawSources, extractText: none })
    expect(r.filter((x) => x.status === 'added')).toHaveLength(50)
    expect(r.slice(50)).toEqual(
      files.slice(50).map((path) => ({ path, status: 'skipped', reason: 'too-many' })),
    )
  })

  it('skips content already added, under any name, across calls and within one call', async () => {
    const { rawSources, indexPath, src } = setup()
    const a = src('rfp.pdf', 'SAME')
    const b = src('rfp-copy.pdf', 'SAME')
    expect(await addMaterial({ files: [a, b], rawSources, extractText: none, indexPath })).toEqual([
      { path: a, status: 'added' },
      { path: b, status: 'duplicate' },
    ])
    expect(await addMaterial({ files: [b], rawSources, extractText: none, indexPath })).toEqual([
      { path: b, status: 'duplicate' },
    ])
    expect(existsSync(join(rawSources, 'rfp-copy.pdf'))).toBe(false)
  })

  it('adds the file again when the earlier copy was deleted from the wiki', async () => {
    const { rawSources, indexPath, src } = setup()
    const a = src('rfp.pdf', 'SAME')
    await addMaterial({ files: [a], rawSources, extractText: none, indexPath })
    rmSync(join(rawSources, 'rfp.pdf'))
    expect(await addMaterial({ files: [a], rawSources, extractText: none, indexPath })).toEqual([
      { path: a, status: 'added' },
    ])
    expect(existsSync(join(rawSources, 'rfp.pdf'))).toBe(true)
  })

  it('dedupes Hangul by the source file, and survives a broken index', async () => {
    const { rawSources, indexPath, src } = setup()
    const h = src('보고서.hwp', 'HWPBYTES')
    const text = async () => '본문'
    await addMaterial({ files: [h], rawSources, extractText: text, indexPath })
    expect(await addMaterial({ files: [h], rawSources, extractText: text, indexPath })).toEqual([
      { path: h, status: 'duplicate' },
    ])
    writeFileSync(indexPath, '{not json')
    const other = src('다른.md', 'new')
    expect(await addMaterial({ files: [other], rawSources, extractText: none, indexPath })).toEqual(
      [{ path: other, status: 'added' }],
    )
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/add-material.test.ts` in `apps/shell` → FAIL (old shape).
- [ ] **Step 3: implement** `add-material.ts`:

```ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { WIKI_MATERIAL_EXTS } from '@genoffice/work-wiki/material'
import type { WikiMaterialResult } from '@genoffice/work-wiki/material'

const HANGUL = new Set(['.hwp', '.hwpx'])
const ACCEPTED = new Set(WIKI_MATERIAL_EXTS.map((e) => `.${e}`))
const MAX_FILES = 50
const MAX_BYTES = 100 * 1024 * 1024

function freeName(dir: string, name: string): string {
  /* unchanged */
}

function readIndex(indexPath: string | undefined): Record<string, string> {
  if (!indexPath) return {}
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Put the user's files into raw/sources for LLM Wiki to learn. Hangul files become Markdown text
 * (LLM Wiki cannot read them); the other formats are copied as they are. Nothing is overwritten.
 * With an index, content already added (same bytes, any name) is reported as a duplicate and not
 * copied again, unless its earlier copy was deleted from the wiki.
 */
export async function addMaterial(opts: {
  files: string[]
  rawSources: string
  extractText: (path: string) => Promise<string | null>
  indexPath?: string
}): Promise<WikiMaterialResult[]> {
  mkdirSync(opts.rawSources, { recursive: true })
  const index = readIndex(opts.indexPath)
  let indexChanged = false
  const results: WikiMaterialResult[] = []
  for (const [i, file] of opts.files.entries()) {
    if (i >= MAX_FILES) {
      results.push({ path: file, status: 'skipped', reason: 'too-many' })
      continue
    }
    const ext = extname(file).toLowerCase()
    if (!ACCEPTED.has(ext)) {
      results.push({ path: file, status: 'skipped', reason: 'unsupported' })
      continue
    }
    let bytes: Buffer
    try {
      if (statSync(file).size > MAX_BYTES) {
        results.push({ path: file, status: 'skipped', reason: 'too-large' })
        continue
      }
      bytes = readFileSync(file)
    } catch {
      results.push({ path: file, status: 'skipped', reason: 'unreadable' })
      continue
    }
    const hash = createHash('sha256').update(bytes).digest('hex')
    const earlier = index[hash]
    if (earlier && existsSync(earlier)) {
      results.push({ path: file, status: 'duplicate' })
      continue
    }
    try {
      let target: string
      if (HANGUL.has(ext)) {
        const text = (await opts.extractText(file))?.replace(/^\[page \d+\]\r?\n/gm, '').trim()
        if (!text) {
          results.push({ path: file, status: 'skipped', reason: 'no-text' })
          continue
        }
        const stem = basename(file, extname(file))
        target = freeName(opts.rawSources, `${stem}.md`)
        writeFileSync(target, `# ${stem}\n\n${text}\n`, 'utf8')
      } else {
        target = freeName(opts.rawSources, basename(file))
        writeFileSync(target, bytes)
      }
      index[hash] = target
      indexChanged = true
      results.push({ path: file, status: 'added' })
    } catch {
      results.push({ path: file, status: 'skipped', reason: 'unreadable' })
    }
  }
  if (opts.indexPath && indexChanged) {
    mkdirSync(dirname(opts.indexPath), { recursive: true })
    writeFileSync(opts.indexPath, JSON.stringify(index), 'utf8')
  }
  return results
}
```

`work-wiki.ts`: `addWikiMaterialFromDialog` passes
`indexPath: join(stateDirFor(s.folder), 'material-index.json')`; counts
`added = r.filter(status==='added').length`; lines for the rest use new `MATERIAL_TEXT` keys
(zh/en/ko): `materialDuplicate` ("이미 업무 위키에 있습니다" / "already in the work wiki" /
its Chinese equivalent) and one key per reason (`reason_unsupported`, `reason_too-large`,
`reason_no-text`, `reason_unreadable`, `reason_too-many`, the last two never shown here but kept
for completeness); return `{ added, skipped: total - added, canceled: false }`.

- [ ] **Step 4:** tests PASS; `npm run typecheck -w @genoffice/shell` clean.
- [ ] **Step 5: commit** `feat(work-wiki): skip material already in the wiki; per-file results`

---

### Task 3: Shell IPC + HWP grant gate

**Files:**

- Create: `apps/shell/src/main/wiki-material-request.ts`
- Modify: `apps/shell/src/main/work-wiki.ts` (register two handlers),
  `apps/hwp/src/main/attachments.ts` (gate), `apps/hwp/src/main/hwp-main.ts` (track view)
- Test: `apps/shell/tests/wiki-material-request.test.ts`, `apps/hwp/tests/attachment-gate.test.ts`

**Interfaces:**

- Produces: `handleWikiMaterialRequest(input: unknown, ctx: { enabled: boolean; rawSources:
string; indexPath: string; extractText; gate: (path: string) => boolean | null }):
Promise<WikiMaterialResult[]>`; `hwpAttachmentGate(webContentsId: number, path: string):
boolean | null`; `trackHwpAttachmentView(contents: WebContents): void`.

- [ ] **Step 1: tests**

`apps/shell/tests/wiki-material-request.test.ts`:

```ts
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleWikiMaterialRequest } from '../src/main/wiki-material-request'

const ctx = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wmr-'))
  const file = join(dir, 'rfp.pdf')
  writeFileSync(file, 'PDF')
  return {
    dir,
    file,
    base: {
      enabled: true,
      rawSources: join(dir, 'raw', 'sources'),
      indexPath: join(dir, 'state', 'material-index.json'),
      extractText: async () => null,
      gate: () => null as boolean | null,
    },
  }
}

describe('wiki:add-material', () => {
  it('adds an attached file to raw/sources', async () => {
    const { file, base } = ctx()
    expect(await handleWikiMaterialRequest([file], base)).toEqual([{ path: file, status: 'added' }])
    expect(existsSync(join(base.rawSources, 'rfp.pdf'))).toBe(true)
  })

  it('reports wiki-off for every path and copies nothing when the wiki is off', async () => {
    const { file, base } = ctx()
    expect(await handleWikiMaterialRequest([file], { ...base, enabled: false })).toEqual([
      { path: file, status: 'skipped', reason: 'wiki-off' },
    ])
    expect(existsSync(base.rawSources)).toBe(false)
  })

  it('refuses a Hangul view’s path it never attached, keeps order with the others', async () => {
    const { dir, file, base } = ctx()
    const other = join(dir, 'b.md')
    writeFileSync(other, 'B')
    const r = await handleWikiMaterialRequest([file, other], {
      ...base,
      gate: (p) => p === other,
    })
    expect(r).toEqual([
      { path: file, status: 'skipped', reason: 'not-attached' },
      { path: other, status: 'added' },
    ])
    expect(existsSync(join(base.rawSources, 'rfp.pdf'))).toBe(false)
  })

  it('rejects malformed requests outright', async () => {
    const { file, base } = ctx()
    for (const bad of [
      null,
      'x',
      [1],
      [''],
      ['relative/a.pdf'],
      Array(51).fill(file),
      ['C:/' + 'a'.repeat(5000)],
    ]) {
      expect(await handleWikiMaterialRequest(bad, base)).toEqual([])
    }
  })
})
```

`apps/hwp/tests/attachment-gate.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: (...a: unknown[]) => showOpenDialog(...a) },
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
}))
vi.mock('@genoffice/file-parse', () => ({ parseFileToText: vi.fn() }))

import {
  hwpAttachmentGate,
  registerHwpAttachmentIpc,
  trackHwpAttachmentView,
} from '../src/main/attachments'
import { HWP_CHANNELS } from '../src/shared/ipc'

const contents = (id: number) => {
  const listeners: Array<() => void> = []
  return {
    id,
    once: (_: string, fn: () => void) => listeners.push(fn),
    destroy: () => listeners.forEach((f) => f()),
  }
}

describe('HWP attachment gate', () => {
  beforeEach(() => handlers.clear())

  it('applies only to HWP views and allows exactly the files picked there', async () => {
    registerHwpAttachmentIpc()
    const file = join(mkdtempSync(join(tmpdir(), 'gate-')), 'rfp.pdf')
    writeFileSync(file, 'PDF')
    const view = contents(41)
    trackHwpAttachmentView(view as never)
    expect(hwpAttachmentGate(99, file)).toBeNull()
    expect(hwpAttachmentGate(41, file)).toBe(false)
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] })
    await handlers.get(HWP_CHANNELS.pickAttachments)!({ sender: view })
    expect(hwpAttachmentGate(41, file)).toBe(true)
    expect(hwpAttachmentGate(41, file + '.other')).toBe(false)
    view.destroy()
    expect(hwpAttachmentGate(41, file)).toBeNull()
  })
})
```

- [ ] **Step 2:** both FAIL (missing exports/module).
- [ ] **Step 3: implement**

`wiki-material-request.ts`:

```ts
import { isAbsolute } from 'node:path'
import type { WikiMaterialResult } from '@genoffice/work-wiki/material'
import { addMaterial } from './add-material'

const MAX_PATHS = 50
const MAX_PATH_CHARS = 4096

/**
 * wiki:add-material from an editor's attachment chip. Malformed input gets no answer ([]);
 * otherwise one result per path, in order. `gate` is the HWP grant check: false means the path
 * was not attached in the asking Hangul view; null means the gate does not apply.
 */
export async function handleWikiMaterialRequest(
  input: unknown,
  ctx: {
    enabled: boolean
    rawSources: string
    indexPath: string
    extractText: (path: string) => Promise<string | null>
    gate: (path: string) => boolean | null
  },
): Promise<WikiMaterialResult[]> {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > MAX_PATHS ||
    !input.every((p) => typeof p === 'string' && p.length <= MAX_PATH_CHARS && isAbsolute(p))
  )
    return []
  const paths = input as string[]
  if (!ctx.enabled) return paths.map((path) => ({ path, status: 'skipped', reason: 'wiki-off' }))
  const refused = paths.map((p) => ctx.gate(p) === false)
  const allowed = paths.filter((_, i) => !refused[i])
  const added = allowed.length
    ? await addMaterial({
        files: allowed,
        rawSources: ctx.rawSources,
        extractText: ctx.extractText,
        indexPath: ctx.indexPath,
      })
    : []
  let k = 0
  return paths.map((path, i) =>
    refused[i] ? { path, status: 'skipped', reason: 'not-attached' } : added[k++]!,
  )
}
```

`attachments.ts` additions:

```ts
import type { WebContents } from 'electron'
/** Hangul views (webContents ids): the wiki's add-material only takes their own attachments */
const hwpViews = new Set<number>()

export function trackHwpAttachmentView(contents: WebContents): void {
  const id = contents.id
  hwpViews.add(id)
  contents.once('destroyed', () => {
    hwpViews.delete(id)
    granted.delete(id)
  })
}

/** null: not a Hangul view (no gate); else whether `path` was attached in that view */
export function hwpAttachmentGate(webContentsId: number, path: string): boolean | null {
  if (!hwpViews.has(webContentsId)) return null
  return granted.get(webContentsId)?.has(path) === true
}
```

`hwp-main.ts` `createHwpView`: after `grantAndTrack(...)` add
`trackHwpAttachmentView(view.webContents)` (import from `./attachments`).

`work-wiki.ts` `registerWorkWikiIpc`:

```ts
const wikiOn = (): boolean => readWorkWikiSettings().enabled && engine?.enabled === true
ipcMain.handle(WIKI_CHANNELS.status, () => ({ enabled: wikiOn() }))
ipcMain.handle(WIKI_CHANNELS.addMaterial, (e, input: unknown) => {
  const s = readWorkWikiSettings()
  return handleWikiMaterialRequest(input, {
    enabled: wikiOn(),
    rawSources: join(s.folder, 'raw', 'sources'),
    indexPath: join(stateDirFor(s.folder), 'material-index.json'),
    extractText,
    gate: (p) => hwpAttachmentGate(e.sender.id, p),
  }).catch(() => [])
})
```

(import `hwpAttachmentGate` from `'../../../hwp/src/main/attachments'`, `handleWikiMaterialRequest`
from `'./wiki-material-request'`.)

- [ ] **Step 4:** both tests PASS; shell + hwp typecheck clean.
- [ ] **Step 5: commit** `feat(work-wiki): wiki:status and wiki:add-material for editors, HWP grant gate`

---

### Task 4: Shared `AttachmentWikiButton` in `@genoffice/ui`

**Files:**

- Create: `packages/ui/src/AttachmentWikiButton.tsx`, `packages/ui/src/strings-attachment-wiki.ts`,
  `packages/ui/src/attachment-wiki.css`
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json` (dep `@genoffice/work-wiki`,
  export `./attachment-wiki.css`)
- Test: `packages/ui/tests/attachment-wiki-button.test.ts`

**Interfaces:**

- Consumes: `isWikiMaterial`, `WikiMaterialApi`, `WikiMaterialResult` from
  `@genoffice/work-wiki/material`.
- Produces: `AttachmentWikiButton(props: { path: string; name: string; lang: Lang; api?:
WikiMaterialApi; onResult?: (result: WikiMaterialResult, failure?: string) => void })`,
  `ATTACHMENT_WIKI_LABELS`, `resetAttachmentWikiStatus()` (tests).

- [ ] **Step 1: test**

```ts
/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AttachmentWikiButton, resetAttachmentWikiStatus } from '../src/AttachmentWikiButton'
import { ATTACHMENT_WIKI_LABELS } from '../src/strings-attachment-wiki'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  resetAttachmentWikiStatus()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const api = (enabled = true, result: object = { path: 'C:/a.pdf', status: 'added' }) => ({
  status: vi.fn(async () => ({ enabled })),
  addMaterial: vi.fn(async () => [result]),
})
const render = async (props: object) => {
  await act(async () =>
    root.render(
      createElement(AttachmentWikiButton, {
        path: 'C:/a.pdf',
        name: 'a.pdf',
        lang: 'ko',
        ...props,
      } as never),
    ),
  )
}
const button = () => host.querySelector<HTMLButtonElement>('.ai-attachment-wiki-btn')

it('renders nothing without the api, when the wiki is off, or for a format the wiki does not take', async () => {
  await render({ api: undefined })
  expect(button()).toBeNull()
  await render({ api: api(false) })
  expect(button()).toBeNull()
  resetAttachmentWikiStatus()
  await render({ api: api(true), name: 'photo.png', path: 'C:/photo.png' })
  expect(button()).toBeNull()
})

it('adds once and shows the added state; a second click sends nothing', async () => {
  const a = api()
  const onResult = vi.fn()
  await render({ api: a, onResult })
  expect(button()!.dataset.state).toBe('idle')
  expect(button()!.getAttribute('aria-label')).toBe(ATTACHMENT_WIKI_LABELS.ko.add)
  await act(async () => button()!.click())
  await act(async () => button()!.click())
  expect(a.addMaterial).toHaveBeenCalledTimes(1)
  expect(a.addMaterial).toHaveBeenCalledWith(['C:/a.pdf'])
  expect(button()!.dataset.state).toBe('added')
  expect(onResult).toHaveBeenCalledWith({ path: 'C:/a.pdf', status: 'added' }, undefined)
})

it('shows a duplicate as already added', async () => {
  await render({ api: api(true, { path: 'C:/a.pdf', status: 'duplicate' }) })
  await act(async () => button()!.click())
  expect(button()!.dataset.state).toBe('duplicate')
  expect(button()!.getAttribute('aria-label')).toBe(ATTACHMENT_WIKI_LABELS.ko.duplicate)
})

it('fails with the reason, reports it, and retries on the next click', async () => {
  const a = api(true, { path: 'C:/a.pdf', status: 'skipped', reason: 'wiki-off' })
  const onResult = vi.fn()
  await render({ api: a, onResult })
  await act(async () => button()!.click())
  expect(button()!.dataset.state).toBe('failed')
  expect(button()!.getAttribute('aria-label')).toContain(
    ATTACHMENT_WIKI_LABELS.ko.reasons['wiki-off'],
  )
  expect(onResult.mock.calls[0]![1]).toContain(ATTACHMENT_WIKI_LABELS.ko.reasons['wiki-off'])
  a.addMaterial.mockResolvedValueOnce([{ path: 'C:/a.pdf', status: 'added' }])
  await act(async () => button()!.click())
  expect(button()!.dataset.state).toBe('added')
})

it('a rejected request is a failure, not a crash', async () => {
  const a = api()
  a.addMaterial.mockRejectedValueOnce(new Error('ipc down'))
  await render({ api: a })
  await act(async () => button()!.click())
  expect(button()!.dataset.state).toBe('failed')
})

it('has every label in all 21 languages', () => {
  const langs = [
    'zh',
    'en',
    'ja',
    'ko',
    'fr',
    'de',
    'es',
    'th',
    'id',
    'ru',
    'ar',
    'pt',
    'it',
    'pl',
    'cs',
    'nl',
    'ms',
    'he',
    'hi',
    'zh-TW',
    'vi',
  ]
  for (const lang of langs) {
    const l = ATTACHMENT_WIKI_LABELS[lang as keyof typeof ATTACHMENT_WIKI_LABELS]
    for (const key of ['add', 'adding', 'added', 'duplicate', 'failed'] as const)
      expect(l[key], `${lang}.${key}`).toBeTruthy()
    for (const r of [
      'unsupported',
      'too-large',
      'no-text',
      'unreadable',
      'too-many',
      'wiki-off',
      'not-attached',
    ] as const)
      expect(l.reasons[r], `${lang}.${r}`).toBeTruthy()
  }
})
```

- [ ] **Step 2:** FAIL (module missing).
- [ ] **Step 3: implement** — component:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { isWikiMaterial } from '@genoffice/work-wiki/material'
import type {
  WikiMaterialApi,
  WikiMaterialResult,
  WikiMaterialSkip,
} from '@genoffice/work-wiki/material'
import { ATTACHMENT_WIKI_LABELS } from './strings-attachment-wiki'

type State = 'idle' | 'adding' | 'added' | 'duplicate' | 'failed'

/** one status request serves every chip for a few seconds (many chips, one IPC call) */
const STATUS_TTL_MS = 5000
let statusCache: { api: WikiMaterialApi; at: number; enabled: Promise<boolean> } | null = null
function wikiEnabled(api: WikiMaterialApi): Promise<boolean> {
  const now = Date.now()
  if (statusCache && statusCache.api === api && now - statusCache.at < STATUS_TTL_MS)
    return statusCache.enabled
  const enabled = api.status().then(
    (s) => s?.enabled === true,
    () => false,
  )
  statusCache = { api, at: now, enabled }
  return enabled
}
export function resetAttachmentWikiStatus(): void {
  statusCache = null
}

/**
 * "Add to work material" on an AI-chat attachment card: copies the file into the work wiki
 * (LLM Wiki learns it for later work). Hidden when the wiki is off or the format is not taken.
 */
export function AttachmentWikiButton({
  path,
  name,
  lang,
  api,
  onResult,
}: {
  path: string
  name: string
  lang: Lang
  api?: WikiMaterialApi
  onResult?: (result: WikiMaterialResult, failure?: string) => void
}) {
  const accepted = isWikiMaterial(name)
  const [enabled, setEnabled] = useState(false)
  const [state, setState] = useState<State>('idle')
  const [reason, setReason] = useState<WikiMaterialSkip>('unreadable')
  const busy = useRef(false)
  useEffect(() => {
    if (!api || !accepted) return
    let alive = true
    void wikiEnabled(api).then((on) => {
      if (alive) setEnabled(on)
    })
    return () => {
      alive = false
    }
  }, [api, accepted])
  if (!api || !accepted || !enabled) return null
  const labels = ATTACHMENT_WIKI_LABELS[lang] ?? ATTACHMENT_WIKI_LABELS.en
  const add = async () => {
    if (busy.current || state === 'added' || state === 'duplicate') return
    busy.current = true
    setState('adding')
    let result: WikiMaterialResult
    try {
      result = (await api.addMaterial([path]))[0] ?? {
        path,
        status: 'skipped',
        reason: 'unreadable',
      }
    } catch {
      result = { path, status: 'skipped', reason: 'unreadable' }
    }
    busy.current = false
    if (result.status === 'skipped') {
      const why = result.reason ?? 'unreadable'
      setReason(why)
      setState('failed')
      onResult?.(result, `${labels.failed}: ${labels.reasons[why]}`)
    } else {
      setState(result.status)
      onResult?.(result, undefined)
    }
  }
  const tip =
    state === 'failed'
      ? `${labels.failed}: ${labels.reasons[reason]}`
      : labels[state === 'idle' ? 'add' : state]
  return (
    <button
      type="button"
      className="ai-attachment-wiki-btn"
      data-state={state}
      data-tip={tip}
      aria-label={tip}
      aria-busy={state === 'adding' || undefined}
      disabled={state === 'adding'}
      onClick={() => void add()}
    >
      {state === 'added' || state === 'duplicate' ? (
        <IconCheck />
      ) : state === 'failed' ? (
        <IconWarn />
      ) : (
        <IconBookPlus />
      )}
    </button>
  )
}

const svg = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}
function IconBookPlus() {
  return (
    <svg {...svg}>
      <path d="M2.5 3.5h3.8A1.7 1.7 0 0 1 8 5.2v7.3a1.3 1.3 0 0 0-1.3-1.3H2.5z" />
      <path d="M8 5.2a1.7 1.7 0 0 1 1.7-1.7h.8M13.5 7.5v3.7H9.3A1.3 1.3 0 0 0 8 12.5" />
      <path d="M12.5 1.8v3.9M10.55 3.75h3.9" />
    </svg>
  )
}
function IconCheck() {
  return (
    <svg {...svg}>
      <path d="m3.5 8.5 3 3 6-6.5" />
    </svg>
  )
}
function IconWarn() {
  return (
    <svg {...svg}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.6M8 10.9v.1" />
    </svg>
  )
}
```

Labels (`strings-attachment-wiki.ts`) — `Record<Lang, { add; adding; added; duplicate; failed;
reasons: Record<WikiMaterialSkip, string> }>`, all 21 locales. The translated values live in
`packages/ui/src/strings-attachment-wiki.ts` (docs stay English-only); English reference:

- add: "Add to work material — the AI will use it in later work"
- adding: "Adding to work material…"
- added: "Added to work material — the AI will use it once it is organized"
- duplicate: "Already in work material"
- failed: "Could not add to work material"
- reasons: "this format cannot be added", "the file is larger than 100 MB", "no readable text in
  the file", "the file could not be read", "too many files at once", "the work wiki is off",
  "this file was not attached here"

CSS (`attachment-wiki.css`):

```css
/* "Add to work material" on an AI-chat attachment card (Docs, Slides, Sheets, HTML, Hangul):
   an icon button inside the card's right edge, like the panel's other icon buttons */
.ai-attachment-card:has(.ai-attachment-wiki-btn) {
  padding-right: 36px;
}

.ai-attachment-wiki-btn {
  position: absolute;
  top: 50%;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transform: translateY(-50%);
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.ai-attachment-wiki-btn:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}

.ai-attachment-wiki-btn:focus-visible {
  outline: 2px solid var(--color-brand-secondary);
  outline-offset: 1px;
}

.ai-attachment-wiki-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.ai-attachment-wiki-btn[data-state='added'],
.ai-attachment-wiki-btn[data-state='duplicate'] {
  color: var(--color-brand-secondary);
  cursor: default;
}

.ai-attachment-wiki-btn[data-state='failed'] {
  color: var(--danger);
}
```

`index.ts`: `export { AttachmentWikiButton, resetAttachmentWikiStatus } from './AttachmentWikiButton'`
and `export { ATTACHMENT_WIKI_LABELS } from './strings-attachment-wiki'`. `package.json`: add
`"@genoffice/work-wiki": "*"` to dependencies and `"./attachment-wiki.css":
"./src/attachment-wiki.css"` to exports.

- [ ] **Step 4:** test PASS; `npm run typecheck -w @genoffice/ui` clean; `npm test -w @genoffice/ui`.
- [ ] **Step 5: commit** `feat(ui): AttachmentWikiButton for AI-chat attachment cards`

---

### Task 5: Docs and Slides

**Files:** `apps/docs/src/renderer/ai/AiPanel.tsx`, `apps/docs/src/renderer/main.tsx`,
`apps/slides/src/renderer/ai/AiPanel.tsx`, `apps/slides/src/renderer/main.tsx`

- [ ] **Step 1:** in each composer **card** branch (not the image thumb, not the sent-message
      echo), insert before the remove button:

```tsx
<AttachmentWikiButton
  path={a.path}
  name={a.name}
  lang={lang}
  api={window.workWiki}
  onResult={(_r, failure) => {
    if (!failure) return
    setAttachNotice(failure)
    window.setTimeout(() => setAttachNotice(null), 5000)
  }}
/>
```

(import `AttachmentWikiButton` from `@genoffice/ui`), and add
`import '@genoffice/ui/attachment-wiki.css'` to `main.tsx` after `screentip.css`.

- [ ] **Step 2:** `npm run typecheck -w @genoffice/docs -w @genoffice/slides`; the docs and slides
      test suites (`npx vitest run` in each) stay green.
- [ ] **Step 3: commit** `feat(docs,slides): add an attachment to the work wiki from its card`

---

### Task 6: Sheets and HTML

**Files:** `apps/sheets/src/preload/index.ts`, `apps/sheets/src/renderer/env.d.ts`,
`apps/sheets/src/renderer/ai/AiChatPanel.tsx`, `apps/sheets/src/renderer/App.tsx`,
`apps/sheets/src/renderer/main.tsx`, `apps/sheets/package.json`; same set for `apps/html`
(`ai/AiPanel.tsx` instead of AiChatPanel/App).

- [ ] **Step 1:** preloads expose the wiki:

```ts
import { createWorkWikiPreloadApi } from '@genoffice/work-wiki'
contextBridge.exposeInMainWorld(
  'workWiki',
  createWorkWikiPreloadApi((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
)
```

and each `env.d.ts` `Window` gets
`workWiki?: import('@genoffice/work-wiki/material').WikiMaterialApi`; each `package.json` gets
`"@genoffice/work-wiki": "*"`.

- [ ] **Step 2:** Sheets: `AiChatPanel` props gain `onAttachmentNotice?: (message: string) => void`;
      the card renders `<AttachmentWikiButton path={attachment.path} name={attachment.name}
lang={lang} api={window.workWiki} onResult={(_r, f) => f && onAttachmentNotice?.(f)} />` before
      the remove button; `App.tsx` passes
      `onAttachmentNotice={(m) => { setAttachNotice(m); window.setTimeout(() => setAttachNotice(null), 5000) }}`.
- [ ] **Step 3:** HTML: `AttachmentList` gains `wikiButton?: (a: AttachmentMeta) => ReactNode`,
      rendered in the card branch before `remove(a.path)`; the composer call passes
      `wikiButton={(a) => <AttachmentWikiButton path={a.path} name={a.name} lang={lang}
api={window.workWiki} onResult={(_r, f) => f && showAttachNotice([f])} />}`; the echo call does
      not.
- [ ] **Step 4:** both `main.tsx` import `@genoffice/ui/attachment-wiki.css`; typecheck + test
      suites of both apps.
- [ ] **Step 5: commit** `feat(sheets,html): add an attachment to the work wiki from its card`

---

### Task 7: Hangul card chip, screen tips and the button

**Files:**

- Create: `apps/hwp/src/renderer/ai/AttachmentCard.tsx`, assets
  `apps/hwp/src/renderer/assets/file-{pdf,word,excel,ppt,document,general}.png` (copied from Docs)
- Modify: `apps/hwp/src/renderer/ai/AiPanel.tsx`, `apps/hwp/src/renderer/main.tsx`,
  `apps/hwp/src/renderer/styles.css`, `apps/hwp/tests/ai-panel-ui.test.ts` (mock additions)
- Test: `apps/hwp/tests/attachment-card.test.ts`

**Interfaces:** `AttachmentCard({ attachment, lang, removeLabel, disabled, onRemove, onFailure })`.

- [ ] **Step 1: failing test** (`attachment-card.test.ts`, jsdom, `@genoffice/ui` mocked so the
      button renders a marker):

```ts
// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('@genoffice/ui', () => ({
  AttachmentWikiButton: ({ name }: { name: string }) =>
    React.createElement('i', { 'data-wiki': name }),
}))
import { AttachmentCard } from '../src/renderer/ai/AttachmentCard'

it('renders the shared card: type icon, name, size, wiki button and remove badge', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  const root = createRoot(host)
  const onRemove = vi.fn()
  await act(async () =>
    root.render(
      React.createElement(AttachmentCard, {
        attachment: {
          path: 'C:/a/제안요청서.hwp',
          name: '제안요청서.hwp',
          ext: 'hwp',
          sizeBytes: 2048,
        },
        lang: 'ko',
        removeLabel: '첨부 제거',
        disabled: false,
        onRemove,
        onFailure: () => {},
      }),
    ),
  )
  const card = host.querySelector('.ai-attachment-card')!
  expect(card.querySelector('.ai-attachment-card-icon img')).not.toBeNull()
  expect(card.querySelector('.ai-attachment-card-name')!.textContent).toBe('제안요청서.hwp')
  expect(card.querySelector('.ai-attachment-card-size')!.textContent).toBe('2.00 KB')
  expect(card.querySelector('[data-wiki="제안요청서.hwp"]')).not.toBeNull()
  const remove = card.querySelector<HTMLButtonElement>('.ai-attachment-thumb-remove')!
  expect(remove.getAttribute('data-tip')).toBe('첨부 제거')
  await act(async () => remove.click())
  expect(onRemove).toHaveBeenCalledWith('C:/a/제안요청서.hwp')
  act(() => root.unmount())
})
```

- [ ] **Step 2:** FAIL (module missing).
- [ ] **Step 3: implement** `AttachmentCard.tsx` (icons: pdf→file-pdf, doc/docx→file-word,
      xls/xlsx/csv→file-excel, ppt/pptx→file-ppt, hwp/hwpx/txt/md→file-document, else
      file-general; size `x.xx KB|MB` like Docs; name truncation via CSS ellipsis; remove badge the
      same SVG as Docs with `data-tip` and `aria-label`; `AttachmentWikiButton` with
      `api={window.workWiki}` and `onResult={(_r, f) => f && onFailure(f)}`), then in `AiPanel.tsx`
      replace the `hwp-ai__attachments` header with
      `<div className="ai-attachments">{attachments.map((a) => <AttachmentCard key={a.path} … />)}</div>`
      where `onFailure={setModelNotice}`. `main.tsx`: `import '@genoffice/ui/screentip.css'`,
      `import '@genoffice/ui/attachment-wiki.css'`, call `installScreenTips()` (from `@genoffice/ui`).
      `styles.css`: replace the `.hwp-ai__attachments`/`.hwp-ai__attachment` rules with the Docs
      card rules (`.ai-attachments` without the horizontal-scroll lane tweaks: `display:flex;
flex-wrap:wrap; gap:8px; padding:13px 14px 0`), `.ai-attachment-card*`,
      `.ai-attachment-thumb-remove` — colors through tokens (`--color-border-default`,
      `--color-bg-page`, `--color-bg-subtle`, `--color-text-primary`, `--color-text-tertiary`, and new
      `--hwp-chip-remove-bg/-ink/-hover` defined in the three theme blocks as Docs does).
      `ai-panel-ui.test.ts`: add `AttachmentWikiButton: () => null` and `installScreenTips` is not
      needed there.
- [ ] **Step 4:** HWP suite + typecheck green; theme-colors check clean.
- [ ] **Step 5: commit** `feat(hwp): attachment cards like the other editors, screen tips, add to work wiki`

---

### Task 8: Built-app check

**Files:** `scripts/drivers/driver.attach-wiki.mjs` (local, untracked)

- [ ] **Step 1:** build the changed apps (`electron-vite build` in docs, slides, sheets, html,
      hwp; shell `npm run build -w @genoffice/shell` for main-process changes).
- [ ] **Step 2:** driver with a separate profile (`GENOFFICE_USER_DATA`, wiki folder in a temp
      dir, LLM Wiki not required): for Docs and HWP, stub the attach dialog to a temp `rfp.pdf` and a
      `.hwp`, attach, screenshot the composer, click the wiki button, expect `data-state=added`, the
      pdf in `raw/sources` (hwp as `.md`), second chat attach + click → `duplicate`; screenshots of
      Slides, Sheets and HTML composers with a pdf attached.
      Expected: `WIKI: {"docs":"added","docsAgain":"duplicate","hwp":"added","files":[…]}` and five
      screenshots where the button sits inside each card's right edge.
- [ ] **Step 3:** full suites: `npm test -w @genoffice/work-wiki -w @genoffice/ui -w @genoffice/shell
-w @genoffice/hwp` (+ docs, slides, sheets, html), `node tools/check-theme-colors.mjs`, lint.
