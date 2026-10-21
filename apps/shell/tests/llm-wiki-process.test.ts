import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { hitOfSearchResult, LlmWikiProcess } from '../src/main/llm-wiki-process'
import type {
  ChildLike,
  FetchLike,
  LlmWikiProcessOptions,
  StalePid,
} from '../src/main/llm-wiki-process'

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242
  killed = false
  kill(): boolean {
    this.killed = true
    this.emit('exit', 1)
    return true
  }
}

/** a fake LLM Wiki: healthy after `healthyAfter` calls, quits on POST /app/quit */
function fakeWorld(opts: { healthyAfter?: number; neverHealthy?: boolean } = {}) {
  const children: FakeChild[] = []
  const calls: Array<{ url: string; method: string; auth?: string; body?: string }> = []
  let healthCalls = 0
  const spawn = vi.fn((_exe: string, _env: NodeJS.ProcessEnv) => {
    const c = new FakeChild()
    children.push(c)
    return c
  })
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      auth: init?.headers?.Authorization,
      body: init?.body,
    })
    if (url.endsWith('/health')) {
      healthCalls++
      const up = !opts.neverHealthy && healthCalls > (opts.healthyAfter ?? 0)
      return { ok: up, status: up ? 200 : 503, json: async () => ({ ok: up }) }
    }
    if (url.endsWith('/app/quit')) {
      setTimeout(() => children.at(-1)?.emit('exit', 0), 5)
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (url.endsWith('/app/show'))
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    if (url.endsWith('/index/rebuild'))
      return { ok: true, status: 200, json: async () => ({ ok: true, queued: true }) }
    if (url.includes('/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          results: [
            {
              path: 'wiki/entities/koica.md',
              title: 'KOICA',
              snippet: '한국국제협력단',
              score: 0.9,
            },
          ],
        }),
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { children, calls, spawn, fetch }
}

const stale = (over: Partial<StalePid> = {}): StalePid => ({
  read: () => null,
  write: vi.fn(),
  clear: vi.fn(),
  isLlmWiki: () => false,
  kill: vi.fn(),
  ...over,
})

const make = (world: ReturnType<typeof fakeWorld>, over: Partial<LlmWikiProcessOptions> = {}) =>
  new LlmWikiProcess({
    exePath: 'C:/res/llm-wiki/llm-wiki.exe',
    projectId: 'p-1',
    token: 'tok',
    spawn: world.spawn,
    fetch: world.fetch,
    pickPorts: async () => ({ api: 51001, clip: 51002 }),
    stale: stale(),
    healthTimeoutMs: 400,
    pollMs: 10,
    quitWaitMs: 200,
    backoffMs: [5, 5, 5],
    ...over,
  })

