import { describe, expect, it } from 'vitest'
import { parseAnyStylePage, parseStylePage } from '../src/index'

const wrap = (
  json: unknown,
  text = '# 시험\n\n설명입니다. 문서를 어떻게 쓰는지 적은 사람용 글입니다.\n',
) =>
  `${text}\n\`\`\`json style\n${typeof json === 'string' ? json : JSON.stringify(json, null, 2)}\n\`\`\`\n`

const docxRole = (over: Record<string, unknown> = {}) => ({
  id: 'body',
  label: '본문',
  kind: 'body',
  size: 11,
  bold: false,
  align: 'left',
  spacingBefore: 0,
  spacingAfter: 8,
  lineSpacing: 1.15,
  indentLeft: 0,
  indentFirstLine: 0,
  ...over,
})
const docx = (over: Record<string, unknown> = {}) => ({
  format: 'docx',
  id: 'test-report',
  title: '시험 보고서',
  version: 1,
  evidence: { documents: 5, note: '합성 값' },
  page: {
    paper: 'A4',
    orientation: 'portrait',
    marginMm: { left: 25.4, right: 25.4, top: 25.4, bottom: 25.4 },
    settable: true,
  },
  fonts: { latin: 'Calibri', eastAsian: '맑은 고딕' },
  roles: [
    docxRole({ id: 'title', label: '제목', kind: 'title', size: 26, align: 'center', bold: true }),
    docxRole({
      id: 'heading-1',
      label: '대제목',
      kind: 'heading',
      heading: 1,
      size: 16,
      bold: true,
      spacingBefore: 12,
    }),
    docxRole(),
  ],
  skeleton: [
    { slot: 'title', role: 'title', required: true },
    { slot: 'body', roles: ['heading-1', 'body'], repeat: true },
  ],
  ...over,
})

const pptxRole = (over: Record<string, unknown> = {}) => ({
  id: 'slide-title',
  label: '슬라이드 제목',
  kind: 'title',
  size: 32,
  bold: true,
  align: 'left',
  box: { x: 0.06, y: 0.05, w: 0.88, h: 0.15 },
  ...over,
})
const pptx = (over: Record<string, unknown> = {}) => ({
  format: 'pptx',
  id: 'test-deck',
  title: '시험 발표',
  version: 1,
  evidence: { documents: 5, note: '합성 값' },
  slide: { ratio: '16:9' },
  theme: {
    fontMajor: 'Calibri',
    fontMinor: 'Calibri',
    fontEastAsian: '맑은 고딕',
    colors: { dark: '#1F2937', light: '#FFFFFF', accent: ['#1F4FD8', '#12805C'] },
  },
  roles: [
    pptxRole(),
    pptxRole({
      id: 'body-1',
      label: '본문',
      kind: 'body',
      size: 20,
      bold: false,
      box: { x: 0.06, y: 0.25, w: 0.88, h: 0.65 },
    }),
  ],
  layouts: [
    { id: 'cover', label: '표지', use: '첫 장', elements: [{ role: 'slide-title' }] },
    {
      id: 'content',
      label: '본문',
      use: '내용 장',
      elements: [{ role: 'slide-title' }, { role: 'body-1' }],
    },
  ],
  skeleton: [
    { slot: 'cover', layout: 'cover', required: true },
    { slot: 'content', layout: 'content', repeat: true },
  ],
  ...over,
})

describe('parseAnyStylePage — format dispatch', () => {
  it('reads a docx page and keeps its fields', () => {
    const r = parseAnyStylePage(wrap(docx()))
    expect(r.ok).toBe(true)
    if (!r.ok || r.style.format !== 'docx') throw new Error('expected docx')
    expect(r.style.roles[1]).toMatchObject({ kind: 'heading', heading: 1, size: 16 })
    expect(r.style.page.marginMm.left).toBe(25.4)
    expect(r.description).toContain('설명입니다')
  })

  it('reads a pptx page', () => {
    const r = parseAnyStylePage(wrap(pptx()))
    expect(r.ok).toBe(true)
    if (!r.ok || r.style.format !== 'pptx') throw new Error('expected pptx')
    expect(r.style.layouts).toHaveLength(2)
    expect(r.style.theme.colors.accent).toEqual(['#1F4FD8', '#12805C'])
  })

  it('treats a page without a format as a Hangul page (the existing pages)', () => {
    const hwp = {
      id: 'old-page',
      title: '옛 페이지',
      version: 1,
      evidence: { documents: 1, note: '합성' },
      page: {
        paper: 'A4',
        marginMm: { left: 20, right: 15, top: 20, bottom: 15 },
        settable: false,
      },
      roles: [
        {
          id: 'item-1',
          label: '항목',
          marker: 'N.',
          lead: 0,
          size: 13,
          bold: false,
          align: 'justify',
          marginLeft: 0,
          marginRight: 0,
          indent: 0,
          spacingBefore: 0,
          spacingAfter: 0,
          lineSpacing: 160,
        },
      ],
      skeleton: [{ slot: 'body', role: 'item-1' }],
    }
    const r = parseAnyStylePage(wrap(hwp))
    expect(r.ok && r.style.format).toBe('hwp')
  })

  it('rejects an unknown format', () => {
    const r = parseAnyStylePage(wrap(docx({ format: 'odt' })))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/format/)
  })

  it('the Hangul-only parser refuses a docx page', () => {
    const r = parseStylePage(wrap(docx()))
    expect(r.ok).toBe(false)
  })
})

