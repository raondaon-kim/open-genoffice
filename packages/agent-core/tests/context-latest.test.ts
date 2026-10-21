/**
 * Per-question context (the work wiki catalog) rides on the newest user
 * message only: a skill's stripContext removes it from earlier messages
 * before each run, and buildContext gets the instruction and may be async.
 */
import { describe, expect, it, vi } from 'vitest'
import { AgentLoop, composeSkills } from '../src/index'
import type { AgentSkill, AgentStreamCallbacks, AgentTransport } from '../src/index'

function answeringTransport(): AgentTransport & { requests: number } {
  const transport = {
    requests: 0,
    stream(_request: unknown, cb: AgentStreamCallbacks) {
      transport.requests++
      queueMicrotask(() => {
        cb.onDelta('answer')
        cb.onDone()
      })
      return { cancel: () => queueMicrotask(() => cb.onDone()) }
    },
  }
  return transport
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

const CATALOG = /\n\n### 목차\n<<[\s\S]*?>>/g

function catalogSkill(over: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: 'cat',
    systemPrompt: 's',
    tools: [],
    buildContext: (instruction) => `### 목차\n<<about ${instruction}>>`,
    stripContext: (text) => text.replace(CATALOG, ''),
    executeTool: () => ({ output: '', summary: '' }),
    ...over,
  }
}

describe('context on the latest message only', () => {
  it('after three turns only the last user message carries the catalog', async () => {
    const loop = new AgentLoop({ transport: answeringTransport(), skill: catalogSkill() })
    for (const q of ['one', 'two', 'three']) {
      loop.run(q)
      await flush()
    }
    const users = loop.messages.filter((m) => m.role === 'user').map((m) => m.text)
    expect(users).toEqual(['one', 'two', 'three\n\n### 목차\n<<about three>>'])
  })

  it('a skill without stripContext is untouched', async () => {
    const loop = new AgentLoop({
      transport: answeringTransport(),
      skill: catalogSkill({ stripContext: undefined }),
    })
    for (const q of ['one', 'two']) {
      loop.run(q)
      await flush()
    }
    const users = loop.messages.filter((m) => m.role === 'user').map((m) => m.text)
    expect(users).toEqual(['one\n\n### 목차\n<<about one>>', 'two\n\n### 목차\n<<about two>>'])
  })

  it('an async buildContext is awaited and gets the instruction', async () => {
    const build = vi.fn(async (instruction: string) => `### 목차\n<<async ${instruction}>>`)
    const transport = answeringTransport()
    const loop = new AgentLoop({ transport, skill: catalogSkill({ buildContext: build }) })
    loop.run('hello')
    await flush()
    expect(build).toHaveBeenCalledWith('hello')
    expect(loop.messages[0]).toMatchObject({
      role: 'user',
      text: 'hello\n\n### 목차\n<<async hello>>',
    })
    expect(transport.requests).toBe(1)
  })

  it('an async buildContext that rejects fails the run and frees the loop', async () => {
    const onError = vi.fn()
    let boom = true
    const transport = answeringTransport()
    const loop = new AgentLoop({
      transport,
      skill: catalogSkill({
        buildContext: async () => {
          if (boom) {
            boom = false
            throw new Error('catalog down')
          }
          return ''
        },
      }),
      events: { onError },
    })
    loop.run('q')
    await flush()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('catalog down'))
    expect(loop.messages).toHaveLength(0)
    loop.run('q again')
    await flush()
    expect(transport.requests).toBe(1)
  })

  it('composeSkills passes the instruction, awaits async parts and chains stripContext', async () => {
    const sync: AgentSkill = {
      id: 'a',
      systemPrompt: '',
      tools: [],
      buildContext: () => 'DOC',
      executeTool: () => ({ output: '', summary: '' }),
    }
    const merged = composeSkills('m', '', [sync, catalogSkill()])
    expect(await merged.buildContext?.('q')).toBe('DOC\n\n### 목차\n<<about q>>')
    // all sync: the result stays a plain string
    expect(composeSkills('s', '', [sync]).buildContext?.('q')).toBe('DOC')
    expect(merged.stripContext?.('q\n\n### 목차\n<<x>>')).toBe('q')
    expect(composeSkills('s', '', [sync]).stripContext?.('keep')).toBe('keep')
  })
})

describe('stop and reset while the context is still being built', () => {
  function pendingSkill() {
    let resolve!: (ctx: string) => void
    const skill = catalogSkill({
      buildContext: () =>
        new Promise<string>((r) => {
          resolve = r
        }),
    })
    return { skill, finish: (ctx: string) => resolve(ctx) }
  }

  it('reset drops the run: nothing is sent and the next message runs', async () => {
    const { skill, finish } = pendingSkill()
    const transport = answeringTransport()
    const loop = new AgentLoop({ transport, skill })
    loop.run('first')
    loop.reset()
    finish('### 목차\n<<late>>')
    await flush()
    expect(transport.requests).toBe(0)
    expect(loop.messages).toHaveLength(0)
    loop.run('second')
    finish('')
    await flush()
    expect(transport.requests).toBe(1)
  })

  it('stop ends the run as cancelled once the context arrives, without a request', async () => {
    const { skill, finish } = pendingSkill()
    const transport = answeringTransport()
    const onDone = vi.fn()
    const loop = new AgentLoop({ transport, skill, events: { onDone } })
    loop.run('first')
    loop.cancel()
    finish('')
    await flush()
    expect(transport.requests).toBe(0)
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }))
    loop.run('second')
    finish('')
    await flush()
    expect(transport.requests).toBe(1)
  })
})