describe('LlmWikiProcess', () => {
  it('starts the program in managed mode with its own ports and token, and waits until it is healthy', async () => {
    const world = fakeWorld({ healthyAfter: 2 })
    const p = make(world)
    expect(await p.start()).toBe(true)
    expect(p.status().state).toBe('running')
    const env = world.spawn.mock.calls[0]![1]
    expect(env).toMatchObject({
      LLM_WIKI_MANAGED: '1',
      LLM_WIKI_API_PORT: '51001',
      LLM_WIKI_CLIP_PORT: '51002',
      LLM_WIKI_API_TOKEN: 'tok',
    })
    expect(world.calls.some((c) => c.url === 'http://127.0.0.1:51001/health')).toBe(true)
  })

  it('reports failed with a reason when it never becomes healthy, and stops the child', async () => {
    const world = fakeWorld({ neverHealthy: true })
    const p = make(world)
    expect(await p.start()).toBe(false)
    expect(p.status()).toMatchObject({ state: 'failed' })
    expect(p.status().reason).toMatch(/health/i)
    expect(world.children[0]!.killed).toBe(true)
  })

  it('restarts after an unexpected exit, up to three times, then gives up with a reason', async () => {
    const world = fakeWorld()
    const p = make(world)
    await p.start()
    for (let i = 0; i < 4; i++) {
      world.children.at(-1)!.emit('exit', 1)
      await new Promise((r) => setTimeout(r, 60))
    }
    expect(world.spawn).toHaveBeenCalledTimes(4) // first start + three restarts
    expect(p.status()).toMatchObject({ state: 'failed' })
    expect(p.status().reason).toMatch(/exited/i)
  })

  it('stopAndWait asks it to quit with the token, waits for it, and does not restart', async () => {
    const world = fakeWorld()
    const p = make(world)
    await p.start()
    await p.stopAndWait()
    const quit = world.calls.find((c) => c.url.endsWith('/app/quit'))!
    expect(quit).toMatchObject({ method: 'POST', auth: 'Bearer tok' })
    expect(p.status().state).toBe('stopped')
    expect(world.spawn).toHaveBeenCalledTimes(1)
    expect(world.children[0]!.killed).toBe(false)
  })

  it('kills it when it does not quit in time', async () => {
    const world = fakeWorld()
    const slowFetch: FetchLike = async (url, init) =>
      url.endsWith('/app/quit')
        ? { ok: true, status: 200, json: async () => ({}) }
        : world.fetch(url, init)
    const p = make(world, { fetch: slowFetch, quitWaitMs: 30 })
    await p.start()
    await p.stopAndWait()
    expect(world.children[0]!.killed).toBe(true)
  })

  it('stops a program left over from a GenOffice that crashed, before starting', async () => {
    const world = fakeWorld()
    const s = stale({ read: () => 777, isLlmWiki: (pid) => pid === 777 })
    const p = make(world, { stale: s })
    await p.start()
    expect(s.kill).toHaveBeenCalledWith(777)
    expect(s.write).toHaveBeenCalledWith(4242)
    await p.stopAndWait()
    expect(s.clear).toHaveBeenCalled()
  })

  it('does not kill a pid that is not LLM Wiki', async () => {
    const world = fakeWorld()
    const s = stale({ read: () => 888, isLlmWiki: () => false })
    await make(world, { stale: s }).start()
    expect(s.kill).not.toHaveBeenCalled()
  })

  it('show posts to the app route, search maps results to wiki hits, and both are quiet when not running', async () => {
    const world = fakeWorld()
    const p = make(world)
    expect(await p.show()).toBe(false)
    expect(await p.search('코이카')).toEqual([])
    await p.start()
    expect(await p.show()).toBe(true)
    const hits = await p.search('코이카')
    expect(hits).toEqual([
      {
        id: 'entities/koica',
        kind: 'entity',
        title: 'KOICA',
        summary: '한국국제협력단',
        score: 0.9,
      },
    ])
    const call = world.calls.find((c) => c.url.includes('/projects/p-1/search'))!
    expect(JSON.parse(call.body!)).toMatchObject({ query: '코이카' })
  })

  it('rebuildIndex posts to the project index route and is false when not running', async () => {
    const world = fakeWorld()
    const p = make(world)
    expect(await p.rebuildIndex()).toBe(false)
    expect(world.calls.some((c) => c.url.includes('/index/rebuild'))).toBe(false)
    await p.start()
    expect(await p.rebuildIndex()).toBe(true)
    const call = world.calls.find((c) => c.url.endsWith('/projects/p-1/index/rebuild'))!
    expect(call.method).toBe('POST')
    expect(call.auth).toBe('Bearer tok')
  })

  it('a start that throws (spawn failure) is a failed state, not an exception', async () => {
    const world = fakeWorld()
    const p = make(world, {
      spawn: () => {
        throw new Error('ENOENT')
      },
    })
    await expect(p.start()).resolves.toBe(false)
    expect(p.status()).toMatchObject({ state: 'failed', reason: 'ENOENT' })
  })
})

describe('hitOfSearchResult', () => {
  it('keeps pages under wiki/ and drops everything else', () => {
    expect(
      hitOfSearchResult({
        path: 'wiki/concepts/pdm.md',
        title: 'PDM',
        snippet: '논리모형',
        score: 0.5,
      }),
    ).toEqual({
      id: 'concepts/pdm',
      kind: 'concept',
      title: 'PDM',
      summary: '논리모형',
      score: 0.5,
    })
    expect(
      hitOfSearchResult({ path: 'wiki/sources/a.md', title: 'a', snippet: '', score: 1 }),
    ).toMatchObject({ kind: 'source' })
    expect(hitOfSearchResult({ path: 'raw/sources/a.md', title: 'a' })).toBeNull()
    expect(hitOfSearchResult({ path: 'wiki/queries/q.md', title: 'q' })).toMatchObject({
      kind: 'other',
    })
    expect(hitOfSearchResult('nope')).toBeNull()
  })
})
