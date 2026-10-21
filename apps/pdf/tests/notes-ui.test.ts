// Modelled on IeumOffice (pblsketch/openoffice) apps/pdf/tests/notes-ui.test.ts, 6c33de7a, without
// its passage cards, document overview and AI highlights; the toast's Open note action is ours.
/**
 * The note buttons of the PDF editor: what "Add to note" sends for each list item, the
 * notices, the buttons' states, the "Added to the note" toast offering Open note, and the
 * editor wiring (View tab, the annotation panel's header and items).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '@genoffice/i18n'
import { strings } from '../src/renderer/i18n/strings'
import type { TFunc } from '../src/renderer/i18n/locale'
import type { PdfNoteInsertRequest, PdfNoteResult } from '../src/shared/ipc'
import { AnnotPanel } from '../src/renderer/annot-panel/AnnotPanel'
import type { AnnotItem } from '../src/renderer/annot-panel/items'
import {
  NoteOpenBar,
  NoteOpenRibbonButton,
  noteInsertAction,
  useNoteActions,
  type NoteAction,
  type NoteActions,
  type NoteApi,
} from '../src/renderer/notes/NoteActions'
import { annotNoteRequest, noteResultNotice } from '../src/renderer/notes/note-requests'

const translate = createI18n(strings)
const t: TFunc = (key, params) => translate('en', key, params)

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const item = (o: Partial<AnnotItem> & Pick<AnnotItem, 'key'>): AnnotItem => ({
  kind: 'highlight',
  kindLabel: 'Highlight',
  origin: 'saved',
  page: 2,
  pageNo: 3,
  rect: [100, 688, 200, 700],
  pos: [0, 0],
  seq: 0,
  color: [1, 0.87, 0.35],
  text: 'marked text',
  createdMs: 1,
  notFound: false,
  target: { type: 'location' },
  ...o,
})

describe('what "Add to note" sends', () => {
  it('a markup: the marked text on the file page (original index + 1), no body', () => {
    for (const kind of ['highlight', 'underline', 'strikeout'] as const) {
      expect(annotNoteRequest(item({ key: 'S1', kind }))).toEqual({
        kind: 'quote',
        excerpt: 'marked text',
        page: 3,
      })
    }
  })

  it('a note: the memo and its replies as the body', () => {
    const note = item({
      key: 'S2',
      kind: 'note',
      text: 'first two lines',
      memo: 'the whole memo',
      replyTexts: ['a reply', '  '],
    })
    expect(annotNoteRequest(note)).toEqual({
      kind: 'quote',
      excerpt: '',
      page: 3,
      body: 'the whole memo\n\na reply',
    })
  })

  it('nothing for drawings, stamps and other kinds, or an item without a page', () => {
    expect(annotNoteRequest(item({ key: 'O1', kind: 'other', text: '' }))).toBeNull()
    expect(annotNoteRequest(item({ key: 'X', kind: 'suggestion' }))).toBeNull()
    expect(annotNoteRequest(item({ key: 'S3', page: null, pageNo: null }))).toBeNull()
    expect(annotNoteRequest(item({ key: 'S4', notFound: true }))).toBeNull()
  })

  it('never carries a path', () => {
    const request = annotNoteRequest(item({ key: 'S1' }))!
    expect(Object.keys(request).sort()).toEqual(['excerpt', 'kind', 'page'])
  })
})

describe('noteResultNotice', () => {
  it('says why, or nothing for a cancelled dialog or a second click', () => {
    expect(noteResultNotice({ ok: true }, t, 'insert')).toBe('Added to the note')
    expect(noteResultNotice({ ok: true }, t, 'open')).toBeNull()
    expect(noteResultNotice({ ok: false, reason: 'unsaved' }, t, 'open')).toBe(t('ntSaveFirst'))
    expect(noteResultNotice({ ok: false, reason: 'unavailable' }, t, 'insert')).toBe(
      t('ntUnavailable'),
    )
    expect(noteResultNotice({ ok: false, reason: 'cancelled' }, t, 'open')).toBeNull()
    expect(noteResultNotice({ ok: false, reason: 'busy' }, t, 'open')).toBeNull()
    expect(noteResultNotice({ ok: false, reason: 'failed', message: 'EACCES' }, t, 'open')).toBe(
      'The note could not be opened. EACCES',
    )
  })
})

// ── on screen ──

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function fakeApi(o: { untitled?: boolean; result?: PdfNoteResult } = {}) {
  return {
    noteOpen: vi.fn(async (_request?: { title?: string }) => o.result ?? { ok: true }),
    noteInsert: vi.fn(async (_request: PdfNoteInsertRequest) => o.result ?? { ok: true }),
    isUntitled: vi.fn(async () => o.untitled === true),
  } satisfies NoteApi
}

type Notice = { message: string; action?: NoteAction }

async function mountButtons(
  api: NoteApi,
  filePath: string,
  notices: Notice[],
  request: PdfNoteInsertRequest | null = { kind: 'quote', excerpt: 'x', page: 1 },
): Promise<void> {
  function Harness() {
    const actions: NoteActions = useNoteActions({
      filePath,
      title: 'A Study',
      t,
      onNotice: (message, action) => notices.push({ message, action }),
      api,
    })
    return createElement(
      'div',
      null,
      createElement(NoteOpenRibbonButton, { actions, t }),
      createElement(NoteOpenBar, { actions, t }),
      noteInsertAction(actions, request, t, 'pdf-modal-btn'),
    )
  }
  await act(async () => {
    root.render(createElement(Harness))
  })
  await act(async () => {})
}

const buttons = (action: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(`button[data-action="${action}"]`))

describe('note buttons', () => {
  it('"Open note" (ribbon and panel) calls the open channel with the title only', async () => {
    const api = fakeApi()
    const notices: Notice[] = []
    await mountButtons(api, 'C:\\d\\a.pdf', notices)
    const open = buttons('note-open')
    expect(open).toHaveLength(2)
    for (const b of open) await act(async () => b.click())
    expect(api.noteOpen).toHaveBeenCalledTimes(2)
    expect(api.noteOpen).toHaveBeenLastCalledWith({ title: 'A Study' })
    expect(api.noteInsert).not.toHaveBeenCalled()
    expect(notices).toEqual([])
  })

  it('"Add to note" sends the item, then says it is done and offers Open note', async () => {
    const api = fakeApi()
    const notices: Notice[] = []
    await mountButtons(api, 'C:\\d\\a.pdf', notices, { kind: 'quote', excerpt: 'q', page: 5 })
    const [insert] = buttons('note-insert')
    expect(insert!.textContent).toBe('Add to note')
    await act(async () => insert!.click())
    expect(api.noteInsert).toHaveBeenCalledWith({
      kind: 'quote',
      excerpt: 'q',
      page: 5,
      title: 'A Study',
    })
    expect(api.noteOpen).not.toHaveBeenCalled()
    expect(notices).toHaveLength(1)
    expect(notices[0]!.message).toBe('Added to the note')
    expect(notices[0]!.action?.label).toBe('Open note')
    await act(async () => notices[0]!.action!.run())
    expect(api.noteOpen).toHaveBeenCalledWith({ title: 'A Study' })
  })

  it('offers no action with a refusal', async () => {
    const notices: Notice[] = []
    await mountButtons(
      fakeApi({ result: { ok: false, reason: 'unavailable' } }),
      'C:\\a.pdf',
      notices,
    )
    await act(async () => buttons('note-insert')[0]!.click())
    expect(notices).toEqual([{ message: t('ntUnavailable'), action: undefined }])
  })

  it('renders no "Add to note" for an item that cannot go to the note', async () => {
    await mountButtons(fakeApi(), 'C:\\d\\a.pdf', [], null)
    expect(buttons('note-insert')).toHaveLength(0)
  })

  it('is off with "Save the PDF first" for an untitled blank or a PDF without a path', async () => {
    for (const [api, path] of [
      [fakeApi({ untitled: true }), 'C:\\d\\Untitled.pdf'],
      [fakeApi(), ''],
    ] as const) {
      await mountButtons(api, path, [])
      const all = [...buttons('note-open'), ...buttons('note-insert')]
      expect(all).toHaveLength(3)
      for (const b of all) expect(b.disabled).toBe(true)
      expect(host.textContent).toContain('Save the PDF first')
    }
  })
})

describe('unsaved page changes', () => {
  it('turn "Add to note" off until saved, since its page link uses the file on disk; Open note stays', async () => {
    const api = fakeApi()
    function Harness() {
      const actions = useNoteActions({
        filePath: 'C:\\d\\a.pdf',
        title: '',
        t,
        onNotice: () => undefined,
        api,
        pageEditsPending: true,
      })
      return createElement(
        'div',
        null,
        createElement(NoteOpenRibbonButton, { actions, t }),
        noteInsertAction(actions, { kind: 'quote', excerpt: 'x', page: 1 }, t),
      )
    }
    await act(async () => {
      root.render(createElement(Harness))
    })
    await act(async () => {})
    expect(buttons('note-open')[0]!.disabled).toBe(false)
    const [insert] = buttons('note-insert')
    expect(insert!.disabled).toBe(true)
    expect(insert!.title).toBe(t('ntSaveFirst'))
  })

  it('come from the editor: deleted or reordered pages not saved yet', () => {
    const app = readFileSync(join(__dirname, '../src/renderer/App.tsx'), 'utf8')
    expect(app).toMatch(
      /pageEditsPending:\s+!!doc && \(visList\.length !== doc\.numPages \|\| visList\.some\(\(orig, i\) => orig !== i\)\)/,
    )
  })
})

describe('the annotation panel', () => {
  it('shows extra header content (the Open note bar) above the list', async () => {
    await act(async () => {
      root.render(
        createElement(AnnotPanel, {
          items: [item({ key: 'S1' })],
          loading: false,
          title: 'T',
          t,
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onNotice: vi.fn(),
          headerExtra: createElement('div', { className: 'x-header' }, 'extra'),
        }),
      )
    })
    expect(host.querySelector('.x-header')?.textContent).toBe('extra')
  })
})

describe('editor wiring', () => {
  const app = readFileSync(join(__dirname, '../src/renderer/App.tsx'), 'utf8')

  it('puts "Open note" on the View tab and in the annotation panel header', () => {
    expect(app).toMatch(/<NoteOpenRibbonButton actions=\{noteActions\} t=\{t\} \/>/)
    expect(app).toMatch(/headerExtra=\{<NoteOpenBar actions=\{noteActions\} t=\{t\} \/>\}/)
  })

  it('adds "Add to note" to the panel items', () => {
    expect(app).toMatch(
      /noteInsertAction\(noteActions, annotNoteRequest\(item\), t, 'pdf-modal-btn'\)/,
    )
  })

  it('shows the toast with its action', () => {
    expect(app).toMatch(/onNotice: showNotice/)
    expect(app).toMatch(/noticeAction &&/)
  })
})
