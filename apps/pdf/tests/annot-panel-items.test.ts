// From IeumOffice (pblsketch/openoffice) apps/pdf/tests/annot-panel-items.test.ts, 3c002a56,
// without the passage cards this app does not have.
/**
 * The annotation panel's list: saved annotations + unsaved markups and notes in one
 * list, filters and sorting, the exact Markdown shape, and what a click does. Pure;
 * no PDF.js, no store, no AI.
 */
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '@genoffice/i18n'
import { strings } from '../src/renderer/i18n/strings'
import type { TFunc } from '../src/renderer/i18n/locale'
import type { SavedNoteAnnot, NoteInput } from '../src/renderer/note-threads'
import type { LocalMarkup } from '../src/renderer/annotations'
import {
  buildAnnotItems,
  activateAnnotItem,
  type AnnotBuildInput,
  type AnnotItem,
  type SavedAnnotScan,
} from '../src/renderer/annot-panel/items'
import {
  EMPTY_FILTER,
  colorOptions,
  filterAnnotItems,
  kindOptions,
  sortAnnotItems,
  type AnnotFacet,
} from '../src/renderer/annot-panel/filter'
import { annotHtml, annotMarkdown, exportTitle } from '../src/renderer/annot-panel/export'

const translate = createI18n(strings)
const tKo: TFunc = (key, params) => translate('ko', key, params)
const tEn: TFunc = (key, params) => translate('en', key, params)

const YELLOW: [number, number, number] = [1, 0.87, 0.35]
const GREEN: [number, number, number] = [0.2, 0.8, 0.2]

const savedNote = (o: Partial<SavedNoteAnnot> & { objNum: number }): SavedNoteAnnot => ({
  pageIndex: 0,
  type: 'note',
  rect: [100, 500, 120, 520],
  color: YELLOW,
  author: 'kim',
  contents: 'note',
  timeMs: null,
  inReplyTo: null,
  ...o,
})

function scan(): SavedAnnotScan {
  return {
    markups: [
      {
        pageIndex: 2,
        objNum: 11,
        type: 'highlight',
        quads: [[100, 700, 200, 700, 100, 688, 200, 688]],
        rect: [100, 688, 200, 700],
        color: YELLOW,
        createdMs: 30,
        text: 'highlighted words',
      },
      {
        pageIndex: 0,
        objNum: 12,
        type: 'strikeout',
        quads: [[100, 400, 200, 400, 100, 388, 200, 388]],
        rect: [100, 388, 200, 400],
        color: GREEN,
        createdMs: 10,
        text: 'struck words',
      },
      {
        pageIndex: 0,
        objNum: 13,
        type: 'underline',
        quads: [[100, 300, 200, 300, 100, 288, 200, 288]],
        rect: [100, 288, 200, 300],
        color: GREEN,
        createdMs: 20,
        text: 'deleted later',
      },
    ],
    notes: [
      savedNote({ objNum: 21, contents: 'line one\nline two\nline three', timeMs: 5 }),
      savedNote({ objNum: 22, contents: 'a reply', inReplyTo: 21, timeMs: 6 }),
      savedNote({ objNum: 23, contents: 'second reply', inReplyTo: 21, timeMs: 7 }),
    ],
    others: [
      {
        pageIndex: 1,
        objNum: 31,
        subtype: 'Ink',
        rect: [10, 10, 50, 50],
        color: [0, 0, 1],
        createdMs: null,
      },
      {
        pageIndex: 1,
        objNum: 32,
        subtype: 'Sparkle',
        rect: [10, 60, 50, 90],
        color: null,
        createdMs: null,
      },
    ],
  }
}

const unsavedMarkup: LocalMarkup = {
  id: 'm1',
  pageIndex: 1,
  type: 'highlight',
  color: YELLOW,
  quads: [[158, 697, 212, 697, 158, 714, 212, 714]],
}

const pendingNote: { id: string; input: NoteInput } = {
  id: 'n1',
  input: {
    kind: 'note',
    pageIndex: 1,
    color: GREEN,
    at: [300, 600],
    contents: 'my new note',
    createdMs: 100,
  },
}

function input(over: Partial<AnnotBuildInput> = {}): AnnotBuildInput {
  return {
    saved: scan(),
    unsavedMarkups: [unsavedMarkup],
    pendingNotes: [pendingNote],
    deletedObjNums: new Set([13]),
    editedNotes: new Map(),
    pageTexts: new Map([
      [1, [{ str: 'Hello world', transform: [12, 0, 0, 12, 100, 700], width: 110, height: 12 }]],
    ]),
    displayPage: (origIdx) => origIdx + 1,
    t: tKo,
    ...over,
  }
}

