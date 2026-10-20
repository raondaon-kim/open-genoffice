// @vitest-environment node
// From IeumOffice (pblsketch/openoffice) apps/shell/tests/pdf-note-tabs.test.ts, adapted: here
// "Add to note" keeps the PDF in view, so insert never brings the note forward.
/**
 * The note of each PDF in the shell: Open note brings the note's Markdown tab forward or
 * opens the file in a new active tab; Add to note finds the note's tab or detached window
 * (or opens the file in a tab that is not activated) and queues the text for it, never
 * writing the file. Only an existing absolute .md path is accepted.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import {
  insertIntoNoteTab,
  isNoteFile,
  openNoteTab,
  type NoteTabHost,
} from '../src/main/pdf-note-tabs'
import type { NoteAppendContents } from '../../markdown/src/main/note-append'

function contents(id: number): NoteAppendContents & { sent: string[] } {
  const sent: string[] = []
  return {
    id,
    sent,
    isDestroyed: () => false,
    once: () => undefined,
    send: (channel: string) => void sent.push(channel),
  }
}

function note(name = 'Paper 노트.md', text = '# Paper\n'): string {
  const path = join(mkdtempSync(join(tmpdir(), 'shell-note-')), name)
  writeFileSync(path, text)
  return path
}

/** a host where `existing` is the tab (or detached window) already showing the note */
function host(existing?: NoteAppendContents) {
  const opened = contents(2)
  const calls: string[] = []
  const h: NoteTabHost = {
    find: (path) => {
      calls.push(`find:${path}`)
      return existing
    },
    focus: (path) => {
      calls.push(`focus:${path}`)
      return existing
    },
    openNew: (path, activate) => {
      calls.push(`open:${activate ? 'active' : 'background'}:${path}`)
      return opened
    },
  }
  return { h, calls, opened }
}

describe('isNoteFile', () => {
  it('accepts an existing absolute .md file only', () => {
    const path = note()
    expect(isNoteFile(path)).toBe(true)
    expect(isNoteFile(path.replace(/\.md$/, '.txt'))).toBe(false)
    expect(isNoteFile('relative.md')).toBe(false)
    expect(isNoteFile(join(tmpdir(), 'missing-note-xyz.md'))).toBe(false)
    expect(isNoteFile(42)).toBe(false)
  })
})

describe('openNoteTab (Open note)', () => {
  it('brings an open note tab forward without opening another', () => {
    const path = note()
    const tab = contents(1)
    const { h, calls } = host(tab)
    expect(openNoteTab(h, path)).toBe(tab)
    expect(calls).toEqual([`focus:${path}`])
  })

  it('opens the note in a new, active Markdown tab when none shows it', () => {
    const path = note()
    const { h, calls, opened } = host()
    expect(openNoteTab(h, path)).toBe(opened)
    expect(calls).toEqual([`focus:${path}`, `open:active:${path}`])
  })

  it('refuses a path that is not an existing note file', () => {
    const { h, calls } = host()
    expect(openNoteTab(h, join(tmpdir(), 'no-such-note.md'))).toBeNull()
    expect(openNoteTab(h, note('x.pdf'))).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('insertIntoNoteTab (Add to note)', () => {
  it('queues the text for the tab or detached window showing the note, without bringing it forward', () => {
    const path = note()
    const tab = contents(7)
    const { h, calls } = host(tab)
    const queue = vi.fn()
    expect(insertIntoNoteTab(h, path, '> quote', queue)).toBe(true)
    expect(calls).toEqual([`find:${path}`])
    expect(queue).toHaveBeenCalledWith(tab, path, '> quote')
    expect(readFileSync(path, 'utf8')).toBe('# Paper\n')
  })

  it('opens the note in a tab that is not activated when none shows it, then queues', () => {
    const path = note()
    const { h, calls, opened } = host()
    const queue = vi.fn()
    expect(insertIntoNoteTab(h, path, '> quote', queue)).toBe(true)
    expect(calls).toEqual([`find:${path}`, `open:background:${path}`])
    expect(queue).toHaveBeenCalledWith(opened, path, '> quote')
  })

  it('delivers to a newly opened tab through the real queue (with the nudge)', () => {
    const path = note()
    const { h, opened } = host()
    expect(insertIntoNoteTab(h, path, '> quote')).toBe(true)
    expect(opened.sent).toEqual(['markdown:note-append-ready'])
  })

  it('does nothing for blank text, a refused path or a note file deleted since it was linked', () => {
    const { h, calls } = host()
    const queue = vi.fn()
    expect(insertIntoNoteTab(h, note(), '  ', queue)).toBe(false)
    expect(insertIntoNoteTab(h, 'C:relative.md', 'x', queue)).toBe(false)
    expect(insertIntoNoteTab(h, join(tmpdir(), 'deleted-note-xyz.md'), 'x', queue)).toBe(false)
    expect(queue).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
})

describe('shell wiring', () => {
  const index = readFileSync(
    fileURLToPath(new URL('../src/main/index.ts', import.meta.url)),
    'utf8',
  )

  it('injects both note calls into the pdf runtime through this module', () => {
    const config = index.slice(index.indexOf('configurePdfRuntime({'))
    const block = config.slice(0, config.indexOf('})'))
    expect(block).toMatch(/openNote: \(path\) => openNoteTab\(noteTabHost, path\) !== null/)
    expect(block).toMatch(
      /insertIntoNote: \(path, text\) => insertIntoNoteTab\(noteTabHost, path, text\)/,
    )
  })

  it('finds note tabs and detached windows, and opens new ones with or without activation', () => {
    expect(index).toMatch(/findDetachedTabByPath\(path\)/)
    expect(index).toMatch(/findMarkdownTabByPath\(path\)/)
    expect(index).toMatch(/openMarkdownTab\(path, \{ activate \}\)/)
  })

  it('carries every note link under a folder moved or renamed in the app', () => {
    const block = index.slice(index.indexOf('function afterFolderMoved('))
    expect(block.slice(0, block.indexOf('\n}\n'))).toMatch(
      /void rebasePdfNoteLinks\(oldDir, newDir\)/,
    )
  })

  it('carries the note link across Save As, derived copies and in-app moves', () => {
    expect(index).toMatch(/void copyPdfNoteLink\(tab\.filePath, target\)/)
    expect(index).toMatch(/void movePdfNoteLink\(oldPath, newPath\)/)
  })
})
