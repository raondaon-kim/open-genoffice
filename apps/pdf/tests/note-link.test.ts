// @vitest-environment node
// From IeumOffice (pblsketch/openoffice) apps/pdf/tests/note-link.test.ts, 6c33de7a, on this
// app's path-keyed link store (no lookup by document hash, no overview insert).
/**
 * The note of each PDF in the main process: the insert text and its link, the first-open
 * save dialog, linking an existing file without overwriting it, lookup by path, and the
 * refusals (unsaved PDF, no shell).
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNoteLinkStore, type NoteLinkStore } from '../src/main/note-links'
import {
  createNoteLinkService,
  defaultNotePath,
  noteInsertText,
  parseNoteInsertRequest,
  pdfLinkFromNote,
  type NoteLinkDeps,
} from '../src/main/note-link'

describe('pdfLinkFromNote', () => {
  it('is the relative path from the note folder with / separators', () => {
    expect(pdfLinkFromNote('C:\\docs\\notes\\n.md', 'C:\\docs\\papers\\a.pdf', 'win32')).toBe(
      '../papers/a.pdf',
    )
    expect(pdfLinkFromNote('/home/u/n.md', '/home/u/a.pdf', 'linux')).toBe('a.pdf')
  })

  it('percent-encodes every segment (space as %20, parentheses, non-ASCII)', () => {
    expect(pdfLinkFromNote('C:\\d\\n.md', 'C:\\d\\my papers\\보고서 (최종).pdf', 'win32')).toBe(
      'my%20papers/%EB%B3%B4%EA%B3%A0%EC%84%9C%20%28%EC%B5%9C%EC%A2%85%29.pdf',
    )
  })

  it('falls back to a file:/// URL on another drive', () => {
    expect(pdfLinkFromNote('D:\\notes\\n.md', 'C:\\My Docs\\a b.pdf', 'win32')).toBe(
      'file:///C:/My%20Docs/a%20b.pdf',
    )
  })

  it('links a Korean name with parentheses next to the note', () => {
    expect(pdfLinkFromNote('C:\\d\\n.md', 'C:\\d\\보고서 (최종).pdf', 'win32')).toBe(
      '%EB%B3%B4%EA%B3%A0%EC%84%9C%20%28%EC%B5%9C%EC%A2%85%29.pdf',
    )
  })

  it('treats drive letters case-insensitively', () => {
    expect(pdfLinkFromNote('c:\\d\\n.md', 'C:\\d\\a.pdf', 'win32')).toBe('a.pdf')
  })
})

describe('noteInsertText', () => {
  const note = 'C:\\d\\a 노트.md'
  const pdf = 'C:\\d\\a.pdf'

  it('quotes a one-line excerpt with the page link, then the body', () => {
    expect(
      noteInsertText(
        note,
        pdf,
        { kind: 'quote', excerpt: 'The key line', page: 3, body: 'Memo' },
        'win32',
      ),
    ).toBe('> The key line ([p.3](a.pdf#page=3))\n\nMemo')
  })

  it('prefixes every line of a multi-line excerpt and puts the link on the last', () => {
    expect(
      noteInsertText(
        note,
        pdf,
        { kind: 'quote', excerpt: 'one\n\ntwo\r\nthree', page: 12 },
        'win32',
      ),
    ).toBe('> one\n>\n> two\n> three ([p.12](a.pdf#page=12))')
  })

  it('omits an empty body and still links an item without text', () => {
    expect(
      noteInsertText(note, pdf, { kind: 'quote', excerpt: '  ', page: 1, body: ' \n' }, 'win32'),
    ).toBe('> ([p.1](a.pdf#page=1))')
  })
})

describe('parseNoteInsertRequest', () => {
  it('keeps the parts and drops anything else (paths included)', () => {
    expect(
      parseNoteInsertRequest({
        kind: 'quote',
        excerpt: 'x',
        page: 2,
        body: 'y',
        title: 'T',
        notePath: 'C:\\evil.md',
        pdfPath: 'C:\\other.pdf',
      }),
    ).toEqual({ kind: 'quote', excerpt: 'x', page: 2, body: 'y', title: 'T' })
  })

  it('refuses malformed requests', () => {
    expect(parseNoteInsertRequest(null)).toBeNull()
    expect(parseNoteInsertRequest('x')).toBeNull()
    expect(parseNoteInsertRequest({ kind: 'quote', excerpt: 'x', page: 0 })).toBeNull()
    expect(parseNoteInsertRequest({ kind: 'quote', excerpt: 'x', page: 1.5 })).toBeNull()
    expect(parseNoteInsertRequest({ kind: 'quote', excerpt: 3, page: 1 })).toBeNull()
    // the overview insert belongs to a feature this app does not have
    expect(parseNoteInsertRequest({ kind: 'overview', heading: 'h', body: 'b' })).toBeNull()
    expect(parseNoteInsertRequest({ kind: 'other' })).toBeNull()
  })
})

describe('defaultNotePath', () => {
  it('sits next to the PDF and is named "<stem> <note word>.md"', () => {
    expect(defaultNotePath('C:\\docs\\Report.final.PDF', '노트', 'win32')).toBe(
      'C:\\docs\\Report.final 노트.md',
    )
    expect(defaultNotePath('/u/a.pdf', 'Note', 'linux')).toBe('/u/a Note.md')
  })
})

// ── the service ──

interface Rig {
  dir: string
  pdf: string
  store: NoteLinkStore
  deps: NoteLinkDeps
  picked: string[]
  opened: string[]
  inserted: Array<{ path: string; text: string }>
  untitled: Set<string>
}

function rig(options: { pick?: (defaultPath: string) => string | null; host?: boolean } = {}): Rig {
  const dir = mkdtempSync(join(tmpdir(), 'note-link-'))
  const pdf = join(dir, 'Paper.pdf')
  writeFileSync(pdf, 'pdf bytes')
  const store = createNoteLinkStore(join(dir, 'userData', 'pdf-note-links.json'))
  const picked: string[] = []
  const opened: string[] = []
  const inserted: Array<{ path: string; text: string }> = []
  const untitled = new Set<string>()
  const pick = options.pick ?? ((d: string) => d)
  const host = options.host ?? true
  const deps: NoteLinkDeps = {
    store: () => store,
    isUntitled: (p) => untitled.has(p),
    pickNotePath: async (_owner, defaultPath) => {
      picked.push(defaultPath)
      return pick(defaultPath)
    },
    noteWord: () => '노트',
    host: () =>
      host
        ? {
            openNote: (p) => {
              opened.push(p)
              return true
            },
            insertIntoNote: (p, text) => {
              inserted.push({ path: p, text })
              return true
            },
          }
        : {},
  }
  return { dir, pdf, store, deps, picked, opened, inserted, untitled }
}

describe('note link service: first open', () => {
  it('asks with the PDF folder and "<stem> 노트.md", creates the note with the title and links it', async () => {
    const r = rig()
    const service = createNoteLinkService(r.deps)
    const result = await service.open(1, r.pdf, { title: 'A Study' })
    const notePath = join(r.dir, 'Paper 노트.md')
    expect(r.picked).toEqual([notePath])
    expect(result).toEqual({ ok: true })
    expect(readFileSync(notePath, 'utf8')).toBe('# A Study\n')
    expect(r.opened).toEqual([notePath])
    expect(await r.store.get(r.pdf)).toBe(notePath)
  })

  it('heads a new note with the file name when the PDF has no title', async () => {
    const r = rig()
    await createNoteLinkService(r.deps).open(1, r.pdf, {})
    expect(readFileSync(join(r.dir, 'Paper 노트.md'), 'utf8')).toBe('# Paper.pdf\n')
  })

  it('links an existing chosen file as it is, never overwriting it', async () => {
    const existing = (dir: string) => join(dir, 'mine.md')
    let chosen = ''
    const r = rig({ pick: () => chosen })
    chosen = existing(r.dir)
    writeFileSync(chosen, 'my old notes\n')
    const result = await createNoteLinkService(r.deps).open(1, r.pdf, { title: 'T' })
    expect(result).toEqual({ ok: true })
    expect(readFileSync(chosen, 'utf8')).toBe('my old notes\n')
    expect(await r.store.get(r.pdf)).toBe(chosen)
  })

  it('adds .md to a chosen name without it', async () => {
    let chosen = ''
    const r = rig({ pick: () => chosen })
    chosen = join(r.dir, 'plain')
    await createNoteLinkService(r.deps).open(1, r.pdf, {})
    expect(existsSync(join(r.dir, 'plain.md'))).toBe(true)
    expect(existsSync(chosen)).toBe(false)
  })

  it('does nothing when the dialog is cancelled', async () => {
    const r = rig({ pick: () => null })
    expect(await createNoteLinkService(r.deps).open(1, r.pdf, {})).toEqual({
      ok: false,
      reason: 'cancelled',
    })
    expect(r.opened).toEqual([])
    expect(await r.store.get(r.pdf)).toBeNull()
  })

  it('asks again when the linked note file is gone', async () => {
    const r = rig()
    const service = createNoteLinkService(r.deps)
    await r.store.set(r.pdf, join(r.dir, 'gone.md'))
    await service.open(1, r.pdf, {})
    expect(r.picked).toHaveLength(1)
  })
})

describe('note link service: lookup', () => {
  it('opens the note of the path without asking', async () => {
    const r = rig()
    const notePath = join(r.dir, 'n.md')
    writeFileSync(notePath, '# n\n')
    await r.store.set(r.pdf, notePath)
    await createNoteLinkService(r.deps).open(1, r.pdf, {})
    expect(r.picked).toEqual([])
    expect(r.opened).toEqual([notePath])
  })
})

describe('note link service: insert', () => {
  it('sends the built text for the linked note to the shell', async () => {
    const r = rig()
    const notePath = join(r.dir, 'notes', 'n.md')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(r.dir, 'notes'))
    writeFileSync(notePath, '# n\n')
    await r.store.set(r.pdf, notePath)
    const result = await createNoteLinkService(r.deps).insert(1, r.pdf, {
      kind: 'quote',
      excerpt: 'Line',
      page: 4,
      body: 'Answer',
    })
    expect(result).toEqual({ ok: true })
    expect(r.inserted).toEqual([
      { path: notePath, text: '> Line ([p.4](../Paper.pdf#page=4))\n\nAnswer' },
    ])
    // the file itself is never written by the PDF side
    expect(readFileSync(notePath, 'utf8')).toBe('# n\n')
  })
})

describe('note link service: refusals', () => {
  it('refuses a PDF without a saved path before asking anything', async () => {
    const r = rig()
    const service = createNoteLinkService(r.deps)
    expect(await service.open(1, null, {})).toEqual({ ok: false, reason: 'unsaved' })
    r.untitled.add(r.pdf)
    expect(await service.open(1, r.pdf, {})).toEqual({ ok: false, reason: 'unsaved' })
    expect(await service.insert(1, r.pdf, { kind: 'quote', excerpt: 'x', page: 1 })).toEqual({
      ok: false,
      reason: 'unsaved',
    })
    expect(r.picked).toEqual([])
  })

  it('answers with a reason and creates nothing without the shell', async () => {
    const r = rig({ host: false })
    const service = createNoteLinkService(r.deps)
    expect(await service.open(1, r.pdf, {})).toEqual({ ok: false, reason: 'unavailable' })
    expect(await service.insert(1, r.pdf, { kind: 'quote', excerpt: 'x', page: 1 })).toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(r.picked).toEqual([])
    expect(existsSync(join(r.dir, 'Paper 노트.md'))).toBe(false)
  })

  it('answers busy while the same view’s dialog is still open', async () => {
    let release: (v: string | null) => void = () => {}
    let asked: () => void = () => {}
    const dialogOpen = new Promise<void>((resolve) => (asked = resolve))
    const r = rig()
    const service = createNoteLinkService({
      ...r.deps,
      pickNotePath: () =>
        new Promise((resolve) => {
          release = resolve
          asked()
        }),
    })
    const first = service.open(1, r.pdf, {})
    await dialogOpen
    expect(await service.open(1, r.pdf, {})).toEqual({ ok: false, reason: 'busy' })
    release(null)
    expect(await first).toEqual({ ok: false, reason: 'cancelled' })
  })
})
