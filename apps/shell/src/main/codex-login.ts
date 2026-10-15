import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CodexAccountState } from '@genoffice/ai-provider/codex-app-server'

/** <resources>/codex/bin/codex.exe, else the dev build (apps/shell/build/codex); null when absent */
export function bundledCodexExe(resourcesPath: string | undefined, devDir: string): string | null {
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'codex', 'bin', 'codex.exe')] : []),
    join(devDir, 'codex', 'bin', 'codex.exe'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

export interface LoginChild {
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): unknown }
  on(event: 'exit', cb: (code: number | null) => void): unknown
  kill(): boolean
}

export interface CodexLoginStatus {
  state: 'idle' | 'waiting' | 'done' | 'failed'
  url?: string
  reason?: string
}

export interface CodexLoginOptions {
  exePath: () => Promise<string>
  spawn: (exe: string, args: string[]) => LoginChild
  readAccount: () => Promise<CodexAccountState>
  pollMs?: number
  timeoutMs?: number
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/

/** runs `codex login` (browser OAuth) and watches the account until it is signed in */
export class CodexLogin {
  private child: LoginChild | null = null
  private current: CodexLoginStatus = { state: 'idle' }
  private timer: ReturnType<typeof setInterval> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly o: CodexLoginOptions) {}

  status(): CodexLoginStatus {
    return { ...this.current }
  }

  /** start a sign-in; a second call while one runs does nothing; never throws */
  async start(): Promise<void> {
    if (this.current.state === 'waiting') return
    this.current = { state: 'waiting' }
    try {
      const exe = await this.o.exePath()
      const child = this.o.spawn(exe, ['login'])
      this.child = child
      child.stdout.on('data', (chunk) => {
        const m = URL_PATTERN.exec(String(chunk))
        if (m && this.current.state === 'waiting') this.current = { ...this.current, url: m[0] }
      })
      child.on('exit', (code) => {
        if (this.child !== child) return
        this.child = null
        // an exit while still waiting is a failure unless the account is already there
        void this.o
          .readAccount()
          .catch(() => null)
          .then((a) => {
            if (this.current.state !== 'waiting') return
            if (a?.state === 'connected') this.finish({ state: 'done' })
            else this.finish({ state: 'failed', reason: `codex login exited (${code ?? 'none'})` })
          })
      })
      this.timer = setInterval(() => void this.poll(), this.o.pollMs ?? 1500)
      this.deadline = setTimeout(
        () => this.finish({ state: 'failed', reason: 'sign-in timed out' }),
        this.o.timeoutMs ?? 5 * 60_000,
      )
    } catch (err) {
      this.finish({ state: 'failed', reason: err instanceof Error ? err.message : String(err) })
    }
  }

  private async poll(): Promise<void> {
    if (this.current.state !== 'waiting') return
    const a = await this.o.readAccount().catch(() => null)
    if (a?.state === 'connected' && this.current.state === 'waiting') this.finish({ state: 'done' })
  }

  private finish(next: CodexLoginStatus): void {
    if (this.timer) clearInterval(this.timer)
    if (this.deadline) clearTimeout(this.deadline)
    this.timer = null
    this.deadline = null
    const child = this.child
    this.child = null
    this.current = next
    child?.kill()
  }

  /** stop a running sign-in (also used when the app quits) */
  cancel(): void {
    if (this.current.state !== 'waiting') return
    this.finish({ state: 'idle' })
  }
}
