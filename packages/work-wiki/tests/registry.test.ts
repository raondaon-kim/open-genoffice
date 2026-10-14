import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildFirstDigest,
  buildRevisionDigest,
  DocumentRegistry,
  splitParagraphs,
} from '../src/node/registry'

const doc =
  'Ⅰ. 사업 이해\n사업 배경 설명이다.\n둘째 줄.\n셋째 줄.\n\nⅡ. 추진 전략\n전략 내용이다.\n\n1. 일정\n일정 내용.'

describe('document registry', () => {
  it('splits text into trimmed non-empty paragraphs', () => {
    expect(splitParagraphs('a\n\n b \n\n\nc')).toEqual(['a', 'b', 'c'])
  })

  it('reports first, unchanged and revision with added/removed paragraphs', () => {
    const reg = new DocumentRegistry(mkdtempSync(join(tmpdir(), 'ww-')))
    expect(reg.compare('D:/a.hwp', doc).kind).toBe('first')
    reg.commit('D:/a.hwp', doc, 'koica-health')
    expect(reg.compare('D:/a.hwp', doc).kind).toBe('unchanged')
    const revised = doc.replace('전략 내용이다.', '전략을 3단계로 구체화했다.')
    const change = reg.compare('D:/a.hwp', revised)
    expect(change.kind).toBe('revision')
    if (change.kind === 'revision') {
      expect(change.added.join('\n')).toContain('3단계')
      expect(change.removed.join('\n')).toContain('전략 내용이다')
    }
    expect(reg.workOf('D:/a.hwp')).toBe('koica-health')
  })

  it('persists across instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ww-'))
    new DocumentRegistry(dir).commit('D:/a.hwp', doc, null)
    expect(new DocumentRegistry(dir).compare('D:/a.hwp', doc).kind).toBe('unchanged')
  })

  it('first digest keeps headings and the first lines of each section, within the cap', () => {
    const full = buildFirstDigest(splitParagraphs(doc))
    expect(full).toContain('Ⅰ. 사업 이해')
    expect(full).toContain('Ⅱ. 추진 전략')
    expect(buildFirstDigest(splitParagraphs(doc), 60).length).toBeLessThanOrEqual(60)
  })

  it('revision digest labels added and removed text within the cap', () => {
    const d = buildRevisionDigest(['새 문단'], ['옛 문단'], 1000)
    expect(d).toContain('[추가] 새 문단')
    expect(d).toContain('[삭제] 옛 문단')
    expect(
      buildRevisionDigest(['가'.repeat(500)], ['나'.repeat(500)], 700).length,
    ).toBeLessThanOrEqual(700)
  })
})
