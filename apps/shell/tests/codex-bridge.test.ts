import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexBridge } from '../src/main/codex-bridge'
import type { BridgeCompleteRequest, CodexBridgeOptions } from '../src/main/codex-bridge'

let bridge: CodexBridge | null = null
afterEach(async () => {
  await bridge?.stop()
  bridge = null
})

async function boot(
  complete: (r: BridgeCompleteRequest) => Promise<void>,
  over: Partial<CodexBridgeOptions> = {},
) {
  bridge = new CodexBridge({ complete, model: () => 'gpt-test', requestTimeoutMs: 500, ...over })
  return bridge.start()
}

const call = (
  baseUrl: string,
  path: string,
  init: { token?: string; host?: string; body?: unknown } = {},
) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const u = new URL(baseUrl + path)
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: init.body === undefined ? 'GET' : 'POST',
        headers: {
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          ...(init.host ? { Host: init.host } : {}),
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let text = ''
        res.on('data', (d) => (text += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      },
    )
    req.on('error', reject)
    if (init.body !== undefined) req.write(JSON.stringify(init.body))
    req.end()
  })

const chat = (stream: boolean) => ({
  model: 'whatever',
  stream,
  messages: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  ],
})

describe('CodexBridge', () => {
  it('refuses a request without the token and one with a foreign Host', async () => {
    const { baseUrl, token } = await boot(async () => undefined)
    expect((await call(baseUrl, '/models')).status).toBe(401)
    expect((await call(baseUrl, '/models', { token: 'wrong' })).status).toBe(401)
    expect((await call(baseUrl, '/models', { token, host: 'evil.test' })).status).toBe(403)
    expect((await call(baseUrl, '/models', { token })).status).toBe(200)
  })

  it('lists the one model it serves', async () => {
    const { baseUrl, token } = await boot(async () => undefined)
    const r = JSON.parse((await call(baseUrl, '/models', { token })).text)
    expect(r.data.map((m: { id: string }) => m.id)).toEqual(['gpt-test'])
  })

  it('answers a plain chat completion from the Codex call', async () => {
    let seen: BridgeCompleteRequest | null = null
    const { baseUrl, token } = await boot(async (r) => {
      seen = r
      r.onDelta('안녕')
      r.onDelta('하세요')
    })
    const r = await call(baseUrl, '/chat/completions', { token, body: chat(false) })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text).choices[0].message).toEqual({
      role: 'assistant',
      content: '안녕하세요',
    })
    expect(seen!.system).toBe('be brief')
    expect(seen!.messages).toEqual([{ role: 'user', text: 'hello' }])
  })

  it('streams the reply as server-sent events ending with [DONE]', async () => {
    const { baseUrl, token } = await boot(async (r) => {
      r.onDelta('a')
      r.onDelta('b')
    })
    const r = await call(baseUrl, '/chat/completions', { token, body: chat(true) })
    const lines = r.text.split('\n').filter((l) => l.startsWith('data: '))
    expect(lines.at(-1)).toBe('data: [DONE]')
    const deltas = lines
      .slice(0, -1)
      .map((l) => JSON.parse(l.slice(6)).choices[0].delta.content ?? '')
    expect(deltas.join('')).toBe('ab')
  })

  it('serves two requests one after the other', async () => {
    const order: string[] = []
    const { baseUrl, token } = await boot(async (r) => {
      const first = r.messages[0]
      order.push(`start ${first && 'text' in first ? first.text : ''}`)
      await new Promise((res) => setTimeout(res, 40))
      order.push('end')
      r.onDelta('x')
    })
    const body = (text: string) => ({ messages: [{ role: 'user', content: text }] })
    await Promise.all([
      call(baseUrl, '/chat/completions', { token, body: body('one') }),
      call(baseUrl, '/chat/completions', { token, body: body('two') }),
    ])
    expect(order).toEqual(['start one', 'end', 'start two', 'end'])
  })

  it('aborts the Codex call when the client goes away', async () => {
    let aborted = false
    const { baseUrl, token } = await boot(
      (r) =>
        new Promise<void>((resolve) => {
          r.signal.addEventListener('abort', () => {
            aborted = true
            resolve()
          })
        }),
    )
    const u = new URL(baseUrl + '/chat/completions')
    await new Promise<void>((resolve) => {
      const req = request(
        {
          host: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        },
        () => undefined,
      )
      req.on('error', () => resolve())
      req.write(JSON.stringify(chat(false)))
      req.end()
      setTimeout(() => {
        req.destroy()
        resolve()
      }, 150)
    })
    await new Promise((r) => setTimeout(r, 150))
    expect(aborted).toBe(true)
  })

  it('answers 502 with the reason when Codex fails before any text', async () => {
    const { baseUrl, token } = await boot(async () => {
      throw new Error('Codex CLI is not signed in')
    })
    const r = await call(baseUrl, '/chat/completions', { token, body: chat(false) })
    expect(r.status).toBe(502)
    expect(JSON.parse(r.text).error.message).toContain('not signed in')
  })

  it('refuses a body over the limit and a bad body', async () => {
    const { baseUrl, token } = await boot(async () => undefined, { maxBodyBytes: 200 })
    const big = await call(baseUrl, '/chat/completions', {
      token,
      body: { messages: [{ role: 'user', content: 'x'.repeat(500) }] },
    })
    expect(big.status).toBe(413)
    const bad = await call(baseUrl, '/chat/completions', { token, body: { messages: 'no' } })
    expect(bad.status).toBe(400)
  })

  it('times a request out with 504', async () => {
    const { baseUrl, token } = await boot(() => new Promise<void>(() => undefined), {
      requestTimeoutMs: 60,
    })
    const r = await call(baseUrl, '/chat/completions', { token, body: chat(false) })
    expect(r.status).toBe(504)
  })
})
