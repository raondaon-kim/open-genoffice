import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { parseFileToText } from '@genoffice/file-parse'
import { HWP_CHANNELS } from '../shared/ipc'
import type { HwpAttachment, HwpAttachmentRead } from '../shared/ipc'

/**
 * Attachments for the Hangul assistant (an RFP to answer, a source report to rewrite): the user
 * picks files in a dialog, the assistant reads their text in chunks. Only files picked in this
 * view can be read. Text comes from @genoffice/file-parse (Hangul documents through the shell's
 * rhwp extractor, PDF and Office formats natively).
 */

export const HWP_ATTACHMENT_EXTS = [
  'hwp',
  'hwpx',
  'pdf',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'xlsx',
  'xls',
  'txt',
  'md',
  'csv',
] as const
const MAX_BYTES = 50 * 1024 * 1024
const MAX_CHUNK = 48_000
const CACHE_LIMIT = 8

/** files granted per view (webContents id) */
const granted = new Map<number, Set<string>>()
const textCache = new Map<string, { stamp: string; text: string }>()

export function attachmentFromPath(path: string): HwpAttachment | null {
  const name = basename(path)
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (!(HWP_ATTACHMENT_EXTS as readonly string[]).includes(ext)) return null
  try {
    const size = statSync(path).size
    if (size > MAX_BYTES) return null
    return { path, name, ext, sizeBytes: size }
  } catch {
    return null
  }
}

async function textOf(path: string): Promise<string> {
  const stat = statSync(path)
  const stamp = `${stat.mtimeMs}:${stat.size}`
  const hit = textCache.get(path)
  if (hit && hit.stamp === stamp) return hit.text
  const parsed = await parseFileToText(path)
  if (!parsed.ok || parsed.kind !== 'text' || parsed.text == null) {
    throw new Error(parsed.error ?? 'The file could not be read')
  }
  textCache.set(path, { stamp, text: parsed.text })
  if (textCache.size > CACHE_LIMIT) {
    const oldest = textCache.keys().next().value
    if (oldest) textCache.delete(oldest)
  }
  return parsed.text
}

export function registerHwpAttachmentIpc(): void {
  ipcMain.handle(HWP_CHANNELS.pickAttachments, async (e): Promise<HwpAttachment[]> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const opts = {
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Documents', extensions: [...HWP_ATTACHMENT_EXTS] }],
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return []
    const picked = r.filePaths.map(attachmentFromPath).filter((a): a is HwpAttachment => !!a)
    const set = granted.get(e.sender.id) ?? new Set<string>()
    for (const a of picked) set.add(a.path)
    granted.set(e.sender.id, set)
    e.sender.once('destroyed', () => granted.delete(e.sender.id))
    return picked
  })

  ipcMain.handle(
    HWP_CHANNELS.readAttachment,
    async (e, path: unknown, offset: unknown, maxChars: unknown): Promise<HwpAttachmentRead> => {
      if (typeof path !== 'string' || !granted.get(e.sender.id)?.has(path)) {
        return { ok: false, error: 'This file was not attached in this document' }
      }
      try {
        const text = await textOf(path)
        const start = Math.max(0, Math.floor(Number(offset)) || 0)
        const size = Math.min(Math.max(1, Math.floor(Number(maxChars)) || 1), MAX_CHUNK)
        return {
          ok: true,
          name: basename(path),
          totalChars: text.length,
          offset: start,
          text: text.slice(start, start + size),
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
}