describe('docx page validation', () => {
  it.each([
    ['unknown role kind', docx({ roles: [docxRole({ kind: 'footnote' })] }), /kind/],
    ['heading without a level', docx({ roles: [docxRole({ kind: 'heading' })] }), /heading/],
    [
      'heading level out of range',
      docx({ roles: [docxRole({ kind: 'heading', heading: 7 })] }),
      /heading/,
    ],
    ['size out of range', docx({ roles: [docxRole({ size: 3 })] }), /size/],
    ['size not in half points', docx({ roles: [docxRole({ size: 10.3 })] }), /size/],
    ['line spacing out of range', docx({ roles: [docxRole({ lineSpacing: 9 })] }), /lineSpacing/],
    ['negative spacing', docx({ roles: [docxRole({ spacingBefore: -1 })] }), /spacingBefore/],
    ['bad alignment', docx({ roles: [docxRole({ align: 'middle' })] }), /align/],
    ['bad color', docx({ roles: [docxRole({ color: 'red' })] }), /color/],
    ['font name not a string', docx({ fonts: { latin: 5 } }), /fonts/],
    ['duplicate role id', docx({ roles: [docxRole(), docxRole()] }), /duplicate/],
    [
      'skeleton points at a missing role',
      docx({ skeleton: [{ slot: 'x', role: 'nope' }] }),
      /nope/,
    ],
    [
      'margin out of range',
      docx({
        page: {
          paper: 'A4',
          orientation: 'portrait',
          marginMm: { left: 900, right: 1, top: 1, bottom: 1 },
          settable: true,
        },
      }),
      /marginMm/,
    ],
    [
      'bad orientation',
      docx({
        page: {
          paper: 'A4',
          orientation: 'tilted',
          marginMm: { left: 1, right: 1, top: 1, bottom: 1 },
          settable: true,
        },
      }),
      /orientation/,
    ],
  ])('rejects %s', (_label, page, pattern) => {
    const r = parseAnyStylePage(wrap(page))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(pattern as RegExp)
  })

  it('accepts an optional color, italic and bullet', () => {
    const r = parseAnyStylePage(
      wrap(
        docx({
          roles: [docxRole({ color: '#1F4FD8', italic: true, bullet: 'bullet' })],
          skeleton: [{ slot: 'b', role: 'body' }],
        }),
      ),
    )
    expect(r.ok).toBe(true)
  })
})

describe('pptx page validation', () => {
  it.each([
    ['unknown ratio', pptx({ slide: { ratio: '21:9' } }), /ratio/],
    [
      'bad theme color',
      pptx({
        theme: {
          fontMajor: 'A',
          fontMinor: 'B',
          colors: { dark: 'x', light: '#FFFFFF', accent: [] },
        },
      }),
      /color/,
    ],
    [
      'too many accent colors',
      pptx({
        theme: {
          fontMajor: 'A',
          fontMinor: 'B',
          colors: { dark: '#000000', light: '#FFFFFF', accent: Array(9).fill('#112233') },
        },
      }),
      /accent/,
    ],
    [
      'box outside the slide',
      pptx({ roles: [pptxRole({ box: { x: 0.9, y: 0, w: 0.5, h: 0.1 } })] }),
      /box/,
    ],
    ['unknown role kind', pptx({ roles: [pptxRole({ kind: 'footer-note' })] }), /kind/],
    ['size out of range', pptx({ roles: [pptxRole({ size: 1 })] }), /size/],
    ['duplicate role id', pptx({ roles: [pptxRole(), pptxRole()] }), /duplicate/],
    [
      'layout element points at a missing role',
      pptx({ layouts: [{ id: 'lay-x', label: 'x', use: 'x', elements: [{ role: 'nope' }] }] }),
      /nope/,
    ],
    [
      'duplicate layout id',
      pptx({
        layouts: [
          { id: 'lay-a', label: 'a', use: 'a', elements: [{ role: 'slide-title' }] },
          { id: 'lay-a', label: 'a', use: 'a', elements: [{ role: 'slide-title' }] },
        ],
      }),
      /duplicate/,
    ],
    [
      'skeleton points at a missing layout',
      pptx({ skeleton: [{ slot: 'x', layout: 'nope' }] }),
      /nope/,
    ],
    ['no layouts', pptx({ layouts: [] }), /layouts/],
  ])('rejects %s', (_label, page, pattern) => {
    const r = parseAnyStylePage(wrap(page))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(pattern as RegExp)
  })
})

