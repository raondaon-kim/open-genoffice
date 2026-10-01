import type { CodexStatusView } from '../../../docs/src/main/codex-provider'
import type { PublicAiSettings } from '../../../docs/src/shared/ipc'

export type { CodexStatusView }

export type CodexLoginMethod = 'chatgpt' | 'chatgptDeviceCode'

export const CODEX_CHANNELS = {
  status: 'codex:status',
  login: 'codex:login',
  loginCancel: 'codex:login-cancel',
  loginApiKey: 'codex:login-api-key',
  logout: 'codex:logout',
  /** main → renderer: a sign-in finished (or timed out) */
  statusChanged: 'codex:status-changed',
} as const

/** what the settings card needs to show while a sign-in is open; the browser URL never leaves main */
export type CodexLoginStartView =
  | { method: 'chatgpt'; loginId: string }
  | { method: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }

export interface CodexRendererApi {
  codexStatus(): Promise<CodexStatusView>
  codexLogin(method: CodexLoginMethod): Promise<CodexLoginStartView>
  codexLoginCancel(loginId: string): Promise<void>
  codexLoginWithApiKey(apiKey: string): Promise<CodexStatusView>
  codexLogout(): Promise<CodexStatusView>
  onCodexStatusChanged(handler: (status: CodexStatusView) => void): () => void
  setCodexCliPath(path: string): Promise<PublicAiSettings>
}
