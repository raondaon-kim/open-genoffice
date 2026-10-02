import { describe, expect, it } from 'vitest'
import { formCopyNames, safeDefaultSaveName } from '../src/shared/form-names'

describe('formCopyNames', () => {
  it('names the tab and the default save file after the form, keeping its extension', () => {
    expect(formCopyNames('결재문서본문.hwpx')).toEqual({
      tabName: '결재문서본문 (new)',
      saveName: '결재문서본문_작성.hwpx',
    })
    expect(formCopyNames('품의서.HWP')).toEqual({
      tabName: '품의서 (new)',
      saveName: '품의서_작성.HWP',
    })
  })

  it('keeps only the file name when the given name carries a path', () => {
    expect(formCopyNames('..\\..\\x.hwp').saveName).toBe('x_작성.hwp')
    expect(formCopyNames('a/b/c.hwpx').saveName).toBe('c_작성.hwpx')
  })
})

describe('safeDefaultSaveName', () => {
  it('accepts a plain .hwp/.hwpx file name', () => {
    expect(safeDefaultSaveName('품의서_작성.hwp')).toBe('품의서_작성.hwp')
  })

  it('falls back to untitled.hwp for anything else', () => {
    for (const bad of [
      undefined,
      5,
      '',
      'x.docx',
      '../x.hwp',
      'a\\b.hwp',
      'C:x.hwp',
      'a'.repeat(250) + '.hwp',
    ]) {
      expect(safeDefaultSaveName(bad)).toBe('untitled.hwp')
    }
  })
})
