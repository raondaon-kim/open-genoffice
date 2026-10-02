import { describe, expect, it } from 'vitest'
import { pendingProjectKey } from '../src/main/pending-project'

describe('pendingProjectKey', () => {
  it('maps a saved file to the kind of "new file" it came from', () => {
    expect(pendingProjectKey('C:/a/report.docx')).toBe('doc')
    expect(pendingProjectKey('C:/a/b.XLSX')).toBe('sheet')
    expect(pendingProjectKey('C:/a/b.csv')).toBe('sheet')
    expect(pendingProjectKey('C:/a/deck.pptx')).toBe('slide')
    expect(pendingProjectKey('D:/x/품의서_작성.hwp')).toBe('hwp')
    expect(pendingProjectKey('D:/x/결재문서본문_작성.HWPX')).toBe('hwp')
  })

  it('has no key for other files', () => {
    expect(pendingProjectKey('C:/a/scan.pdf')).toBeUndefined()
    expect(pendingProjectKey('C:/a/noext')).toBeUndefined()
  })
})
