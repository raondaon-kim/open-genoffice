import { describe, expect, it } from 'vitest'
import { askChapter, askJson } from '../src/budget'
import type { LlmPort, LlmReply } from '../src/types'

const P = { system: 's', user: 'u' }

describe('askJson', () => {
  it('asks the plan again with a larger budget after an empty reasoning-only reply', async () => {
    const seen: number[] = []
    const llm: LlmPort = async (r) => {
      seen.push(r.maxTokens)
      return seen.length < 2
        ? { status: 'empty', text: '' }
        : { status: 'complete', text: '```json\n{"a":1}\n```' }
    }
    expect(await askJson(llm, P, JSON.parse)).toEqual({ ok: true, value: { a: 1 } })
    expect(seen).toEqual([16384, 32768])
  })

  it('a plan that never parses fails after 65,536', async () => {
    const seen: number[] = []
    const r = await askJson(
      async (q) => (seen.push(q.maxTokens), { status: 'complete', text: 'not json' }),
      P,
      JSON.parse,
    )
    expect(r.ok).toBe(false)
    expect(seen).toEqual([16384, 32768, 65536])
  })

  it('stops at once when the run was cancelled', async () => {
    const ac = new AbortController()
    ac.abort()
    const seen: number[] = []
    const r = await askJson(
      async (q) => (seen.push(q.maxTokens), { status: 'stopped', text: '' }),
      P,
      JSON.parse,
      ac.signal,
    )
    expect(r).toEqual({ ok: false, error: 'cancelled' })
    expect(seen.length).toBeLessThanOrEqual(1)
  })
})

describe('askChapter', () => {
  it('a chapter cut with almost no text is asked again with twice the budget', async () => {
    const seen: number[] = []
    const llm: LlmPort = async (q) => (
      seen.push(q.maxTokens),
      seen.length === 1
        ? { status: 'max_tokens', text: '## 1' }
        : { status: 'complete', text: '## 1. 장\n본문' }
    )
    expect(await askChapter(llm, P)).toEqual({ ok: true, text: '## 1. 장\n본문' })
    expect(seen).toEqual([32768, 65536])
  })

  it('an empty chapter reply is asked again with twice the budget', async () => {
    const seen: number[] = []
    const llm: LlmPort = async (q) => (
      seen.push(q.maxTokens),
      seen.length === 1 ? { status: 'empty', text: '' } : { status: 'complete', text: '본문' }
    )
    expect(await askChapter(llm, P)).toEqual({ ok: true, text: '본문' })
    expect(seen).toEqual([32768, 65536])
  })

  it('a chapter cut after real text is continued and joined', async () => {
    const long = '가'.repeat(800)
    const replies: LlmReply[] = [
      { status: 'max_tokens', text: long },
      { status: 'complete', text: '끝' },
    ]
    const users: string[] = []
    const r = await askChapter(async (q) => (users.push(q.user), replies.shift()!), P)
    expect(r).toEqual({ ok: true, text: long + '끝' })
    expect(users[1]).toContain(long)
  })

  it('a chapter still cut after two continuations fails', async () => {
    const r = await askChapter(async () => ({ status: 'max_tokens', text: '가'.repeat(800) }), P)
    expect(r.ok).toBe(false)
  })

  it('an error reply fails the chapter with its message', async () => {
    const r = await askChapter(async () => ({ status: 'error', text: '', error: 'HTTP 500' }), P)
    expect(r).toEqual({ ok: false, error: 'HTTP 500' })
  })
})
