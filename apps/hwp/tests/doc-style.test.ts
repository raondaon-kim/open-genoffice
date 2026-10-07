import { describe, expect, it } from 'vitest'
import { parseStylePage } from '../src/shared/doc-style'

const role = (over: Record<string, unknown> = {}) => ({
  id: 'item-1',
  label: '1단계 항목',
  marker: 'N.',
  lead: 0,
  size: 13,
  bold: false,
  align: 'justify',
  marginLeft: 0,
  marginRight: 0,
  indent: 660,
  spacingBefore: 0,
  spacingAfter: 0,
  lineSpacing: 180,
  ...over,
})

const style = (over: Record<string, unknown> = {}) => ({
  id: 'test-gian',
  title: '시험 기안문',
  version: 1,
  evidence: { documents: 3, note: '합성 값' },
  page: {
    paper: 'A4 세로',
    marginMm: { left: 20, right: 15, top: 20, bottom: 15 },
    settable: false,
  },
  roles: [
    role({ id: 'org-name', label: '행정기관명', marker: 'text', size: 20, align: 'center' }),
    role(),
  ],
  skeleton: [
    { slot: 'org', role: 'org-name', required: true },
    { slot: 'body', roles: ['item-1'], repeat: true },
  ],
  ...over,
})

const page = (json: unknown, text = '# 시험 기안문\n\n설명입니다.\n') =>
  `${text}\n\`\`\`json style\n${typeof json === 'string' ? json : JSON.stringify(json, null, 2)}\n\`\`\`\n`

describe('parseStylePage', () => {
  it('reads the style block and keeps the rest as the description', () => {
    const result = parseStylePage(page(style()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.style.id).toBe('test-gian')
    expect(result.style.roles).toHaveLength(2)
    expect(result.style.roles[0]).toMatchObject({ align: 'center', size: 20 })
    expect(result.description).toContain('설명입니다.')
    expect(result.description).not.toContain('"roles"')
  })

  it('accepts a draft marker and a role with a half-point size', () => {
    const result = parseStylePage(
      page(
        style({
          draft: true,
          roles: [role({ size: 14.5 })],
          skeleton: [{ slot: 'body', role: 'item-1' }],
        }),
      ),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.style.draft).toBe(true)
  })

  it.each([
    ['no style block', 'text only', /style block/],
    ['broken JSON', page('{ "id": '), /JSON/],
    ['bad id', page(style({ id: 'Bad Id' })), /id/],
    ['no roles', page(style({ roles: [] })), /roles/],
    ['duplicate role id', page(style({ roles: [role(), role()] })), /duplicate/],
    ['unknown alignment', page(style({ roles: [role({ align: 'middle' })] })), /align/],
    ['size out of range', page(style({ roles: [role({ size: 3 })] })), /size/],
    [
      'line spacing out of range',
      page(style({ roles: [role({ lineSpacing: 900 })] })),
      /lineSpacing/,
    ],
    ['lead not an integer', page(style({ roles: [role({ lead: 1.5 })] })), /lead/],
    ['bold not a boolean', page(style({ roles: [role({ bold: 'yes' })] })), /bold/],
    [
      'skeleton points at a missing role',
      page(style({ skeleton: [{ slot: 'x', role: 'nope' }] })),
      /nope/,
    ],
    [
      'skeleton slot with both role and roles',
      page(style({ skeleton: [{ slot: 'x', role: 'item-1', roles: ['item-1'] }] })),
      /role/,
    ],
    [
      'duplicate slot',
      page(
        style({
          skeleton: [
            { slot: 'x', role: 'item-1' },
            { slot: 'x', role: 'item-1' },
          ],
        }),
      ),
      /duplicate/,
    ],
    ['no skeleton', page(style({ skeleton: [] })), /skeleton/],
    [
      'margin out of range',
      page(
        style({
          page: {
            paper: 'A4',
            marginMm: { left: 500, right: 1, top: 1, bottom: 1 },
            settable: false,
          },
        }),
      ),
      /marginMm/,
    ],
  ])('rejects %s', (_label, markdown, pattern) => {
    const result = parseStylePage(markdown as string)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(pattern as RegExp)
  })
})
