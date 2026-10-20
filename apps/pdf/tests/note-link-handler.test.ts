// @vitest-environment node
// From IeumOffice (pblsketch/openoffice) apps/pdf/tests/note-link-handler.test.ts, 6c33de7a, on
// this app's path-keyed link store: copies and moves replace the save-time hash update.
/**
 * The note channels of the pdf main process: they act on the asking view's own PDF only,
 * never take a path from the renderer, refuse a PDF without a saved path, answer with a
 * reason without the shell, and the link follows copies and in-app moves.
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { PDF_CHANNELS } from '../src/shared/ipc'
import type { PdfApi, PdfNoteResult } from '../src/shared/ipc'

type Handler = (event: { sender: FakeContents }, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
let lastContents: FakeContents
let nextId = 1200
class FakeContents extends EventEmitter {
  id = ++nextId
  setWindowOpenHandler = vi.fn()
  loadURL = vi.fn()
  loadFile = vi.fn()
  isDestroyed = () => false
  send = vi.fn()
}
const userData = mkdtempSync(join(tmpdir(), 'note-handler-ud-'))
const showSaveDialog = vi.fn()
const invoke = vi.fn()
const exposed = new Map<string, unknown>()
vi.mock('electron', () => ({
  app: { on: vi.fn(), whenReady: () => new Promise(() => {}), getPath: () => userData },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
  shell: {},
  webContents: { fromId: () => undefined },
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {
    webContents = (lastContents = new FakeContents())
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => handlers.set(channel, fn),
    removeHandler: vi.fn(),
  },
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => exposed.set(name, api) },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))
vi.mock('@genoffice/electron-utils/drop-open', () => ({ installDropOpenBridge: vi.fn() }))

import {
  configurePdfRuntime,
  copyPdfNoteLink,
  createPdfView,
  markPdfUntitledPath,
  movePdfNoteLink,
  rebasePdfNoteLinks,
} from '../src/main/pdf-main'
import { createNoteLinkStore } from '../src/main/note-links'

const links = () => createNoteLinkStore(join(userData, 'pdf-note-links.json'))

const openNote = vi.fn((_path: string) => true)
const insertIntoNote = vi.fn((_path: string, _text: string) => true)

async function writePdf(dir: string, name = 'Paper.pdf'): Promise<string> {
  const doc = await PDFDocument.create()
  doc.addPage([300, 300])
  doc.addPage([300, 300])
  const path = join(dir, name)
  writeFileSync(path, await doc.save({ useObjectStreams: false }))
  return path
}

const call = (channel: string, ...args: unknown[]) =>
  handlers.get(channel)!({ sender: lastContents }, ...args) as Promise<PdfNoteResult>

beforeEach(() => {
  showSaveDialog.mockReset()
  openNote.mockClear()
  insertIntoNote.mockClear()
  configurePdfRuntime({ preloadPath: '', openNote, insertIntoNote })
})

describe('pdf:note-open', () => {
  it('asks with a default next to the PDF, makes the note and opens it through the shell', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    const pdf = await writePdf(dir)
    createPdfView(pdf)
    showSaveDialog.mockImplementation(async (options: { defaultPath: string }) => ({
      canceled: false,
      filePath: options.defaultPath,
    }))
    const result = await call(PDF_CHANNELS.noteOpen, { title: 'A Study' })
    expect(result).toEqual({ ok: true })
    const options = showSaveDialog.mock.calls[0].at(-1) as {
      defaultPath: string
      filters: Array<{ extensions: string[] }>
    }
    expect(options.defaultPath.startsWith(join(dir, 'Paper '))).toBe(true)
    expect(options.defaultPath.endsWith('.md')).toBe(true)
    expect(options.filters[0].extensions).toEqual(['md'])
    expect(openNote).toHaveBeenCalledWith(options.defaultPath)
    expect(readFileSync(options.defaultPath, 'utf8')).toBe('# A Study\n')
  })

  it('refuses a view without a saved file and an untitled blank', async () => {
    createPdfView(null)
    expect(await call(PDF_CHANNELS.noteOpen, {})).toEqual({ ok: false, reason: 'unsaved' })
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    const blank = await writePdf(dir, 'Untitled.pdf')
    markPdfUntitledPath(blank)
    createPdfView(blank)
    expect(await call(PDF_CHANNELS.noteOpen, {})).toEqual({ ok: false, reason: 'unsaved' })
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('treats a "New PDF" blank as saved for notes once the person saved it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    const blank = await writePdf(dir, 'Untitled 2.pdf')
    markPdfUntitledPath(blank)
    createPdfView(blank)
    const save = (auto: boolean) =>
      handlers.get(PDF_CHANNELS.save)!(
        { sender: lastContents },
        {
          path: blank,
          markups: [
            {
              pageIndex: 0,
              type: 'highlight',
              color: [1, 1, 0],
              quads: [[10, 40, 90, 40, 10, 20, 90, 20]],
            },
          ],
          drawings: [],
          formValues: [],
          stamps: [],
          auto,
        },
      ) as Promise<{ ok: boolean }>
    // an automatic save is not the person saving
    expect((await save(true)).ok).toBe(true)
    expect(await call(PDF_CHANNELS.noteOpen, {})).toEqual({ ok: false, reason: 'unsaved' })
    expect((await save(false)).ok).toBe(true)
    showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await call(PDF_CHANNELS.noteOpen, {})).toEqual({ ok: false, reason: 'cancelled' })
    expect(showSaveDialog).toHaveBeenCalledTimes(1)
  })

  it('answers with a reason and asks nothing when the shell did not inject the note calls', async () => {
    configurePdfRuntime({ preloadPath: '' })
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    createPdfView(await writePdf(dir))
    expect(await call(PDF_CHANNELS.noteOpen, {})).toEqual({ ok: false, reason: 'unavailable' })
    expect(showSaveDialog).not.toHaveBeenCalled()
  })
})

describe('pdf:note-insert', () => {
  it('ignores any path in the request and inserts into the linked note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    const pdf = await writePdf(dir)
    const notePath = join(dir, 'linked.md')
    writeFileSync(notePath, '# linked\n')
    await links().set(pdf, notePath)
    createPdfView(pdf)
    const evil = join(dir, 'evil.md')
    const result = await call(PDF_CHANNELS.noteInsert, {
      kind: 'quote',
      excerpt: 'Quoted',
      page: 2,
      body: 'Memo',
      notePath: evil,
      pdfPath: join(dir, 'other.pdf'),
    })
    expect(result).toEqual({ ok: true })
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(insertIntoNote).toHaveBeenCalledWith(
      notePath,
      '> Quoted ([p.2](Paper.pdf#page=2))\n\nMemo',
    )
    expect(existsSync(evil)).toBe(false)
    expect(readFileSync(notePath, 'utf8')).toBe('# linked\n')
  })

  it('refuses a malformed request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    createPdfView(await writePdf(dir))
    expect((await call(PDF_CHANNELS.noteInsert, { kind: 'quote', page: 'x' })).ok).toBe(false)
    expect(insertIntoNote).not.toHaveBeenCalled()
  })
})

describe('the note link follows copies and in-app moves', () => {
  const quote = { kind: 'quote', excerpt: 'Q', page: 1 } as const

  it('gives a Save As copy the same note, keeping the original linked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    const pdf = await writePdf(dir)
    const copy = await writePdf(dir, 'Paper copy.pdf')
    const notePath = join(dir, 'n.md')
    writeFileSync(notePath, '# n\n')
    await links().set(pdf, notePath)
    await copyPdfNoteLink(pdf, copy)
    createPdfView(copy)
    expect(await call(PDF_CHANNELS.noteInsert, quote)).toEqual({ ok: true })
    expect(insertIntoNote).toHaveBeenLastCalledWith(notePath, expect.any(String))
    expect(await links().get(pdf)).toBe(notePath)
  })

  it('follows the PDF when it is moved or renamed in the app', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    const pdf = await writePdf(dir)
    const notePath = join(dir, 'n.md')
    writeFileSync(notePath, '# n\n')
    await links().set(pdf, notePath)
    const renamed = await writePdf(dir, 'Renamed.pdf')
    await movePdfNoteLink(pdf, renamed)
    expect(await links().get(renamed)).toBe(notePath)
    expect(await links().get(pdf)).toBeNull()
  })

  it('follows the note when the .md is moved or renamed in the app', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    const pdf = await writePdf(dir)
    const notePath = join(dir, 'n.md')
    writeFileSync(notePath, '# n\n')
    await links().set(pdf, notePath)
    mkdirSync(join(dir, 'notes'))
    const moved = join(dir, 'notes', 'moved.md')
    writeFileSync(moved, '# n\n')
    await movePdfNoteLink(notePath, moved)
    expect(await links().get(pdf)).toBe(moved)
  })

  it('follows a folder moved or renamed in the app, whether or not the shell tracks its files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    mkdirSync(join(dir, 'Course'))
    const pdf = await writePdf(join(dir, 'Course'))
    const notePath = join(dir, 'Course', 'n.md')
    writeFileSync(notePath, '# n\n')
    await links().set(pdf, notePath)
    const { renameSync } = await import('node:fs')
    renameSync(join(dir, 'Course'), join(dir, 'Course 2'))
    await rebasePdfNoteLinks(join(dir, 'Course'), join(dir, 'Course 2'))
    expect(await links().get(join(dir, 'Course 2', 'Paper.pdf'))).toBe(
      join(dir, 'Course 2', 'n.md'),
    )
  })

  it('ignores moves of other files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'note-handler-'))
    await expect(movePdfNoteLink(join(dir, 'a.docx'), join(dir, 'b.docx'))).resolves.toBeUndefined()
  })
})

describe('preload: note calls', () => {
  it('sends only the title on open, the text parts on insert, and survives a missing handler', async () => {
    await import('../src/preload/index')
    const api = exposed.get('pdfApi') as PdfApi
    invoke.mockResolvedValue({ ok: true })
    await api.noteOpen({ title: 'T', notePath: 'C:\\evil.md' } as never)
    expect(invoke).toHaveBeenLastCalledWith(PDF_CHANNELS.noteOpen, { title: 'T' })
    const request = { kind: 'quote', excerpt: 'x', page: 1 } as const
    await api.noteInsert(request)
    expect(invoke).toHaveBeenLastCalledWith(PDF_CHANNELS.noteInsert, request)
    invoke.mockRejectedValueOnce(new Error('No handler registered'))
    expect(await api.noteOpen()).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('the redacted copy', () => {
  it('shares the note of the document it was made from', async () => {
    const { readFileSync: read } = await import('node:fs')
    const main = read(join(__dirname, '../src/main/pdf-main.ts'), 'utf8')
    const block = main.slice(main.indexOf('if (request.redactions !== undefined) {'))
    expect(block.slice(0, block.indexOf('pdfRedactionSavedHook?.('))).toMatch(
      /void copyPdfNoteLink\(path, target\)/,
    )
  })
})
