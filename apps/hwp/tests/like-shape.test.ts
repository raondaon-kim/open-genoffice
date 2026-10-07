import { describe, expect, it } from 'vitest'
import { expandLike, expandSetText } from '../src/main/like-shape'
import { DELETE_ALL_COUNT } from '../src/main/rhwp-edit-ops'
import type { LikeDynamic } from '../src/main/rhwp-edit-ops'
import type { DumpParagraph } from '../src/main/rhwp-paragraphs'

const para = (
  paragraph: number,
  preview: string,
  over: Partial<DumpParagraph> = {},
): DumpParagraph => ({
  section: 0,
  paragraph,
  preview,
  length: preview.length,
  empty: preview === '',
  hasTable: false,
  ...over,
})

const doc: DumpParagraph[] = [
  para(0, '□ 배경', {
    lead: 0,
    fontSize: 15,
    bold: false,
    align: 'justify',
    marginLeft: 0,
    marginRight: 0,
    indent: -7140,
    spacingBefore: 800,
    spacingAfter: 0,
    lineSpacing: 160,
  }),
  para(1, '○ 내용', {
    lead: 1,
    fontSize: 15,
    bold: true,
    align: 'left',
    marginLeft: 100,
    marginRight: 200,
    indent: -6400,
    spacingBefore: 0,
    spacingAfter: 50,
    lineSpacing: 150,
  }),
  para(2, '- 세부', {
    lead: 3,
    fontSize: 14,
    bold: false,
    align: 'justify',
    marginLeft: 0,
    marginRight: 0,
    indent: -5600,
    spacingBefore: 0,
    spacingAfter: 0,
  }),
  para(3, ''),
]

const dyn = (over: Partial<LikeDynamic> = {}): LikeDynamic => ({
  like: { section: 0, paragraph: 1 },
  target: { section: 0, paragraph: 2 },
  text: '○ 새 내용',
  depth: 0,
  ...over,
})

describe('expandLike', () => {
  it('turns the template step into insert, text, paragraph shape and character shape', () => {
    const result = expandLike(4, dyn(), doc)
    expect(result).toEqual({
      ok: true,
      steps: [
        { opIndex: 4, command: 'insert-paragraph', flags: ['--section', '0', '--para', '3'] },
        {
          opIndex: 4,
          command: 'insert-text',
          flags: ['--section', '0', '--para', '3', '--offset', '0', '--text', ' ○ 새 내용'],
        },
        {
          opIndex: 4,
          command: 'apply-para-format',
          flags: [
            '--props',
            '{"alignment":"left","marginLeft":100,"marginRight":200,"indent":-6400,"spacingBefore":0,"spacingAfter":50,"lineSpacing":150}',
            '--section',
            '0',
            '--para',
            '3',
          ],
        },
        {
          opIndex: 4,
          command: 'apply-char-format',
          flags: ['--props', '{"fontSize":1500,"bold":true}', '--section', '0', '--para', '3'],
        },
      ],
    })
  })

  it('writes the engine word for an alignment the dump prints differently (Split = division)', () => {
    const split = [
      para(0, '○ 가', { lead: 0, align: 'split', fontSize: 15, bold: false }),
      para(1, ''),
    ]
    const result = expandLike(0, dyn({ like: { section: 0, paragraph: 0 } }), split)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.parse(result.steps[2]!.flags[1]!)).toMatchObject({ alignment: 'division' })
  })

  it('leaves out properties the model paragraph did not report', () => {
    const result = expandLike(0, dyn({ like: { section: 0, paragraph: 2 } }), doc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const props = JSON.parse(result.steps[2]!.flags[1]!)
    expect(props).not.toHaveProperty('lineSpacing')
    expect(props).toMatchObject({ alignment: 'justify', indent: -5600 })
  })

  it('derives a deeper level by adding the document step to the leading spaces', () => {
    const result = expandLike(0, dyn({ depth: 1 }), doc)
    expect(result).toMatchObject({ ok: true, derived: { lead: 3, step: 2 } })
    if (!result.ok) return
    expect(result.steps[1]!.flags.at(-1)).toBe('   ○ 새 내용')
  })

  it('never goes below zero leading spaces', () => {
    const result = expandLike(0, dyn({ depth: -3 }), doc)
    expect(result).toMatchObject({ ok: true, derived: { lead: 0 } })
    if (!result.ok) return
    expect(result.steps[1]!.flags.at(-1)).toBe('○ 새 내용')
  })

  it('refuses a model paragraph that does not exist or holds no text', () => {
    expect(expandLike(0, dyn({ like: { section: 0, paragraph: 9 } }), doc)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/does not exist/),
    })
    expect(expandLike(0, dyn({ like: { section: 0, paragraph: 3 } }), doc)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/blank.*form_map/s),
    })
  })
})

describe('expandSetText', () => {
  const offsetOf = (result: ReturnType<typeof expandSetText>, i: number) =>
    result.ok ? result.steps[i]!.flags[result.steps[i]!.flags.indexOf('--offset') + 1] : undefined
  const withLead = (lead: number, leadChars: number): DumpParagraph[] => [
    para(0, '1. 관련', { lead, leadChars }),
    para(1, ''),
  ]
  const set = (text: string, target = 0) => ({ target: { section: 0, paragraph: target }, text })

  it('keeps the leading spaces of the paragraph when the new text has none', () => {
    expect(expandSetText(2, set('2. 새 본문'), withLead(10, 10))).toEqual({
      ok: true,
      steps: [
        {
          opIndex: 2,
          command: 'delete-text',
          flags: [
            '--section',
            '0',
            '--para',
            '0',
            '--offset',
            '10',
            '--count',
            String(DELETE_ALL_COUNT),
          ],
        },
        {
          opIndex: 2,
          command: 'insert-text',
          flags: ['--section', '0', '--para', '0', '--offset', '10', '--text', '2. 새 본문'],
        },
      ],
    })
  })

  it('counts characters, so a tab or ideographic space is kept as it is', () => {
    const result = expandSetText(0, set('새 본문'), withLead(5, 2))
    expect(offsetOf(result, 0)).toBe('2')
  })

  it('follows the text exactly when the model typed leading spaces itself', () => {
    const result = expandSetText(0, set('   새 본문'), withLead(10, 10))
    expect(offsetOf(result, 0)).toBe('0')
    expect(result.ok && result.steps[1]!.flags.at(-1)).toBe('   새 본문')
  })

  it('clears a paragraph completely when the text is empty', () => {
    const result = expandSetText(0, set(''), withLead(10, 10))
    expect(result).toMatchObject({ ok: true, steps: [{ command: 'delete-text' }] })
    expect(result.ok && result.steps).toHaveLength(1)
    expect(offsetOf(result, 0)).toBe('0')
  })

  it('writes from offset 0 when the paragraph has no leading spaces or is not found', () => {
    for (const [paras, target] of [
      [withLead(0, 0), 0],
      [withLead(10, 10), 9],
    ] as const) {
      const result = expandSetText(0, set('본문', target), paras as DumpParagraph[])
      expect(offsetOf(result, 1)).toBe('0')
    }
  })
})
