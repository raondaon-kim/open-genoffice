import { describe, expect, it } from 'vitest'
import { toRestorableMessages } from '../src'

describe('toRestorableMessages', () => {
  it('keeps text and carries the reasoning of assistant messages', () => {
    expect(
      toRestorableMessages([
        { role: 'user', text: 'q' },
        { role: 'assistant', text: 'a', reasoning: 'why' },
        { role: 'assistant', text: 'b' },
      ]),
    ).toEqual([
      { role: 'user', text: 'q' },
      { role: 'assistant', text: 'a', reasoning: 'why' },
      { role: 'assistant', text: 'b' },
    ])
  })

  it('never puts reasoning on a user message and leaves empty reasoning out', () => {
    const out = toRestorableMessages([
      { role: 'user', text: 'q', reasoning: 'ignored' },
      { role: 'assistant', text: 'a', reasoning: '' },
    ])
    expect(out[0]).toEqual({ role: 'user', text: 'q' })
    expect(out[1]).toEqual({ role: 'assistant', text: 'a' })
  })
})
