import { safeExternalUrl } from '@genoffice/electron-utils'
import type { CodexProvider, CodexStatusView } from '../../../docs/src/main/codex-provider'
import { CODEX_CHANNELS, type CodexLoginStartView } from '../shared/codex-api'

interface SenderLike {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export interface CodexIpcDeps {
  ipcMain: {
    handle(
      channel: string,
      listener: (event: { sender: SenderLike }, ...args: unknown[]) => unknown,
    ): void
  }
  provider: Pick<
    CodexProvider,
    'status' | 'startLogin' | 'awaitLogin' | 'cancelLogin' | 'loginWithApiKey' | 'logout'
  >
  openExternal(url: string): Promise<void>
  /** native confirmation; resolves true for the affirmative button */
  confirm(options: { message: string; detail: string; confirmLabel: string }): Promise<boolean>
}

/**
 * Codex account IPC for the Home settings card. The sign-in URL is opened from
 * main and never sent to the renderer; sign-out and API-key sign-in replace the
 * sign-in that the Codex app and the VS Code extension share, so both ask first.
 */
export function registerCodexIpc(deps: CodexIpcDeps): void {
  const { ipcMain, provider } = deps

  ipcMain.handle(CODEX_CHANNELS.status, () => provider.status())

  ipcMain.handle(CODEX_CHANNELS.login, async (event, method): Promise<CodexLoginStartView> => {
    if (method !== 'chatgpt' && method !== 'chatgptDeviceCode') {
      throw new Error('Unsupported Codex sign-in method')
    }
    const start = await provider.startLogin(method)
    const url = start.method === 'chatgpt' ? start.authUrl : start.verificationUrl
    const safe = safeExternalUrl(url, { allowedProtocols: ['https:'] })
    if (safe) await deps.openExternal(safe)
    void provider.awaitLogin(start.loginId).then(
      (status) => {
        if (!event.sender.isDestroyed()) event.sender.send(CODEX_CHANNELS.statusChanged, status)
      },
      () => undefined,
    )
    return start.method === 'chatgpt'
      ? { method: 'chatgpt', loginId: start.loginId }
      : {
          method: 'chatgptDeviceCode',
          loginId: start.loginId,
          verificationUrl: start.verificationUrl,
          userCode: start.userCode,
        }
  })

  ipcMain.handle(CODEX_CHANNELS.loginCancel, async (_event, loginId) => {
    if (typeof loginId !== 'string' || !loginId) throw new Error('loginId is required')
    await provider.cancelLogin(loginId)
  })

  ipcMain.handle(CODEX_CHANNELS.loginApiKey, async (_event, apiKey): Promise<CodexStatusView> => {
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 16_384) {
      throw new Error('A valid OpenAI API key is required')
    }
    const confirmed = await deps.confirm({
      message: 'Sign Codex in with an API key?',
      detail:
        'This replaces the current Codex sign-in on this computer, including the one the Codex app and the VS Code extension use. Usage is billed to the API key.',
      confirmLabel: 'Use API key',
    })
    if (!confirmed) return provider.status()
    return provider.loginWithApiKey(apiKey)
  })

  ipcMain.handle(CODEX_CHANNELS.logout, async (): Promise<CodexStatusView> => {
    const current = await provider.status()
    const confirmed = await deps.confirm({
      message: 'Sign out of Codex?',
      detail: `${current.email ?? 'This account'} will be signed out on this computer — the Codex app and the VS Code extension use the same sign-in.`,
      confirmLabel: 'Sign out',
    })
    if (!confirmed) return current
    return provider.logout()
  })
}
