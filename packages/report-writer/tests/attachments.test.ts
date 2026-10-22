import { describe, expect, it } from 'vitest'
import {
  MAP_CHARS,
  MAX_PARTS,
  describeParts,
  mapAttachment,
  mustSeeParts,
  partCharsFor,
} from '../src/attachments'

describe('mapAttachment', () => {
  it('cuts a Word-like text at its headings', () => {
    const parts = mapAttachment(
      { name: 'rfp.docx', text: '# 제안요청서\n개요\n## 1. 과업 내용\n가\n## 2. 평가 항목\n나' },
      0,
    )
    expect(parts.map((p) => [p.id, p.label])).toEqual([
      ['A1-1', '제안요청서'],
      ['A1-2', '1. 과업 내용'],
      ['A1-3', '2. 평가 항목'],
    ])
    expect(parts[1]!.text).toContain('가')
  })

  it('groups PDF pages into parts of about 4,000 chars', () => {
    const page = (n: number) => `[page ${n}]\n${'가'.repeat(1500)}`
    const parts = mapAttachment({ name: 'g.pdf', text: [1, 2, 3, 4, 5].map(page).join('\n') }, 1)
    expect(parts[0]).toMatchObject({ id: 'A2-1', label: 'p.1–2', attachment: 'g.pdf' })
    expect(parts.every((p) => p.text.length <= 4000 + 1600)).toBe(true)
    expect(parts.at(-1)!.label).toBe('p.5')
  })

  it('maps plain text by paragraphs', () => {
    const parts = mapAttachment(
      { name: 'a.txt', text: Array.from({ length: 12 }, () => '나'.repeat(900)).join('\n\n') },
      0,
    )
    expect(parts.length).toBeGreaterThan(2)
    expect(
      parts
        .map((p) => p.text)
        .join('')
        .replace(/\n/g, '').length,
    ).toBe(12 * 900)
    expect(parts[0]!.label).toBe('part 1')
  })

  it('splits one huge heading section into parts of about 4,000 chars', () => {
    const parts = mapAttachment({ name: 'b.docx', text: `# 본문\n${'다'.repeat(9000)}` }, 0)
    expect(parts.length).toBe(3)
    expect(parts.map((p) => p.label)).toEqual(['본문', '본문 (2)', '본문 (3)'])
  })
})

describe('mustSeeParts', () => {
  it('puts the first part and the evaluation/TOC parts first within the cap', () => {
    const parts = mapAttachment(
      {
        name: 'r.docx',
        text: `# 표지\n표지\n## 배경\n${'x'.repeat(3000)}\n## 평가 항목 및 배점\n기술 70점`,
      },
      0,
    )
    expect(mustSeeParts(parts, 2000).map((p) => p.label)).toEqual(['표지', '평가 항목 및 배점'])
  })

  it('cuts the last part to fit the cap', () => {
    const parts = mapAttachment({ name: 'r.docx', text: `# 목차\n${'y'.repeat(3000)}` }, 0)
    const seen = mustSeeParts(parts, 1000)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.text.length).toBe(1000)
  })
})

describe('describeParts', () => {
  it('writes one line per part with id, label, length and a one-line preview', () => {
    const parts = mapAttachment({ name: 'r.docx', text: '# 표지\n첫 줄\n둘째 줄' }, 0)
    expect(describeParts(parts)).toBe('A1-1 | 표지 | 13자 | # 표지 첫 줄 둘째 줄')
  })
})

describe('very large attachments', () => {
  it('cuts larger parts so there are at most MAX_PARTS of them', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `문단 ${i} ${'가'.repeat(990)}`).join(
      '\n\n',
    )
    const parts = mapAttachment({ name: 'big.txt', text }, 0, partCharsFor(text.length))
    expect(parts.length).toBeLessThanOrEqual(MAX_PARTS)
  })

  it('keeps the map within its cap by shortening previews', () => {
    const parts = Array.from({ length: 200 }, (_, i) => ({
      id: `A1-${i + 1}`,
      attachment: 'big.xlsx',
      label: `Sheet ${i} ${'긴 제목'.repeat(20)}`,
      text: '나'.repeat(5000),
    }))
    expect(describeParts(parts).length).toBeLessThanOrEqual(MAP_CHARS)
  })
})
