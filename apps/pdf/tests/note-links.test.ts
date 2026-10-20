/**
 * The link from a PDF to its Markdown note (spec: per-PDF note, link storage): one JSON
 * file in userData keyed by the PDF's path. A link whose note file is gone is no link;
 * Save As and derived copies share the note; in-app moves of the PDF or the note follow.
 */
// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNoteLinkStore } from '../src/main/note-links'

let dir: string
let file: string
const note = (name = 'a note.md') => {
  const path = join(dir, name)
  writeFileSync(path, '# note\n')
  return path
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdf-note-links-'))
  file = join(dir, 'userData', 'pdf-note-links.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('note link store', () => {
  it('has no link for a PDF never linked, and no file until something is linked', async () => {
    const store = createNoteLinkStore(file)
    expect(await store.get(join(dir, 'a.pdf'))).toBeNull()
  })

  it('remembers a link across store instances (the file is the record)', async () => {
    const n = note()
    await createNoteLinkStore(file).set(join(dir, 'a.pdf'), n)
    expect(await createNoteLinkStore(file).get(join(dir, 'a.pdf'))).toBe(n)
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
  })

  it('treats a link whose note file was deleted as no link', async () => {
    const n = note()
    const store = createNoteLinkStore(file)
    await store.set(join(dir, 'a.pdf'), n)
    rmSync(n)
    expect(await store.get(join(dir, 'a.pdf'))).toBeNull()
  })

  it('gives a copy the same note and keeps the original linked', async () => {
    const n = note()
    const store = createNoteLinkStore(file)
    await store.set(join(dir, 'a.pdf'), n)
    await store.copy(join(dir, 'a.pdf'), join(dir, 'a copy.pdf'))
    expect(await store.get(join(dir, 'a copy.pdf'))).toBe(n)
    expect(await store.get(join(dir, 'a.pdf'))).toBe(n)
  })

  it('never replaces a link the copy target already has', async () => {
    const mine = note('mine.md')
    const theirs = note('theirs.md')
    const store = createNoteLinkStore(file)
    await store.set(join(dir, 'a.pdf'), mine)
    await store.set(join(dir, 'b.pdf'), theirs)
    await store.copy(join(dir, 'a.pdf'), join(dir, 'b.pdf'))
    expect(await store.get(join(dir, 'b.pdf'))).toBe(theirs)
  })

  it('copies nothing from a PDF without a note', async () => {
    const store = createNoteLinkStore(file)
    await store.copy(join(dir, 'a.pdf'), join(dir, 'b.pdf'))
    expect(await store.get(join(dir, 'b.pdf'))).toBeNull()
  })

  it('follows an in-app move or rename of the PDF', async () => {
    const n = note()
    const store = createNoteLinkStore(file)
    await store.set(join(dir, 'a.pdf'), n)
    await store.movePdf(join(dir, 'a.pdf'), join(dir, 'sub', 'renamed.pdf'))
    expect(await store.get(join(dir, 'sub', 'renamed.pdf'))).toBe(n)
    expect(await store.get(join(dir, 'a.pdf'))).toBeNull()
  })

  it('follows an in-app move or rename of the note for every PDF that uses it', async () => {
    const n = note()
    const store = createNoteLinkStore(file)
    await store.set(join(dir, 'a.pdf'), n)
    await store.set(join(dir, 'b.pdf'), n)
    const moved = join(dir, 'notes', 'moved.md')
    await store.moveNote(n, moved)
    mkdirSync(join(dir, 'notes'))
    writeFileSync(moved, '# note\n', { flag: 'wx' }) // the move itself happened on disk
    expect(await store.get(join(dir, 'a.pdf'))).toBe(moved)
    expect(await store.get(join(dir, 'b.pdf'))).toBe(moved)
  })

  it('matches spellings of the same Windows path', async () => {
    if (process.platform !== 'win32') return
    const n = note()
    const store = createNoteLinkStore(file)
    await store.set('C:\\Docs\\Report.pdf', n)
    expect(await store.get('c:/docs/report.pdf')).toBe(n)
    await store.movePdf('c:/DOCS/report.PDF', 'C:\\Docs\\Final.pdf')
    expect(await store.get('C:\\Docs\\Final.pdf')).toBe(n)
  })

  it('keeps every link when changes land at the same time', async () => {
    const n = note()
    const store = createNoteLinkStore(file)
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.set(join(dir, `p${i}.pdf`), n)))
    const fresh = createNoteLinkStore(file)
    for (let i = 0; i < 12; i++) expect(await fresh.get(join(dir, `p${i}.pdf`))).toBe(n)
  })

  it('keeps a copy of a damaged file before starting it over', async () => {
    const n = note()
    const store = createNoteLinkStore(file)
    await store.set(join(dir, 'a.pdf'), n)
    writeFileSync(file, '{ not json')
    const fresh = createNoteLinkStore(file)
    expect(await fresh.get(join(dir, 'a.pdf'))).toBeNull()
    await fresh.set(join(dir, 'b.pdf'), n)
    expect(await createNoteLinkStore(file).get(join(dir, 'b.pdf'))).toBe(n)
    expect(readFileSync(`${file}.bad`, 'utf8')).toBe('{ not json')
  })

  it('changes nothing when the file cannot be read for another reason (it is not lost)', async () => {
    // a directory where the file should be: reading fails with something other than "missing",
    // like a file held by another program
    mkdirSync(file, { recursive: true })
    const store = createNoteLinkStore(file)
    await expect(store.set(join(dir, 'a.pdf'), note())).rejects.toThrow()
    expect(statSync(file).isDirectory()).toBe(true)
  })

  it('moves every link under a moved or renamed folder, PDFs and notes alike', async () => {
    const course = join(dir, 'Course')
    mkdirSync(join(course, 'notes'), { recursive: true })
    const n1 = join(course, 'notes', 'a.md')
    writeFileSync(n1, '# a\n')
    const outside = note('outside.md')
    const store = createNoteLinkStore(file)
    await store.set(join(course, 'a.pdf'), n1)
    await store.set(join(course, 'b.pdf'), outside)
    await store.set(join(dir, 'Coursework.pdf'), n1) // same prefix, not inside the folder
    const moved = join(dir, 'Course 2026')
    // a trailing separator on the old folder is the same folder
    await store.rebaseDir(`${course}${process.platform === 'win32' ? '\\' : '/'}`, moved)
    mkdirSync(join(moved, 'notes'), { recursive: true })
    writeFileSync(join(moved, 'notes', 'a.md'), '# a\n')
    expect(await store.get(join(moved, 'a.pdf'))).toBe(join(moved, 'notes', 'a.md'))
    expect(await store.get(join(moved, 'b.pdf'))).toBe(outside)
    expect(await store.get(join(dir, 'Coursework.pdf'))).toBe(join(moved, 'notes', 'a.md'))
    expect(await store.get(join(course, 'a.pdf'))).toBeNull()
  })
})
