/**
 * The annotation panel as the editor mounts it: a document replaced while its scan still
 * runs never shows the old document's items, and a page with no text layer (a scan) lists
 * its markups with the "no text" label instead of failing. The PDF documents are fakes with
 * just the calls the scan makes.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createI18n } from '@genoffice/i18n'
import { strings } from '../src/renderer/i18n/strings'
import type { TFunc } from '../src/renderer/i18n/locale'
import { AnnotPanelHost } from '../src/renderer/annot-panel/AnnotPanelHost'

const translate = createI18n(strings)
const t: TFunc = (key, params) => translate('en', key, params)

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

interface FakeAnnot {
  id: string
  subtype: string
  rect: number[]
  quadPoints?: number[]
  color?: number[]
}

/** a document whose page annotations arrive when `gate` resolves */
function fakeDoc(pages: FakeAnnot[][], gate: Promise<void> = Promise.resolve()) {
  return {
    numPages: pages.length,
    getPage: async (n: number) => ({
      getAnnotations: async () => {
        await gate
        return pages[n - 1]
      },
      // a scanned page: no text layer at all
      getTextContent: async () => ({ items: [] }),
    }),
  } as unknown as PDFDocumentProxy
}

const highlight = (objNum: number): FakeAnnot => ({
  id: `${objNum}R`,
  subtype: 'Highlight',
  rect: [100, 688, 200, 700],
  quadPoints: [100, 700, 200, 700, 100, 688, 200, 688],
  color: [255, 222, 89],
})

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

function render(doc: PDFDocumentProxy) {
  act(() =>
    root.render(
      createElement(AnnotPanelHost, {
        doc,
        unsavedMarkups: [],
        drawings: [],
        annotDeletes: [],
        noteEdits: [],
        displayPage: (i: number) => i + 1,
        title: 'Doc',
        t,
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onNotice: vi.fn(),
      }),
    ),
  )
}

const keys = () =>
  [...host.querySelectorAll<HTMLElement>('.pdf-annot-item')].map((el) => el.dataset.key)

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}

describe('AnnotPanelHost', () => {
  it("never shows the old document's items after the document is replaced mid-scan", async () => {
    let release!: () => void
    const slow = fakeDoc([[highlight(11)]], new Promise<void>((r) => (release = r)))
    const fast = fakeDoc([[highlight(22)]])
    render(slow)
    render(fast)
    await settle()
    expect(keys()).toEqual(['S22'])
    release()
    await settle()
    expect(keys()).toEqual(['S22'])
  })

  it('lists the drawings of this session before they are saved', async () => {
    act(() =>
      root.render(
        createElement(AnnotPanelHost, {
          doc: fakeDoc([[]]),
          unsavedMarkups: [],
          drawings: [
            {
              id: 'k1',
              input: {
                kind: 'ink',
                pageIndex: 0,
                color: [0, 0, 1],
                width: 2,
                paths: [[1, 2, 3, 4]],
              },
            },
          ],
          annotDeletes: [],
          noteEdits: [],
          displayPage: (i: number) => i + 1,
          title: 'Doc',
          t,
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onNotice: vi.fn(),
        } as never),
      ),
    )
    await settle()
    expect(keys()).toEqual(['Dk1'])
  })

  it('lists a markup on a page without a text layer with the no-text label', async () => {
    render(fakeDoc([[highlight(5)]]))
    await settle()
    expect(keys()).toEqual(['S5'])
    expect(host.textContent).toContain(t('apNoText'))
  })
})
