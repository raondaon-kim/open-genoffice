import type { CodexRpc } from './codex-app-server'

/**
 * Codex account RPCs (app-server `account/*`). Codex owns the credentials in
 * ~/.codex; this module only reads the account summary (type, email, plan) and
 * drives sign-in/sign-out. Nothing here reads auth.json or returns a token.
 */

export type CodexAccountStatus =
  | { state: 'connected'; accountType: string; email?: string; planType?: string }
  | { state: 'signed-out' }
  | { state: 'error'; message: string }

export type CodexLoginMethod = 'chatgpt' | 'chatgptDeviceCode'

export type CodexLoginStart =
  | { method: 'chatgpt'; loginId: string; authUrl: string }
  | { method: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }

export interface CodexLoginOutcome {
  success: boolean
  error?: string
}

/** A browser sign-in left open is abandoned after ten minutes. */
export const CODEX_LOGIN_TIMEOUT_MS = 600_000

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export async function readCodexAccount(rpc: CodexRpc): Promise<CodexAccountStatus> {
  const result = record(await rpc.request('account/read', { refreshToken: false }))
  const account = record(result?.account)
  if (!account) return { state: 'signed-out' }
  const email = text(account.email)
  const planType = text(account.planType)
  return {
    state: 'connected',
    accountType: text(account.type) ?? 'unknown',
    ...(email ? { email } : {}),
    ...(planType ? { planType } : {}),
  }
}

export async function startCodexLogin(
  rpc: CodexRpc,
  method: CodexLoginMethod,
): Promise<CodexLoginStart> {
  const result = record(await rpc.request('account/login/start', { type: method }))
  const loginId = text(result?.loginId)
  if (!loginId) throw new Error('Codex did not start a sign-in (no loginId)')
  if (method === 'chatgpt') {
    const authUrl = text(result?.authUrl)
    if (!authUrl) throw new Error('Codex did not return a sign-in authUrl')
    return { method, loginId, authUrl }
  }
  const verificationUrl = text(result?.verificationUrl)
  const userCode = text(result?.userCode)
  if (!verificationUrl || !userCode) throw new Error('Codex did not return a device code')
  return { method, loginId, verificationUrl, userCode }
}

export function waitForCodexLogin(
  rpc: CodexRpc,
  loginId: string,
  timeoutMs = CODEX_LOGIN_TIMEOUT_MS,
): Promise<CodexLoginOutcome> {
  return new Promise((resolve) => {
    let unsubscribe = (): void => undefined
    const finish = (outcome: CodexLoginOutcome) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(outcome)
    }
    const timer = setTimeout(
      () => finish({ success: false, error: 'Sign-in timed out' }),
      timeoutMs,
    )
    unsubscribe = rpc.onNotification((message) => {
      if (message.method !== 'account/login/completed') return
      const params = record(message.params)
      const id = text(params?.loginId)
      if (id && id !== loginId) return
      finish(
        params?.success === false
          ? { success: false, error: text(params.error) ?? 'Sign-in failed' }
          : { success: true },
      )
    })
  })
}

export async function cancelCodexLogin(rpc: CodexRpc, loginId: string): Promise<void> {
  await rpc.request('account/login/cancel', { loginId })
}

/** Signs Codex in with an OpenAI API key instead of a ChatGPT account (replaces the current sign-in). */
export async function loginCodexWithApiKey(rpc: CodexRpc, apiKey: string): Promise<void> {
  const key = apiKey.trim()
  if (!key) throw new Error('An OpenAI API key is required')
  await rpc.request('account/login/start', { type: 'apiKey', apiKey: key })
}

/** Signs Codex out on this computer — the Codex app and VS Code extension share this sign-in. */
export async function logoutCodex(rpc: CodexRpc): Promise<void> {
  await rpc.request('account/logout', {})
}

export function codexVersionFromUserAgent(userAgent: string): string | null {
  return /\/(\d+\.\d+\.\d+)/.exec(userAgent)?.[1] ?? null
}

/**
 * Cached account status for synchronous "is Codex configured?" checks in the
 * settings service; async callers use current(), which refreshes after the TTL.
 */
export class CodexAccountMonitor {
  private last: { status: CodexAccountStatus; at: number } | null = null
  private inflight: Promise<CodexAccountStatus> | null = null
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(
    private readonly read: () => Promise<CodexAccountStatus>,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? 300_000
    this.now = options.now ?? Date.now
  }

  snapshot(): CodexAccountStatus | null {
    return this.last?.status ?? null
  }

  isConnected(): boolean {
    return this.last?.status.state === 'connected'
  }

  current(): Promise<CodexAccountStatus> {
    if (this.last && this.now() - this.last.at < this.ttlMs)
      return Promise.resolve(this.last.status)
    return this.refresh()
  }

  refresh(): Promise<CodexAccountStatus> {
    if (this.inflight) return this.inflight
    this.inflight = this.read()
      .catch((err: unknown): CodexAccountStatus => ({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      }))
      .then((status) => {
        this.last = { status, at: this.now() }
        return status
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  invalidate(): void {
    this.last = null
  }
}