const byKey = (items: readonly AnnotItem[], key: string) => {
  const item = items.find((i) => i.key === key)
  if (!item) throw new Error(`no item ${key}`)
  return item
}

describe('buildAnnotItems', () => {
  it('lists saved annotations, unsaved markups and notes together', () => {
    const items = buildAnnotItems(input())
    expect(items.map((i) => i.key).sort()).toEqual(
      ['S11', 'S12', 'S21', 'O31', 'O32', 'Lm1', 'Pn1'].sort(),
    )
  })

  it('shows the text under markups, saved and unsaved', () => {
    const items = buildAnnotItems(input())
    expect(byKey(items, 'S11')).toMatchObject({
      kind: 'highlight',
      kindLabel: '형광펜',
      text: 'highlighted words',
      origin: 'saved',
      page: 2,
      pageNo: 3,
      color: YELLOW,
    })
    expect(byKey(items, 'Lm1')).toMatchObject({
      kind: 'highlight',
      origin: 'unsaved',
      text: 'world',
    })
  })

  it('leaves out saved annotations queued for deletion', () => {
    expect(buildAnnotItems(input()).some((i) => i.key === 'S13')).toBe(false)
  })

  it('shows a note thread root with its first two lines and reply count', () => {
    const items = buildAnnotItems(input())
    const note = byKey(items, 'S21')
    expect(note).toMatchObject({
      kind: 'note',
      kindLabel: '메모',
      text: 'line one\nline two',
      replies: 2,
      target: { type: 'note', rootKey: 'S21' },
    })
    expect(items.some((i) => i.key === 'S22' || i.key === 'S23')).toBe(false)
    expect(byKey(items, 'Pn1')).toMatchObject({
      kind: 'note',
      origin: 'unsaved',
      text: 'my new note',
      replies: 0,
      target: { type: 'note', rootKey: 'Pn1' },
    })
  })

  it('shows a pending edit of a saved note', () => {
    const items = buildAnnotItems(input({ editedNotes: new Map([[21, 'rewritten']]) }))
    expect(byKey(items, 'S21').text).toBe('rewritten')
  })

  it('names other annotation kinds only', () => {
    const items = buildAnnotItems(input())
    expect(byKey(items, 'O31')).toMatchObject({ kind: 'other', kindLabel: '손그림', text: '' })
    expect(byKey(items, 'O32').kindLabel).toContain('Sparkle')
  })

  it('lists the drawings of this session, not saved yet, by kind with their bounds', () => {
    const items = buildAnnotItems(
      input({
        unsavedDrawings: [
          {
            id: 'd1',
            input: {
              kind: 'ink',
              pageIndex: 0,
              color: [0, 0, 1],
              width: 2,
              paths: [
                [10, 20, 30, 40],
                [5, 50, 25, 15],
              ],
            },
          },
          {
            id: 'd2',
            input: {
              kind: 'rect',
              pageIndex: 1,
              color: [1, 0, 0],
              width: 1,
              rect: [100, 100, 200, 150],
            },
          },
          {
            id: 'd3',
            input: {
              kind: 'arrow',
              pageIndex: 1,
              color: [0, 0, 0],
              width: 1,
              from: [300, 10],
              to: [200, 60],
            },
          },
          {
            id: 'd4',
            input: { kind: 'image', pageIndex: 2, image: 'AAAA', rect: [50, 60, 150, 110] },
          },
        ],
      }),
    )
    expect(byKey(items, 'Dd1')).toMatchObject({
      kind: 'other',
      kindLabel: '손그림',
      origin: 'unsaved',
      page: 0,
      rect: [5, 15, 30, 50],
      text: '',
      target: { type: 'location' },
    })
    expect(byKey(items, 'Dd2')).toMatchObject({ kindLabel: '사각형', rect: [100, 100, 200, 150] })
    expect(byKey(items, 'Dd3')).toMatchObject({ kindLabel: '선', rect: [200, 10, 300, 60] })
    expect(byKey(items, 'Dd4')).toMatchObject({ kindLabel: '도장', color: null })
  })

  it('drops items on pages deleted in this session', () => {
    const items = buildAnnotItems(input({ displayPage: (i) => (i === 1 ? null : i + 1) }))
    expect(items.some((i) => i.key === 'Lm1' || i.key === 'O31' || i.key === 'Pn1')).toBe(false)
    expect(items.some((i) => i.key === 'S11')).toBe(true)
  })

  it('takes extra items from other features and fills in their page numbers', () => {
    const items = buildAnnotItems(
      input({
        extra: [
          {
            key: 'X1',
            kind: 'suggestion',
            kindLabel: 'AI 표시 제안',
            origin: 'store',
            page: 0,
            rect: [100, 100, 200, 112],
            color: GREEN,
            text: 'a key sentence',
            category: '핵심 주장',
            createdMs: 1,
            target: { type: 'location' },
          },
        ],
      }),
    )
    expect(byKey(items, 'X1')).toMatchObject({ pageNo: 1, kind: 'suggestion' })
  })
})

