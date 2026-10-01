import { describe, expect, it, vi } from 'vitest'
import { CODEX_CHANNELS } from '../src/shared/codex-api'
import { registerCodexIpc, type CodexIpcDeps } from '../src/main/codex-ipc'

function setup(overrides: Partial<CodexIpcDeps> = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const provider = {
    status: vi.fn(async () => ({
      state: 'connected' as const,
      email: 'a@b.com',
      accountType: 'chatgpt',
    })),
    startLogin: vi.fn(async (method: string) =>
      method === 'chatgpt'
        ? { method: 'chatgpt' as const, loginId: 'L1', authUrl: 'https://auth.openai.com/oauth/x' }
        : {
            method: 'chatgptDeviceCode' as const,
            loginId: 'L2',
            verificationUrl: 'https://auth.openai.com/codex/device',
            userCode: 'AB-12',
          },
    ),
    awaitLogin: vi.fn(async () => ({ state: 'connected' as const, email: 'a@b.com' })),
    cancelLogin: vi.fn(async () => undefined),
    loginWithApiKey: vi.fn(async () => ({ state: 'connected' as const, accountType: 'apiKey' })),
    logout: vi.fn(async () => ({ state: 'signed-out' as const })),
  }
  const deps: CodexIpcDeps = {
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener as never) },
    provider: provider as never,
    openExternal: vi.fn(async () => undefined),
    confirm: vi.fn(async () => true),
    ...overrides,
  }
  registerCodexIpc(deps)
  const sender = { isDestroyed: () => false, send: vi.fn() }
  const invoke = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)!({ sender }, ...args)
  return { deps, provider, invoke, sender }
}

describe('Codex IPC', () => {
  it('opens the sign-in page in the browser, keeps the URL in main, and pushes the result', async () => {
    const { deps, provider, invoke, sender } = setup()
    const view = await invoke(CODEX_CHANNELS.login, 'chatgpt')
    expect(view).toEqual({ method: 'chatgpt', loginId: 'L1' })
    expect(deps.openExternal).toHaveBeenCalledWith('https://auth.openai.com/oauth/x')
    await vi.waitFor(() =>
      expect(sender.send).toHaveBeenCalledWith(CODEX_CHANNELS.statusChanged, {
        state: 'connected',
        email: 'a@b.com',
      }),
    )
    expect(provider.awaitLogin).toHaveBeenCalledWith('L1')
  })

  it('returns the device code for the card and opens the verification page', async () => {
    const { deps, invoke } = setup()
    await expect(invoke(CODEX_CHANNELS.login, 'chatgptDeviceCode')).resolves.toEqual({
      method: 'chatgptDeviceCode',
      loginId: 'L2',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'AB-12',
    })
    expect(deps.openExternal).toHaveBeenCalledWith('https://auth.openai.com/codex/device')
  })

  it('refuses unknown methods and never opens a non-https URL', async () => {
    const { invoke, provider, deps } = setup()
    await expect(invoke(CODEX_CHANNELS.login, 'apiKey')).rejects.toThrow(/Unsupported/)
    provider.startLogin.mockResolvedValueOnce({
      method: 'chatgpt',
      loginId: 'L3',
      authUrl: 'file:///C:/evil',
    } as never)
    await invoke(CODEX_CHANNELS.login, 'chatgpt')
    expect(deps.openExternal).not.toHaveBeenCalledWith('file:///C:/evil')
  })

  it('signs out only after the user confirms', async () => {
    const confirm = vi.fn(async () => false)
    const { invoke, provider } = setup({ confirm })
    await expect(invoke(CODEX_CHANNELS.logout)).resolves.toMatchObject({ state: 'connected' })
    expect(provider.logout).not.toHaveBeenCalled()
    expect(confirm.mock.calls[0]![0]).toMatchObject({
      detail: expect.stringMatching(/a@b\.com.*VS Code/s),
    })
    confirm.mockResolvedValueOnce(true)
    await expect(invoke(CODEX_CHANNELS.logout)).resolves.toEqual({ state: 'signed-out' })
  })

  it('asks before replacing the sign-in with an API key and validates the key', async () => {
    const confirm = vi.fn(async () => true)
    const { invoke, provider } = setup({ confirm })
    await expect(invoke(CODEX_CHANNELS.loginApiKey, 42)).rejects.toThrow(/API key/)
    await invoke(CODEX_CHANNELS.loginApiKey, 'sk-x')
    expect(provider.loginWithApiKey).toHaveBeenCalledWith('sk-x')
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending sign-in by id', async () => {
    const { invoke, provider } = setup()
    await invoke(CODEX_CHANNELS.loginCancel, 'L1')
    expect(provider.cancelLogin).toHaveBeenCalledWith('L1')
    await expect(invoke(CODEX_CHANNELS.loginCancel, '')).rejects.toThrow(/loginId/)
  })
})
