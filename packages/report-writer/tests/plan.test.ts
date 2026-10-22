import { describe, expect, it } from 'vitest'
import { validatePlan } from '../src/plan'

const brief = { purpose: 'p', reader: 'r', messages: [], terms: {} }
const ch = (no: number, owns: string[], wikiPages: string[], attachmentParts: string[]) => ({
  no,
  title: `장${no}`,
  point: 'p',
  owns,
  stances: ['s'],
  sections: ['x'],
  wikiPages,
  attachmentParts,
})

describe('validatePlan', () => {
  it('drops unknown pages and parts and keeps a topic with its first owner', () => {
    const raw = {
      brief,
      title: 'T',
      tocFromAttachment: false,
      chapters: [
        ch(1, ['규제'], ['concepts/a', 'concepts/ghost'], ['A1-1']),
        ch(2, ['규제', '역량'], [], ['A9-9']),
      ],
    }
    const plan = validatePlan(raw, { pages: new Set(['concepts/a']), parts: new Set(['A1-1']) })
    expect(plan.chapters[0]!.wikiPages).toEqual(['concepts/a'])
    expect(plan.chapters[0]!.attachmentParts).toEqual(['A1-1'])
    expect(plan.chapters[1]!.attachmentParts).toEqual([])
    expect(plan.chapters[1]!.owns).toEqual(['역량'])
  })

  it('defaults tocFromAttachment to false and renumbers chapters', () => {
    const plan = validatePlan(
      { brief, title: 'T', chapters: [ch(3, [], [], [])] },
      { pages: new Set(), parts: new Set() },
    )
    expect(plan.tocFromAttachment).toBe(false)
    expect(plan.chapters[0]!.no).toBe(1)
  })

  it('keeps a page named without its folder when the index lists it under one', () => {
    const plan = validatePlan(
      { brief, title: 'T', chapters: [ch(1, [], ['unesco'], [])] },
      { pages: new Set(['entities/unesco']), parts: new Set() },
    )
    expect(plan.chapters[0]!.wikiPages).toEqual(['entities/unesco'])
  })

  it('rejects a plan without a title or chapters', () => {
    expect(() =>
      validatePlan({ brief, chapters: [] }, { pages: new Set(), parts: new Set() }),
    ).toThrow()
    expect(() =>
      validatePlan({ brief, title: 'T', chapters: [] }, { pages: new Set(), parts: new Set() }),
    ).toThrow()
  })
})