describe('filters and sorting', () => {
  const items = buildAnnotItems(input())

  it('sorts by page order by default, top to bottom within a page', () => {
    const sorted = sortAnnotItems(items, 'page')
    const keys = sorted.map((i) => i.key)
    expect(keys.indexOf('S21')).toBeLessThan(keys.indexOf('S12'))
    expect(keys.indexOf('Lm1')).toBeLessThan(keys.indexOf('Pn1'))
    expect(keys.indexOf('Pn1')).toBeLessThan(keys.indexOf('O32'))
    expect(keys.indexOf('O32')).toBeLessThan(keys.indexOf('O31'))
    expect(keys.at(-1)).toBe('S11') // page 3: last
  })

  it('sorts by creation order, unsaved markups last', () => {
    const keys = sortAnnotItems(items, 'created').map((i) => i.key)
    expect(keys.indexOf('S21')).toBeLessThan(keys.indexOf('S12'))
    expect(keys.indexOf('S12')).toBeLessThan(keys.indexOf('S11'))
    expect(keys.indexOf('S11')).toBeLessThan(keys.indexOf('Pn1'))
    expect(keys.at(-1)).toBe('Lm1')
  })

  it('filters by kind', () => {
    const notes = filterAnnotItems(items, { ...EMPTY_FILTER, kind: 'note' })
    expect(notes.map((i) => i.key).sort()).toEqual(['Pn1', 'S21'])
    expect(kindOptions(items, tKo).map((o) => o.kind)).toEqual([
      'highlight',
      'strikeout',
      'note',
      'other',
    ])
  })

  it('filters by color', () => {
    const green = colorOptions(items).find((o) => o.hex === '#33cc33')
    expect(green).toBeDefined()
    const out = filterAnnotItems(items, { ...EMPTY_FILTER, color: '#33cc33' })
    expect(out.map((i) => i.key).sort()).toEqual(['Pn1', 'S12'])
  })

  it('filters by page range (inclusive)', () => {
    const out = filterAnnotItems(items, { ...EMPTY_FILTER, pageFrom: 2, pageTo: 2 })
    expect(out.map((i) => i.key).sort()).toEqual(['Lm1', 'O31', 'O32', 'Pn1'])
    const from3 = filterAnnotItems(items, { ...EMPTY_FILTER, pageFrom: 3 })
    expect(from3.map((i) => i.key)).toEqual(['S11'])
  })

  it('searches the shown text, ignoring case', () => {
    const out = filterAnnotItems(items, { ...EMPTY_FILTER, query: 'WORLD' })
    expect(out.map((i) => i.key)).toEqual(['Lm1'])
    expect(filterAnnotItems(items, { ...EMPTY_FILTER, query: 'struck' }).map((i) => i.key)).toEqual(
      ['S12'],
    )
  })

  it('accepts an extra filter dimension', () => {
    const withCategory = [
      ...items,
      { ...byKey(items, 'S11'), key: 'S99', category: '방법' },
      { ...byKey(items, 'S11'), key: 'S98', category: '결과' },
    ]
    const facet: AnnotFacet = {
      id: 'category',
      label: '분류',
      valueOf: (item) => item.category ?? null,
    }
    const out = filterAnnotItems(withCategory, { ...EMPTY_FILTER, facets: { category: '방법' } }, [
      facet,
    ])
    expect(out.map((i) => i.key)).toEqual(['S99'])
  })
})

