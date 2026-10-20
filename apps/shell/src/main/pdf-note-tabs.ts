// From IeumOffice (pblsketch/openoffice) apps/shell/src/main/pdf-note-tabs.ts, adapted: "Add to
// note" keeps the PDF in view, so it finds the note without bringing it forward.
/**
 * The shell's half of the note of each PDF: the pdf main process resolved a note path (a
 * save-dialog pick or a link-store entry) and asks to open it, or to put text at its end.
 *
 * - Open note brings the note's Markdown tab (or detached window) forward, else opens the
 *   file in a new active tab.
 * - Add to note finds the note's tab or detached window without bringing it forward, else
 *   opens the file in a tab that is not activated, and queues the text for that tab's
 *   webContents; its renderer appends it as an unsaved change.
 *
 * The shell never writes the note file.
 */
import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import {
  queueMarkdownNoteAppendFor,
  type NoteAppendContents,
} from '../../../markdown/src/main/note-append'

export interface NoteTabHost {
  /** the Markdown tab or detached window showing this file, left where it is; undefined when none */
  find(path: string): NoteAppendContents | undefined
  /** the same, brought forward */
  focus(path: string): NoteAppendContents | undefined
  /** open the file in a new Markdown tab, activated or not; undefined without a window */
  openNew(path: string, activate: boolean): NoteAppendContents | undefined
}

/** an absolute path of an existing .md file (checked again here, whatever the caller said) */
export function isNoteFile(path: unknown): path is string {
  if (typeof path !== 'string' || !isAbsolute(path) || !/\.md$/i.test(path)) return false
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/** Open note: bring the note's tab forward or open it; its webContents, null when it cannot be shown */
export function openNoteTab(host: NoteTabHost, path: string): NoteAppendContents | null {
  if (!isNoteFile(path)) return null
  return host.focus(path) ?? host.openNew(path, true) ?? null
}

/** Add to note: hand `text` to the note's tab for the end of its document, keeping the current tab in view */
export function insertIntoNoteTab(
  host: NoteTabHost,
  path: string,
  text: string,
  queue: (
    contents: NoteAppendContents,
    path: string,
    text: string,
  ) => void = queueMarkdownNoteAppendFor,
): boolean {
  if (typeof text !== 'string' || !text.trim()) return false
  if (!isNoteFile(path)) return false
  const contents = host.find(path) ?? host.openNew(path, false)
  if (!contents || contents.isDestroyed()) return false
  queue(contents, path, text)
  return true
}
