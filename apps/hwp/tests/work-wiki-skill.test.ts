import { describe, expect, it } from 'vitest'
import { createHwpAssistantSkill } from '../src/renderer/ai/assistant-skill'
import { ctxWith, fakeApi } from './helpers/ai-fakes'

describe('the Hangul assistant skill', () => {
  it('includes the work wiki: its tools and rules, without tool-name clashes', () => {
    const api = fakeApi()
    const skill = createHwpAssistantSkill(
      ctxWith(api),
      () => [],
      () => api,
      () => undefined,
    )
    const names = skill.tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['wiki_search', 'wiki_read', 'wiki_remember']))
    expect(names).toEqual(expect.arrayContaining(['read_attachment']))
    expect(new Set(names).size).toBe(names.length)
    expect(skill.systemPrompt).toContain('업무 위키')
  })
})