describe('Markdown export', () => {
  it('has exactly the shape of spec 4.3', () => {
    const items = buildAnnotItems(
      input({
        unsavedMarkups: [],
        pendingNotes: [],
        saved: {
          markups: [
            {
              pageIndex: 2,
              objNum: 11,
              type: 'highlight',
              quads: [[100, 700, 200, 700, 100, 688, 200, 688]],
              rect: [100, 688, 200, 700],
              color: YELLOW,
              createdMs: 30,
              text: '표시한 글',
            },
          ],
          notes: [
            savedNote({
              objNum: 21,
              pageIndex: 2,
              rect: [100, 600, 120, 620],
              contents: '메모 내용',
            }),
          ],
          others: [],
        },
      }),
    )
    const md = annotMarkdown({ title: '보고서', items: sortAnnotItems(items, 'page'), t: tKo })
    expect(md).toBe(
      [
        '# 보고서 — 주석 모음',
        '',
        '## p.3',
        '',
        '> 표시한 글',
        '>',
        '> — 형광펜',
        '',
        '메모: 메모 내용',
        '',
      ].join('\n'),
    )
  })

  it('uses the UI language for the title, kinds and the note label', () => {
    const items = buildAnnotItems(input({ t: tEn, unsavedMarkups: [], pendingNotes: [] }))
    const md = annotMarkdown({ title: 'Report', items: sortAnnotItems(items, 'page'), t: tEn })
    expect(md.split('\n')[0]).toBe('# Report — Annotations')
    expect(md).toContain('> — Strikethrough')
    expect(md).toContain('Note: line one\nline two\nline three')
  })

  it('groups by page and puts replies after the note', () => {
    const items = sortAnnotItems(buildAnnotItems(input()), 'page')
    const md = annotMarkdown({ title: 'T', items, t: tKo })
    const p1 = md.indexOf('## p.1')
    const p2 = md.indexOf('## p.2')
    const p3 = md.indexOf('## p.3')
    expect(p1).toBeGreaterThan(0)
    expect(p2).toBeGreaterThan(p1)
    expect(p3).toBeGreaterThan(p2)
    expect(md).toContain(
      '메모: line one\nline two\nline three\n\n메모: a reply\n\n메모: second reply',
    )
    expect(md).toContain('> — 손그림')
  })

  it('renders the same list as simple HTML for a Word document', () => {
    const items = sortAnnotItems(buildAnnotItems(input()), 'page')
    const html = annotHtml({ title: 'T <&>', items, t: tKo })
    expect(html.startsWith('<h1>T &lt;&amp;&gt; — 주석 모음</h1>')).toBe(true)
    expect(html).toContain('<h2>p.1</h2>')
    expect(html).toContain('<blockquote><p>struck words</p><p>— 취소선</p></blockquote>')
    expect(html).toContain('<p>메모: line one<br>line two<br>line three</p>')
    expect(html).not.toMatch(/<script|style=/)
  })

  it('titles the new document with the UI-language collection name', () => {
    expect(exportTitle('보고서', tKo)).toBe('보고서 — 주석 모음')
  })
})

describe('activateAnnotItem', () => {
  const handlers = () => ({ reveal: vi.fn(), openNote: vi.fn() })
  const items = buildAnnotItems(input())

  it('goes to a markup and flashes it', () => {
    const h = handlers()
    activateAnnotItem(byKey(items, 'S11'), h)
    expect(h.reveal).toHaveBeenCalledWith(2, [100, 688, 200, 700])
    expect(h.openNote).not.toHaveBeenCalled()
  })

  it('opens the margin thread of a note', () => {
    const h = handlers()
    activateAnnotItem(byKey(items, 'S21'), h)
    expect(h.reveal).toHaveBeenCalledWith(0, [100, 500, 120, 520])
    expect(h.openNote).toHaveBeenCalledWith(0, 'S21')
  })

  it("runs an extension item's own action", () => {
    const h = handlers()
    const activate = vi.fn()
    const [item] = buildAnnotItems(
      input({
        saved: { markups: [], notes: [], others: [] },
        unsavedMarkups: [],
        pendingNotes: [],
        extra: [
          {
            key: 'X1',
            kind: 'suggestion',
            kindLabel: 'x',
            origin: 'store',
            page: 0,
            rect: [1, 2, 3, 4],
            color: null,
            text: 's',
            createdMs: null,
            target: { type: 'custom', activate },
          },
        ],
      }),
    )
    activateAnnotItem(item!, h)
    expect(h.reveal).toHaveBeenCalledWith(0, [1, 2, 3, 4])
    expect(activate).toHaveBeenCalled()
  })
})
