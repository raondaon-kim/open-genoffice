// A document opened a second time as a split-view copy must not re-run the crash
// recovery offer (or sweep the recovery copy) of the view that already holds it.
import { describe, expect, it } from 'vitest'
import { pathOpenInOtherView } from '../src/open-elsewhere'

const views = (entries: Array<[number, string]>) => new Map(entries)

describe('pathOpenInOtherView', () => {
  it('is true when another view holds the same path', () => {
    expect(pathOpenInOtherView(views([[1, '/docs/a.docx']]), 2, '/docs/a.docx')).toBe(true)
  })

  it('ignores the asking view itself', () => {
    expect(pathOpenInOtherView(views([[1, '/docs/a.docx']]), 1, '/docs/a.docx')).toBe(false)
  })

  it('is false for other paths and for no views', () => {
    expect(pathOpenInOtherView(views([[1, '/docs/b.docx']]), 2, '/docs/a.docx')).toBe(false)
    expect(pathOpenInOtherView(views([]), 2, '/docs/a.docx')).toBe(false)
  })

  it('treats spellings of the same file alike', () => {
    expect(pathOpenInOtherView(views([[1, '/docs/x/../a.docx']]), 2, '/docs/a.docx')).toBe(true)
    if (process.platform === 'win32') {
      expect(pathOpenInOtherView(views([[1, 'C:\\Docs\\A.docx']]), 2, 'c:/docs/a.docx')).toBe(true)
    }
  })
})
