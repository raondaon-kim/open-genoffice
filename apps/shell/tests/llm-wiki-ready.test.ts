import { describe, expect, it, vi } from 'vitest'
import { waitForWiki } from '../src/main/llm-wiki-ready'
import type { LlmWikiStatus } from '../src/main/llm-wiki-process'

const seq = (...states: LlmWikiStatus[]) => {
  let i = 0
  return () => states[Math.min(i++, states.length - 1)]!
}

describe('waitForWiki', () => {
  it('waits while starting and succeeds once running', async () => {
    const restart = vi.fn(async () => {})
    const r = await waitForWiki({
      enabled: () => true,
      status: seq({ state: 'starting' }, { state: 'starting' }, { state: 'running' }),
      restart,
      pollMs: 1,
    })
    expect(r).toEqual({ ok: true })
    expect(restart).not.toHaveBeenCalled()
  })

  it('restarts a failed wiki once and succeeds', async () => {
    const restart = vi.fn(async () => {})
    const r = await waitForWiki({
      enabled: () => true,
      status: seq(
        { state: 'failed', reason: 'crashed' },
        { state: 'starting' },
        { state: 'running' },
      ),
      restart,
      pollMs: 1,
    })
    expect(r).toEqual({ ok: true })
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('gives up after one restart with the reason', async () => {
    const restart = vi.fn(async () => {})
    const r = await waitForWiki({
      enabled: () => true,
      status: () => ({ state: 'failed', reason: 'health check timed out' }),
      restart,
      pollMs: 1,
    })
    expect(r).toEqual({ ok: false, off: false, reason: 'health check timed out' })
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('a wiki switched off is reported without a restart', async () => {
    const restart = vi.fn(async () => {})
    const r = await waitForWiki({
      enabled: () => false,
      status: () => ({ state: 'stopped' }),
      restart,
    })
    expect(r).toMatchObject({ ok: false, off: true })
    expect(restart).not.toHaveBeenCalled()
  })

  it('never waits longer than waitMs', async () => {
    const started = Date.now()
    const r = await waitForWiki({
      enabled: () => true,
      status: () => ({ state: 'starting' }),
      restart: async () => {},
      waitMs: 60,
      pollMs: 5,
    })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(r).toMatchObject({ ok: false, off: false })
  })
})
