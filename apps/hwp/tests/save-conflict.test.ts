// @vitest-environment node
/**
 * The same-document save guard of the Hangul main process (modelled on IeumOffice's
 * apps/hwp/tests/save-conflict.test.ts): while the same document is open as a split-pane
 * copy pair, a save from one copy asks before overwriting a change the sibling copy made
 * on disk. A save of a file open nowhere else behaves exactly as before, and a declined
 * save leaves neither the file nor a .bak touched. This editor has no autosave.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const showMessageBox = vi.fn(async (..._args: unknown[]) => ({ response: 1 }))

interface FakeContents {
  id: number
  destroyed: boolean
  isDestroyed(): boolean
  setWindowOpenHandler(handler: unknown): void
  loadURL(url: string): Promise<void>
  once(event: string, listener: () => void): void
}

let nextId = 1
function fakeContents(): FakeContents {
  const contents: FakeContents = {
    id: nextId++,
    destroyed: false,
    isDestroyed: () => contents.destroyed,
    setWindowOpenHandler: () => {},
    loadURL: async () => {},
    once: () => {},
  }
  return contents
}

vi.mock('electron', () => ({
  app: { on: vi.fn(), isPackaged: false, getPath: () => tmpdir(), getLocale: () => 'en-US' },
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
  shell: { openExternal: vi.fn(async () => {}) },
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {
    webContents = fakeContents()
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => handlers.set(channel, fn),
    removeHandler: vi.fn(),
  },
}))
vi.mock('@genoffice/file-parse', () => ({ parseFileToText: vi.fn() }))

import { setOpenPathProbe } from '@genoffice/electron-utils'
import { configureHwpRuntime, createHwpView } from '../src/main/hwp-main'
import { HWP_CHANNELS } from '../src/shared/ipc'
import type { SaveHwpResult } from '../src/shared/ipc'

let dir: string
let docPath: string

beforeEach(() => {
  configureHwpRuntime({ preloadPath: 'preload.js', rendererUrl: 'http://127.0.0.1:1/' })
  dir = mkdtempSync(join(tmpdir(), 'genoffice-hwp-save-conflict-'))
  docPath = join(dir, 'doc.hwpx')
  showMessageBox.mockClear()
  showMessageBox.mockResolvedValue({ response: 1 })
  setOpenPathProbe(null)
})

afterEach(() => {
  setOpenPathProbe(null)
  rmSync(dir, { recursive: true, force: true })
})

/** HWPX bytes enough for the container check (ZIP magic). */
const SAVED_BYTES = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x21, 0x22, 0x23])

const call = <T>(channel: string, contents: FakeContents, ...args: unknown[]): T =>
  handlers.get(channel)!({ sender: contents }, ...args) as T

/** A view that opened the document: the read records the disk state of the copy. */
async function openView(path: string): Promise<FakeContents> {
  const contents = createHwpView(path).webContents as unknown as FakeContents
  await call<Promise<ArrayBuffer>>(HWP_CHANNELS.readFile, contents, path)
  return contents
}

const save = (contents: FakeContents, bytes: Uint8Array) =>
  call<Promise<SaveHwpResult>>(HWP_CHANNELS.save, contents, {
    path: docPath,
    data: bytes.slice().buffer,
  })

describe('Hangul same-document save guard', () => {
  it('does not ask for a file open nowhere else, whatever the disk holds', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    writeFileSync(docPath, 'v2-someone-else')
    const result = await save(contents, SAVED_BYTES)
    expect(result.ok).toBe(true)
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(readFileSync(docPath)).toEqual(Buffer.from(SAVED_BYTES))
  })

  it('asks before overwriting a sibling copy change, and keeps the disk copy on cancel', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    writeFileSync(docPath, 'v2-sibling')
    setOpenPathProbe((path) => path === docPath)
    showMessageBox.mockResolvedValue({ response: 1 })
    const result = await save(contents, SAVED_BYTES)
    expect(result).toMatchObject({ ok: false, canceled: true })
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(readFileSync(docPath, 'utf8')).toBe('v2-sibling')
    // the prompt comes first: a declined save leaves no .bak either
    expect(existsSync(`${docPath}.bak`)).toBe(false)
  })

  it('writes on proceed, keeping the disk bytes in the .bak of the first overwrite', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    writeFileSync(docPath, 'v2-sibling')
    setOpenPathProbe((path) => path === docPath)
    showMessageBox.mockResolvedValue({ response: 0 })
    const result = await save(contents, SAVED_BYTES)
    expect(result.ok).toBe(true)
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(readFileSync(docPath)).toEqual(Buffer.from(SAVED_BYTES))
    expect(readFileSync(`${docPath}.bak`, 'utf8')).toBe('v2-sibling')
  })

  it('does not ask while the disk still matches what this copy read', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    setOpenPathProbe((path) => path === docPath)
    const result = await save(contents, SAVED_BYTES)
    expect(result.ok).toBe(true)
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('records what a save wrote, so the next save compares against that', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    setOpenPathProbe((path) => path === docPath)
    expect((await save(contents, SAVED_BYTES)).ok).toBe(true)
    // a stale record (the state at open, not the written bytes) would raise the prompt here
    expect((await save(contents, Uint8Array.from([...SAVED_BYTES, 0x44]))).ok).toBe(true)
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it("keeps the user's original in the .bak when the second copy overwrites too", async () => {
    writeFileSync(docPath, 'original')
    const first = await openView(docPath)
    const second = await openView(docPath)
    setOpenPathProbe((path) => path === docPath)
    expect((await save(first, SAVED_BYTES)).ok).toBe(true)
    showMessageBox.mockResolvedValue({ response: 0 })
    expect((await save(second, Uint8Array.from([...SAVED_BYTES, 0x66]))).ok).toBe(true)
    expect(readFileSync(`${docPath}.bak`, 'utf8')).toBe('original')
  })

  it('asks the second copy after the first copy saved', async () => {
    writeFileSync(docPath, 'v1')
    const first = await openView(docPath)
    const second = await openView(docPath)
    setOpenPathProbe((path) => path === docPath)
    expect((await save(first, SAVED_BYTES)).ok).toBe(true)
    expect(showMessageBox).not.toHaveBeenCalled()
    const result = await save(second, Uint8Array.from([...SAVED_BYTES, 0x55]))
    expect(result).toMatchObject({ ok: false, canceled: true })
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(readFileSync(docPath)).toEqual(Buffer.from(SAVED_BYTES))
  })
})
