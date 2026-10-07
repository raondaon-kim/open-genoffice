import { describe, expect, it } from 'vitest'
import { shouldRebindChat } from '../src/renderer/ai/chat-identity'

describe('shouldRebindChat', () => {
  it('keeps an unsaved conversation when the document is saved for the first time', () => {
    expect(
      shouldRebindChat({ projectId: 'default', chatId: 'unsaved-1-abc' }, 'D:/x/품의서_작성.hwp'),
    ).toBe(true)
  })

  it('loads the file conversation in every other case', () => {
    expect(shouldRebindChat(null, 'D:/x/a.hwp')).toBe(false)
    expect(shouldRebindChat({ projectId: 'default', chatId: 'unsaved-1-abc' }, null)).toBe(false)
    expect(shouldRebindChat({ projectId: 'p', chatId: '0123456789abcdef' }, 'D:/x/b.hwp')).toBe(
      false,
    )
  })
})
