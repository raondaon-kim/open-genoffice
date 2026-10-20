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
