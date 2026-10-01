import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexRpc, RpcMessage } from '../src/codex-app-server'
import {
  CodexAccountMonitor,
  cancelCodexLogin,
  codexVersionFromUserAgent,
  loginCodexWithApiKey,
  logoutCodex,
  readCodexAccount,
  startCodexLogin,
  waitForCodexLogin,
} from '../src/codex-account'

/** scripted RPC: answers by method, records every call, lets the test push notifications */
function fakeRpc(answers: Record<string, unknown | ((params: unknown) => unknown)>) {
  const calls: Array<{ method: string; params: unknown }> = []
  const listeners = new Set<(message: RpcMessage) => void>()
  const rpc: CodexRpc & {
    calls: typeof calls
    push(message: RpcMessage): void
    listenerCount(): number
  } = {
    calls,
    userAgent: 'genoffice/0.159.3 (Windows 10.0.19045; x86_64)',
    async request(method, params) {
      calls.push({ method, params })
      if (!(method in answers)) throw new Error(`unexpected ${method}`)
      const answer = answers[method]
      return typeof answer === 'function' ? (answer as (p: unknown) => unknown)(params) : answer
    },
    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    push(message) {
      for (const listener of [...listeners]) listener(message)
    },
    listenerCount: () => listeners.size,
  }
  return rpc
}

afterEach(() => {
  vi.useRealTimers()
})

describe('readCodexAccount', () => {
  it('reports a ChatGPT sign-in with email and plan, never asking Codex to refresh tokens', async () => {
    const rpc = fakeRpc({
      'account/read': {
        account: { type: 'chatgpt', email: 'a@b.com', planType: 'prolite' },
        requiresOpenaiAuth: true,
      },
    })
    await expect(readCodexAccount(rpc)).resolves.toEqual({
      state: 'connected',
      accountType: 'chatgpt',
      email: 'a@b.com',
      planType: 'prolite',
    })
    expect(rpc.calls).toEqual([{ method: 'account/read', params: { refreshToken: false } }])
  })

  it('reports signed-out when Codex has no account', async () => {
    const rpc = fakeRpc({ 'account/read': { account: null, requiresOpenaiAuth: true } })
    await expect(readCodexAccount(rpc)).resolves.toEqual({ state: 'signed-out' })
  })

  it('keeps an API-key sign-in connected even without an email', async () => {
    const rpc = fakeRpc({ 'account/read': { account: { type: 'apiKey' } } })
    await expect(readCodexAccount(rpc)).resolves.toEqual({
      state: 'connected',
      accountType: 'apiKey',
    })
  })
})

describe('sign-in', () => {
  it('starts the browser flow and the device-code flow with their URLs', async () => {
    const rpc = fakeRpc({
      'account/login/start': (params: unknown) =>
        (params as { type: string }).type === 'chatgpt'
          ? { type: 'chatgpt', loginId: 'L1', authUrl: 'https://auth.openai.com/oauth/x' }
          : {
              type: 'chatgptDeviceCode',
              loginId: 'L2',
              verificationUrl: 'https://auth.openai.com/codex/device',
              userCode: 'ABCD-1234',
            },
    })
    await expect(startCodexLogin(rpc, 'chatgpt')).resolves.toEqual({
      method: 'chatgpt',
      loginId: 'L1',
      authUrl: 'https://auth.openai.com/oauth/x',
    })
    await expect(startCodexLogin(rpc, 'chatgptDeviceCode')).resolves.toEqual({
      method: 'chatgptDeviceCode',
      loginId: 'L2',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    })
  })

  it('rejects a start response without the fields the UI needs', async () => {
    const rpc = fakeRpc({ 'account/login/start': { loginId: 'L1' } })
    await expect(startCodexLogin(rpc, 'chatgpt')).rejects.toThrow(/authUrl/)
  })

  it('resolves on the matching login/completed notification and ignores other logins', async () => {
    const rpc = fakeRpc({})
    const outcome = waitForCodexLogin(rpc, 'L1', 60_000)
    rpc.push({ method: 'account/login/completed', params: { loginId: 'OTHER', success: false } })
    rpc.push({ method: 'account/updated', params: {} })
    rpc.push({ method: 'account/login/completed', params: { loginId: 'L1', success: true } })
    await expect(outcome).resolves.toEqual({ success: true })
    expect(rpc.listenerCount()).toBe(0)
  })

  it('reports a failed sign-in with its error', async () => {
    const rpc = fakeRpc({})
    const outcome = waitForCodexLogin(rpc, 'L1', 60_000)
    rpc.push({
      method: 'account/login/completed',
      params: { loginId: 'L1', success: false, error: 'denied' },
    })
    await expect(outcome).resolves.toEqual({ success: false, error: 'denied' })
  })

  it('gives up after the timeout (browser closed, user walked away)', async () => {
    vi.useFakeTimers()
    const rpc = fakeRpc({})
    const outcome = waitForCodexLogin(rpc, 'L1', 600_000)
    await vi.advanceTimersByTimeAsync(600_000)
    await expect(outcome).resolves.toEqual({ success: false, error: 'Sign-in timed out' })
    expect(rpc.listenerCount()).toBe(0)
  })

  it('cancels, signs in with an API key, and signs out through the matching RPCs', async () => {
    const rpc = fakeRpc({
      'account/login/cancel': { status: 'canceled' },
      'account/login/start': {},
      'account/logout': {},
    })
    await cancelCodexLogin(rpc, 'L1')
    await loginCodexWithApiKey(rpc, '  sk-test  ')
    await logoutCodex(rpc)
    expect(rpc.calls).toEqual([
      { method: 'account/login/cancel', params: { loginId: 'L1' } },
      { method: 'account/login/start', params: { type: 'apiKey', apiKey: 'sk-test' } },
      { method: 'account/logout', params: {} },
    ])
    await expect(loginCodexWithApiKey(rpc, '   ')).rejects.toThrow(/API key/)
  })
})

describe('codexVersionFromUserAgent', () => {
  it('reads the Codex version from the app-server user agent', () => {
    expect(codexVersionFromUserAgent('genoffice/0.159.3 (Windows 10.0.19045; x86_64) xterm')).toBe(
      '0.159.3',
    )
    expect(codexVersionFromUserAgent('')).toBeNull()
  })
})

describe('CodexAccountMonitor', () => {
  it('caches a status for the TTL, dedupes concurrent refreshes and refreshes after invalidate', async () => {
    let now = 0
    const read = vi.fn(async () => ({ state: 'connected' as const, accountType: 'chatgpt' }))
    const monitor = new CodexAccountMonitor(read, { ttlMs: 1000, now: () => now })
    expect(monitor.snapshot()).toBeNull()
    expect(monitor.isConnected()).toBe(false)
    await Promise.all([monitor.current(), monitor.current()])
    expect(read).toHaveBeenCalledTimes(1)
    expect(monitor.isConnected()).toBe(true)
    now = 500
    await monitor.current()
    expect(read).toHaveBeenCalledTimes(1)
    now = 1500
    await monitor.current()
    expect(read).toHaveBeenCalledTimes(2)
    monitor.invalidate()
    await monitor.current()
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('turns a failing read into an error status instead of throwing', async () => {
    const monitor = new CodexAccountMonitor(async () => {
      throw new Error('Codex executable not found: C:\\x\\codex.exe')
    })
    await expect(monitor.refresh()).resolves.toEqual({
      state: 'error',
      message: 'Codex executable not found: C:\\x\\codex.exe',
    })
    expect(monitor.isConnected()).toBe(false)
  })
})
