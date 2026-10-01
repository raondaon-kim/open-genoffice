import { describe, expect, it } from 'vitest'
import { planFormat } from '../src/renderer/ai/router'

describe('planFormat (spec §14 routing)', () => {
  it('sends absolute character attributes to the CLI (apply-char-format, absolute, any RGB)', () => {
    expect(planFormat({ bold: true, strike: true, color: '#ff0000', fontSize: 14 })).toEqual({
      live: [],
      char: { bold: true, strikethrough: true, textColor: '#FF0000', fontSize: 14 },
      para: null,
    })
  })

  it('keeps alignment live when nothing needs a file edit, otherwise folds it into the CLI paragraph props', () => {
    expect(planFormat({ align: 'center' })).toEqual({
      live: ['format:align-center'],
      char: null,
      para: null,
    })
    expect(planFormat({ align: 'division' }).live).toEqual(['format:align-split'])
    expect(planFormat({ align: 'center', italic: true })).toEqual({
      live: [],
      char: { italic: true },
      para: { alignment: 'center' },
    })
  })

  it('expands relative deltas into repeated live commands', () => {
    expect(planFormat({ sizeDelta: 2 }).live).toEqual([
      'format:font-size-increase',
      'format:font-size-increase',
    ])
    expect(planFormat({ sizeDelta: -1, lineSpacingDelta: 1 }).live).toEqual([
      'format:font-size-decrease',
      'format:line-spacing-increase',
    ])
    expect(planFormat({ sizeDelta: 1, bold: true })).toEqual({
      live: ['format:font-size-increase'],
      char: { bold: true },
      para: null,
    })
  })

  it('clear resets every character attribute through the CLI', () => {
    expect(planFormat({ clear: true }).char).toEqual({
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      superscript: false,
      subscript: false,
      textColor: '#000000',
    })
  })

  it('rejects empty specs, bad colors, huge deltas and unknown alignments', () => {
    expect(() => planFormat({})).toThrow(/at least one/)
    expect(() => planFormat({ color: 'red' })).toThrow(/#rrggbb/)
    expect(() => planFormat({ sizeDelta: 11 })).toThrow(/10/)
    expect(() => planFormat({ align: 'middle' as never })).toThrow(/align/)
    expect(() => planFormat({ fontSize: 0 })).toThrow(/fontSize/)
  })
})
