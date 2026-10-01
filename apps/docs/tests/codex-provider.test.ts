import { describe, expect, it, vi } from 'vitest'
import type { CodexRpc, RpcMessage } from '@genoffice/ai-provider/codex-app-server'
import { CodexProvider, type CodexProviderDeps } from '../src/main/codex-provider'

function deps(account: unknown, extra: Partial<CodexProviderDeps> = {}) {
  const listeners = new Set<(m: RpcMessage) => void>()
  const calls: string[] = []
  let current = account
  const rpc: CodexRpc = {
    userAgent: 'genoffice/0.159.3 (Windows)',
    async request(method, params) {
      calls.push(method)
      if (method === 'account/read') return { account: current }
      if (method === 'account/login/start') {
        if ((params as { type: string }).type === 'apiKey') {
          current = { type: 'apiKey' }
          return {}
        }
        return { loginId: 'L1', authUrl: 'https://auth.openai.com/x' }
      }
      if (method === 'account/logout') {
        current = null
        return {}
      }
      if (method === 'account/login/cancel') return { status: 'canceled' }
      throw new Error(`unexpected ${method}`)
    },
    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const value: CodexProviderDeps = {
    withRpc: async (_cliPath, action) => action(rpc),
    listModels: vi.fn(async () => ({
      models: ['gpt-6.1-sol', 'gpt-5.6-luna'],
      defaultModel: 'gpt-6.1-sol',
    })),
    resolveBinary: vi.fn(async () => ({
      path: 'C:\\app\\resources\\native\\codex-app-server.exe',
      source: 'bundled' as const,
    })),
    ...extra,
  }
  return {
    value,
    calls,
    complete: (success = true) => {
      current = success ? { type: 'chatgpt', email: 'a@b.com', planType: 'plus' } : current
      for (const l of [...listeners])
        l({ method: 'account/login/completed', params: { loginId: 'L1', success } })
    },
  }
}

describe('CodexProvider', () => {
  it('reports status with account summary and the binary in use', async () => {
    const d = deps({ type: 'chatgpt', email: 'a@b.com', planType: 'prolite' })
    const provider = new CodexProvider(d.value)
    await expect(provider.status()).resolves.toEqual({
      state: 'connected',
      accountType: 'chatgpt',
      email: 'a@b.com',
      planType: 'prolite',
      binary: {
        path: 'C:\\app\\resources\\native\\codex-app-server.exe',
        source: 'bundled',
        version: '0.159.3',
      },
    })
    expect(provider.isConnected()).toBe(true)
  })

  it('shows a missing custom binary as an error on the card', async () => {
    const d = deps(null, {
      resolveBinary: vi.fn(async () => {
        throw new Error('Codex executable not found: D:\\nope\\codex.exe')
      }),
      withRpc: async () => {
        throw new Error('Codex executable not found: D:\\nope\\codex.exe')
      },
    })
    const provider = new CodexProvider(d.value)
    provider.setCliPath('D:\\nope\\codex.exe')
    await expect(provider.status()).resolves.toMatchObject({
      state: 'error',
      message: 'Codex executable not found: D:\\nope\\codex.exe',
    })
  })

  it('completes a browser sign-in and refreshes the cached status', async () => {
    const d = deps(null)
    const provider = new CodexProvider(d.value)
    expect((await provider.status()).state).toBe('signed-out')
    const start = await provider.startLogin('chatgpt')
    expect(start).toEqual({
      method: 'chatgpt',
      loginId: 'L1',
      authUrl: 'https://auth.openai.com/x',
    })
    const done = provider.awaitLogin('L1', 60_000)
    d.complete(true)
    await expect(done).resolves.toMatchObject({ state: 'connected', email: 'a@b.com' })
    expect(provider.isConnected()).toBe(true)
  })

  it('cancels the server-side login when the wait times out', async () => {
    vi.useFakeTimers()
    try {
      const d = deps(null)
      const provider = new CodexProvider(d.value)
      await provider.startLogin('chatgpt')
      const done = provider.awaitLogin('L1', 1_000)
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(done).resolves.toMatchObject({ state: 'signed-out' })
      expect(d.calls).toContain('account/login/cancel')
    } finally {
      vi.useRealTimers()
    }
  })

  it('signs in with an API key and signs out, updating the status each time', async () => {
    const d = deps({ type: 'chatgpt', email: 'a@b.com' })
    const provider = new CodexProvider(d.value)
    await expect(provider.loginWithApiKey('sk-x')).resolves.toMatchObject({
      state: 'connected',
      accountType: 'apiKey',
    })
    await expect(provider.logout()).resolves.toMatchObject({ state: 'signed-out' })
    expect(provider.isConnected()).toBe(false)
  })

  it('remembers the account default model from the last model list', async () => {
    const d = deps({ type: 'chatgpt' })
    const provider = new CodexProvider(d.value)
    expect(provider.lastDefaultModel()).toBeNull()
    await provider.listModels()
    expect(provider.lastDefaultModel()).toBe('gpt-6.1-sol')
  })
})

describe('CodexProvider custom path in the status', () => {
  it('reports the saved custom path so the settings card can show it', async () => {
    const d = deps({ type: 'chatgpt', email: 'a@b.com' })
    const provider = new CodexProvider(d.value)
    provider.setCliPath('D:\\tools\\codex.exe')
    await expect(provider.status()).resolves.toMatchObject({ customPath: 'D:\\tools\\codex.exe' })
    provider.setCliPath(undefined)
    expect((await provider.status()).customPath).toBeUndefined()
  })
})
