import {
  CodexAccountMonitor,
  cancelCodexLogin,
  codexVersionFromUserAgent,
  loginCodexWithApiKey,
  logoutCodex,
  readCodexAccount,
  startCodexLogin,
  waitForCodexLogin,
  type CodexAccountStatus,
  type CodexLoginMethod,
  type CodexLoginStart,
} from '@genoffice/ai-provider/codex-account'
import {
  listCodexModels,
  resolveCodexBinary,
  setBundledCodexPath,
  withCodexRpc,
  type CodexBinarySource,
  type CodexRpc,
  type ResolvedCodexBinary,
} from '@genoffice/ai-provider/codex-app-server'
import type { CodexModelCatalog } from '@genoffice/ai-provider'

/**
 * Process-wide Codex state shared by every module's AiSettingsService (docs,
 * sheets, slides, pdf all run in the shell's main process): the custom binary
 * path, the cached account status, the last model list, and the sign-in flows
 * the settings card drives. Codex keeps the credentials in ~/.codex.
 */

export type CodexRpcRunner = <T>(
  cliPath: string | undefined,
  action: (rpc: CodexRpc) => Promise<T>,
) => Promise<T>

export interface CodexProviderDeps {
  withRpc: CodexRpcRunner
  listModels(cliPath?: string): Promise<CodexModelCatalog>
  resolveBinary(cliPath?: string): Promise<ResolvedCodexBinary>
}

export interface CodexStatusView {
  state: 'connected' | 'signed-out' | 'error'
  accountType?: string
  email?: string
  planType?: string
  message?: string
  binary?: { path: string; source: CodexBinarySource; version: string | null }
}

export class CodexProvider {
  readonly monitor: CodexAccountMonitor
  private customPath: string | undefined
  private defaultModel: string | null = null
  private version: string | null = null

  constructor(private readonly deps: CodexProviderDeps) {
    this.monitor = new CodexAccountMonitor(() =>
      this.deps.withRpc(this.customPath, async (rpc) => {
        this.version = codexVersionFromUserAgent(rpc.userAgent)
        return readCodexAccount(rpc)
      }),
    )
  }

  cliPath(): string | undefined {
    return this.customPath
  }

  setCliPath(path: string | undefined): void {
    const next = path?.trim() || undefined
    if (next === this.customPath) return
    this.customPath = next
    this.defaultModel = null
    this.monitor.invalidate()
  }

  isConnected(): boolean {
    return this.monitor.isConnected()
  }

  ensureStatus(): Promise<CodexAccountStatus> {
    return this.monitor.current()
  }

  async listModels(): Promise<CodexModelCatalog> {
    const catalog = await this.deps.listModels(this.customPath)
    this.defaultModel = catalog.defaultModel || null
    return catalog
  }

  lastDefaultModel(): string | null {
    return this.defaultModel
  }

  async status(): Promise<CodexStatusView> {
    const account = await this.monitor.refresh()
    let binary: CodexStatusView['binary']
    try {
      const resolved = await this.deps.resolveBinary(this.customPath)
      binary = { ...resolved, version: this.version }
    } catch {
      binary = undefined
    }
    if (account.state === 'error')
      return { state: 'error', message: account.message, ...(binary ? { binary } : {}) }
    if (account.state === 'signed-out')
      return { state: 'signed-out', ...(binary ? { binary } : {}) }
    return {
      state: 'connected',
      accountType: account.accountType,
      ...(account.email ? { email: account.email } : {}),
      ...(account.planType ? { planType: account.planType } : {}),
      ...(binary ? { binary } : {}),
    }
  }

  startLogin(method: CodexLoginMethod): Promise<CodexLoginStart> {
    return this.deps.withRpc(this.customPath, (rpc) => startCodexLogin(rpc, method))
  }

  /** waits for the browser/device sign-in to finish; cancels it server-side on timeout */
  async awaitLogin(loginId: string, timeoutMs?: number): Promise<CodexStatusView> {
    const outcome = await this.deps.withRpc(this.customPath, (rpc) =>
      waitForCodexLogin(rpc, loginId, timeoutMs),
    )
    if (!outcome.success) await this.cancelLogin(loginId).catch(() => undefined)
    this.monitor.invalidate()
    return this.status()
  }

  async cancelLogin(loginId: string): Promise<void> {
    await this.deps.withRpc(this.customPath, (rpc) => cancelCodexLogin(rpc, loginId))
  }

  async loginWithApiKey(apiKey: string): Promise<CodexStatusView> {
    await this.deps.withRpc(this.customPath, (rpc) => loginCodexWithApiKey(rpc, apiKey))
    this.monitor.invalidate()
    return this.status()
  }

  async logout(): Promise<CodexStatusView> {
    await this.deps.withRpc(this.customPath, (rpc) => logoutCodex(rpc))
    this.monitor.invalidate()
    return this.status()
  }
}

let shared: CodexProvider | null = null

export function getCodexProvider(): CodexProvider {
  if (!shared) {
    shared = new CodexProvider({
      withRpc: (cliPath, action) => withCodexRpc(cliPath, action),
      listModels: (cliPath) => listCodexModels(cliPath),
      resolveBinary: (cliPath) => resolveCodexBinary(cliPath),
    })
  }
  return shared
}

/** shell main calls this once with resources/native/codex-app-server[.exe] (dev: apps/shell/native/codex/…) */
export function configureCodexBundledBinary(path: string | undefined): void {
  setBundledCodexPath(path)
}
