import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFirstDigest, buildRevisionDigest, DocumentRegistry } from '../src/node/registry'

/** text shaped like rhwp export-text: "[page N]" markers, visual lines, no blank lines inside a page */
function hwpText(pages: string[][]): string {
  return pages.map((lines, i) => `[page ${i + 1}]\n${lines.join('\n')}`).join('\n\n')
}
const page = (n: number) =>
  Array.from({ length: 30 }, (_, i) => `${n}쪽 ${i + 1}번째 줄 내용입니다`)

describe('registry with real extractor shapes', () => {
  it('an inserted line in an rhwp document is the only change, wherever the page breaks move', () => {
    const reg = new DocumentRegistry(mkdtempSync(join(tmpdir(), 'ww-')))
    const before = [page(1), page(2), page(3), page(4)]
    reg.commit('D:/a.hwp', hwpText(before), null)
    // one new line on page 2 pushes a line onto the next page, and so on
    const flat = before.flat()
    flat.splice(40, 0, '추진 일정을 3단계로 구체화했다')
    const after = [flat.slice(0, 30), flat.slice(30, 60), flat.slice(60, 90), flat.slice(90)]
    const change = reg.compare('D:/a.hwp', hwpText(after))
    expect(change.kind).toBe('revision')
    if (change.kind !== 'revision') return
    expect(change.hunks).toHaveLength(1)
    expect(change.hunks[0]!.added).toEqual(['추진 일정을 3단계로 구체화했다'])
    expect(change.hunks[0]!.removed).toEqual([])
    expect(buildRevisionDigest(change.hunks)).toContain('[추가] 추진 일정을 3단계로 구체화했다')
  })

  it('a changed line shows as removed + added in one hunk, added first', () => {
    const reg = new DocumentRegistry(mkdtempSync(join(tmpdir(), 'ww-')))
    const text = '사업 수행 계획서\n개요 문장\n전략 내용이다\n일정 내용'
    reg.commit('D:/b.docx', text, null)
    const change = reg.compare('D:/b.docx', text.replace('전략 내용이다', '전략을 3단계로 나눴다'))
    if (change.kind !== 'revision') throw new Error(change.kind)
    expect(change.hunks).toEqual([{ removed: ['전략 내용이다'], added: ['전략을 3단계로 나눴다'] }])
    const digest = buildRevisionDigest(change.hunks)
    expect(digest.indexOf('[추가]')).toBeLessThan(digest.indexOf('[삭제]'))
  })

  it('a docx without numbered headings still gives a full opening digest, not one line', () => {
    const lines = [
      '사업 수행 계획서',
      ...Array.from({ length: 40 }, (_, i) => `본문 문단 ${i + 1}`),
    ]
    const digest = buildFirstDigest(lines.join('\n'))
    expect(digest).toContain('본문 문단 10')
    expect(buildFirstDigest(lines.join('\n'), 50).length).toBeLessThanOrEqual(50)
  })

  it('page markers are not content', () => {
    const digest = buildFirstDigest(
      hwpText([
        ['Ⅰ. 개요', '첫 줄'],
        ['Ⅱ. 전략', '둘째 줄'],
      ]),
    )
    expect(digest).not.toContain('[page')
    expect(digest).toContain('Ⅱ. 전략')
  })

  it('snapshots kept for the diff are masked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ww-'))
    new DocumentRegistry(dir).commit('D:/c.hwp', '대표 주민번호 900101-1234567\n본문', null)
    const snapDir = join(dir, 'snapshots')
    expect(existsSync(snapDir)).toBe(true)
    for (const f of readdirSync(snapDir)) {
      expect(readFileSync(join(snapDir, f), 'utf8')).not.toContain('1234567')
    }
  })
})
