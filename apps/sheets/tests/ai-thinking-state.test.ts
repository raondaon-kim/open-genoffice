import { describe, expect, it } from 'vitest'
import {
  emptyThinkingState,
  thinkingFinish,
  thinkingTurnEnd,
  thinkingUpdate,
} from '../src/renderer/ai/thinking-state'

describe('sheets thinking state (one assistant entry spans a whole run)', () => {
  it('shows the current turn while it grows', () => {
    const a = thinkingUpdate(emptyThinkingState, 'plan ')
    const b = thinkingUpdate(a.state, 'plan step')
    expect(a.text).toBe('plan ')
    expect(b.text).toBe('plan step')
  })

  it('keeps finished turns when the next turn starts, separated by a blank line', () => {
    const turn1 = thinkingUpdate(emptyThinkingState, 'first')
    const ended = thinkingTurnEnd(turn1.state)
    const turn2 = thinkingUpdate(ended, 'second')
    expect(turn2.text).toBe('first\n\nsecond')
    const turn3 = thinkingUpdate(thinkingTurnEnd(turn2.state), 'third')
    expect(turn3.text).toBe('first\n\nsecond\n\nthird')
  })

  it('a turn end without thinking adds nothing', () => {
    const ended = thinkingTurnEnd(emptyThinkingState)
    expect(thinkingUpdate(ended, 'only').text).toBe('only')
  })

  it("finishing prefers the run's joined thinking and falls back to what was shown", () => {
    const shown = thinkingUpdate(emptyThinkingState, 'shown').text
    expect(thinkingFinish('joined run thinking', shown)).toBe('joined run thinking')
    expect(thinkingFinish(undefined, shown)).toBe('shown')
    expect(thinkingFinish(undefined, undefined)).toBeUndefined()
  })
})
