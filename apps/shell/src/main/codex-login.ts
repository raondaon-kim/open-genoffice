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

interface DataStream {
  on(event: 'data', cb: (chunk: Buffer) => void): unknown
}

export interface LoginChild {
  stdout: DataStream
  stderr?: DataStream | null
  on(event: 'exit', cb: (code: number | null) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
  kill(): boolean
}

export interface CodexLoginStatus {
  state: 'idle' | 'waiting' | 'done' | 'failed'
  url?: string
  reason?: string
}

export interface CodexLoginOptions {
  /** the executable for this sign-in: the user's path when given, else the usual lookup */
  exePath: (cliPath?: string) => Promise<string>
  spawn: (exe: string, args: string[]) => LoginChild
  readAccount: (cliPath?: string) => Promise<CodexAccountState>
  pollMs?: number
  timeoutMs?: number
  /** after a clean exit the account shows up about a second later; wait this long for it */
  exitGraceMs?: number
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/

/** runs `codex login` (browser OAuth) and watches the account until it is signed in */
export class CodexLogin {
  private child: LoginChild | null = null
  private current: CodexLoginStatus = { state: 'idle' }
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private poller: ReturnType<typeof setInterval> | null = null
  private cliPath: string | undefined

  constructor(private readonly o: CodexLoginOptions) {}

  status(): CodexLoginStatus {
    return { ...this.current }
  }

  /** start a sign-in with the given executable; a second call while one runs does nothing; never throws */
  async start(cliPath?: string): Promise<void> {
    if (this.current.state === 'waiting') return
    this.current = { state: 'waiting' }
    this.cliPath = cliPath
    try {
      const exe = await this.o.exePath(cliPath)
      const child = this.o.spawn(exe, ['login'])
      this.child = child
      const scan = (chunk: Buffer) => {
        const m = URL_PATTERN.exec(String(chunk))
        if (m && this.current.state === 'waiting' && !this.current.url) {
          this.current = { ...this.current, url: m[0] }
        }
      }
      child.stdout.on('data', scan)
      child.stderr?.on('data', scan)
      // spawn reports a failure to start (permissions, a damaged file) as an event, not a throw
      child.on('error', (err) => {
        if (this.child !== child) return
        this.finish({ state: 'failed', reason: err.message })
      })
      child.on('exit', (code) => {
        if (this.child !== child) return
        this.child = null
        if (code === 0) {
          // the app-server reads the new account file only a moment later; keep polling first
          this.timers.push(
            setTimeout(() => void this.settleAfterExit(code), this.o.exitGraceMs ?? 8000),
          )
          return
        }
        void this.settleAfterExit(code)
      })
      this.poller = setInterval(() => void this.poll(), this.o.pollMs ?? 1500)
      this.timers.push(
        setTimeout(
          () => this.finish({ state: 'failed', reason: 'sign-in timed out' }),
          this.o.timeoutMs ?? 5 * 60_000,
        ),
      )
    } catch (err) {
      this.finish({ state: 'failed', reason: err instanceof Error ? err.message : String(err) })
    }
  }

  private async read(): Promise<CodexAccountState | null> {
    return this.o.readAccount(this.cliPath).catch(() => null)
  }

  private async poll(): Promise<void> {
    if (this.current.state !== 'waiting') return
    const a = await this.read()
    if (a?.state === 'connected' && this.current.state === 'waiting') this.finish({ state: 'done' })
  }

  /** the login child is gone: signed in, or a failure with its exit code */
  private async settleAfterExit(code: number | null): Promise<void> {
    if (this.current.state !== 'waiting') return
    const a = await this.read()
    if (this.current.state !== 'waiting') return
    if (a?.state === 'connected') this.finish({ state: 'done' })
    else this.finish({ state: 'failed', reason: `codex login exited (${code ?? 'none'})` })
  }

  private finish(next: CodexLoginStatus): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    if (this.poller) clearInterval(this.poller)
    this.poller = null
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