describe('pptx page design (backgrounds, decoration, color tokens)', () => {
  const designed = (over: Record<string, unknown> = {}) =>
    pptx({
      theme: {
        fontMajor: 'Calibri',
        fontMinor: 'Calibri',
        colors: { dark: '#14213D', light: '#FFFFFF', accent: ['#2563EB', '#0EA5A4'] },
      },
      roles: [
        pptxRole({ id: 'slide-title', color: 'dark' }),
        pptxRole({
          id: 'body-1',
          label: '본문',
          kind: 'body',
          size: 20,
          bold: false,
          color: 'mute',
          box: { x: 0.06, y: 0.25, w: 0.88, h: 0.65 },
        }),
        pptxRole({ id: 'card-title', label: '카드 제목', kind: 'label', size: 22, bold: true }),
      ],
      layouts: [
        {
          id: 'cover',
          label: '표지',
          use: '첫 장',
          background: 'dark',
          decor: [{ shape: 'rect', box: { x: 0, y: 0.9, w: 1, h: 0.1 }, fill: 'accent1' }],
          elements: [{ role: 'slide-title', color: 'light' }],
        },
        {
          id: 'cards',
          label: '카드',
          use: '세 가지를 나란히',
          background: 'light',
          decor: [{ shape: 'roundRect', box: { x: 0.06, y: 0.3, w: 0.28, h: 0.5 }, fill: 'tint' }],
          elements: [
            { role: 'card-title', key: 'card-1', box: { x: 0.08, y: 0.32, w: 0.24, h: 0.1 } },
            { role: 'card-title', key: 'card-2', box: { x: 0.38, y: 0.32, w: 0.24, h: 0.1 } },
          ],
        },
      ],
      skeleton: [
        { slot: 'cover', layout: 'cover', required: true },
        { slot: 'cards', layout: 'cards', repeat: true },
      ],
      ...over,
    })

  it('reads backgrounds, decoration, keyed elements and color tokens', () => {
    const r = parseAnyStylePage(wrap(designed()))
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (!r.ok || r.style.format !== 'pptx') throw new Error('expected pptx')
    expect(r.style.layouts[0]).toMatchObject({
      background: 'dark',
      decor: [{ shape: 'rect', fill: 'accent1' }],
    })
    expect(r.style.layouts[0]!.elements[0]).toMatchObject({ role: 'slide-title', color: 'light' })
    expect(r.style.layouts[1]!.elements.map((e) => e.key)).toEqual(['card-1', 'card-2'])
    expect(r.style.roles[1]).toMatchObject({ color: 'mute' })
  })

  it.each([
    [
      'an unknown background token',
      {
        layouts: [
          {
            id: 'lay-a',
            label: 'a',
            use: 'a',
            background: 'purple',
            elements: [{ role: 'slide-title' }],
          },
        ],
      },
      /background/,
    ],
    [
      'an unknown decoration shape',
      {
        layouts: [
          {
            id: 'lay-a',
            label: 'a',
            use: 'a',
            decor: [{ shape: 'star', box: { x: 0, y: 0, w: 0.1, h: 0.1 }, fill: 'dark' }],
            elements: [{ role: 'slide-title' }],
          },
        ],
      },
      /shape/,
    ],
    [
      'a decoration box outside the slide',
      {
        layouts: [
          {
            id: 'lay-a',
            label: 'a',
            use: 'a',
            decor: [{ shape: 'rect', box: { x: 0.9, y: 0, w: 0.5, h: 0.1 }, fill: 'dark' }],
            elements: [{ role: 'slide-title' }],
          },
        ],
      },
      /box/,
    ],
    [
      'a decoration with a bad color',
      {
        layouts: [
          {
            id: 'lay-a',
            label: 'a',
            use: 'a',
            decor: [{ shape: 'rect', box: { x: 0, y: 0, w: 0.1, h: 0.1 }, fill: 'red' }],
            elements: [{ role: 'slide-title' }],
          },
        ],
      },
      /fill/,
    ],
    [
      'too many decoration shapes',
      {
        layouts: [
          {
            id: 'lay-a',
            label: 'a',
            use: 'a',
            decor: Array.from({ length: 13 }, () => ({
              shape: 'rect',
              box: { x: 0, y: 0, w: 0.1, h: 0.1 },
              fill: 'dark',
            })),
            elements: [{ role: 'slide-title' }],
          },
        ],
      },
      /decor/,
    ],
    [
      'a duplicate element key',
      {
        layouts: [
          {
            id: 'lay-a',
            label: 'a',
            use: 'a',
            elements: [{ role: 'slide-title' }, { role: 'slide-title' }],
          },
        ],
      },
      /duplicate/,
    ],
    [
      'a bad element color',
      {
        layouts: [
          { id: 'lay-a', label: 'a', use: 'a', elements: [{ role: 'slide-title', color: 'pink' }] },
        ],
      },
      /color/,
    ],
    ['a bad role color', { roles: [pptxRole({ color: 'pink' })] }, /color/],
  ])('rejects %s', (_label, over, pattern) => {
    const base = designed(over as Record<string, unknown>)
    const r = parseAnyStylePage(
      wrap({
        ...base,
        skeleton: [
          {
            slot: 'x',
            layout: (over as { layouts?: Array<{ id: string }> }).layouts?.[0]?.id ?? 'cover',
          },
        ],
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(pattern as RegExp)
  })
})
