import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { bundledCodexExe, CodexLogin } from '../src/main/codex-login'
import type { CodexLoginOptions, LoginChild } from '../src/main/codex-login'

class FakeLogin extends EventEmitter implements LoginChild {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill() {
    this.killed = true
    this.emit('exit', null)
    return true
  }
}

const make = (over: Partial<CodexLoginOptions> = {}) => {
  const children: FakeLogin[] = []
  let signedIn = false
  const login = new CodexLogin({
    exePath: async () => 'C:/res/codex/bin/codex.exe',
    spawn: vi.fn(() => {
      const c = new FakeLogin()
      children.push(c)
      return c
    }),
    readAccount: async () =>
      signedIn ? { state: 'connected', account: 'a@b.test' } : { state: 'needs-login' },
    pollMs: 5,
    timeoutMs: 400,
    ...over,
  })
  return { login, children, signIn: () => (signedIn = true) }
}

describe('bundledCodexExe', () => {
  it('prefers the installed copy, then the dev build, else null', () => {
    const res = mkdtempSync(join(tmpdir(), 'res-'))
    const dev = mkdtempSync(join(tmpdir(), 'dev-'))
    expect(bundledCodexExe(res, dev)).toBeNull()
    mkdirSync(join(dev, 'codex', 'bin'), { recursive: true })
    writeFileSync(join(dev, 'codex', 'bin', 'codex.exe'), 'x')
    expect(bundledCodexExe(undefined, dev)).toBe(join(dev, 'codex', 'bin', 'codex.exe'))
    mkdirSync(join(res, 'codex', 'bin'), { recursive: true })
    writeFileSync(join(res, 'codex', 'bin', 'codex.exe'), 'x')
    expect(bundledCodexExe(res, dev)).toBe(join(res, 'codex', 'bin', 'codex.exe'))
  })
})

describe('CodexLogin', () => {
  it('starts codex login, reports the page address it prints, and finishes when the account shows up', async () => {
    const { login, children, signIn } = make()
    await login.start()
    expect(login.status().state).toBe('waiting')
    children[0]!.stdout.emit(
      'data',
      Buffer.from('Open https://auth.test/oauth/authorize?x=1 to sign in\n'),
    )
    expect(login.status().url).toBe('https://auth.test/oauth/authorize?x=1')
    signIn()
    await new Promise((r) => setTimeout(r, 40))
    expect(login.status().state).toBe('done')
    expect(children[0]!.killed).toBe(true) // the child is stopped once signed in
  })

  it('ignores a second start while one is running', async () => {
    const { login, children } = make()
    await login.start()
    await login.start()
    expect(children).toHaveLength(1)
  })

  it('cancel stops the child and goes back to idle', async () => {
    const { login, children } = make()
    await login.start()
    login.cancel()
    expect(children[0]!.killed).toBe(true)
    expect(login.status().state).toBe('idle')
  })

  it('fails with the exit code when the child exits before anyone signed in', async () => {
    const { login, children } = make()
    await login.start()
    children[0]!.emit('exit', 2)
    await new Promise((r) => setTimeout(r, 20))
    expect(login.status()).toMatchObject({ state: 'failed' })
    expect(login.status().reason).toMatch(/2/)
  })

  it('times out with a reason and stops the child', async () => {
    const { login, children } = make({ timeoutMs: 60 })
    await login.start()
    await new Promise((r) => setTimeout(r, 120))
    expect(login.status()).toMatchObject({ state: 'failed' })
    expect(children[0]!.killed).toBe(true)
  })

  it('a spawn that throws is a failed state, not an exception', async () => {
    const { login } = make({
      spawn: () => {
        throw new Error('ENOENT')
      },
    })
    await expect(login.start()).resolves.toBeUndefined()
    expect(login.status()).toMatchObject({ state: 'failed', reason: 'ENOENT' })
  })

  it('finishes at once when the account is already signed in', async () => {
    const { login, children, signIn } = make()
    signIn()
    await login.start()
    await new Promise((r) => setTimeout(r, 30))
    expect(login.status().state).toBe('done')
    expect(children[0]!.killed).toBe(true)
  })

  it('waits a moment after a clean exit: the account file is read about a second later', async () => {
    const { login, children, signIn } = make({ exitGraceMs: 300 })
    await login.start()
    children[0]!.emit('exit', 0)
    setTimeout(signIn, 60)
    await new Promise((r) => setTimeout(r, 200))
    expect(login.status().state).toBe('done')
  })

  it('fails after the grace period when a clean exit never shows an account', async () => {
    const { login, children } = make({ exitGraceMs: 60 })
    await login.start()
    children[0]!.emit('exit', 0)
    await new Promise((r) => setTimeout(r, 150))
    expect(login.status()).toMatchObject({ state: 'failed' })
    expect(login.status().reason).toMatch(/0/)
  })

  it('a spawn error event is a failed state, not an uncaught exception', async () => {
    const { login, children } = make()
    await login.start()
    children[0]!.emit('error', new Error('EPERM'))
    expect(login.status()).toMatchObject({ state: 'failed', reason: 'EPERM' })
  })

  it('signs in with the executable the status was read from', async () => {
    const exePath = vi.fn(async (cliPath?: string) => cliPath ?? 'bundled')
    const readAccount = vi.fn(async () => ({ state: 'needs-login' as const }))
    const { login } = make({ exePath, readAccount })
    await login.start('C:/mine/codex.exe')
    await new Promise((r) => setTimeout(r, 20))
    expect(exePath).toHaveBeenCalledWith('C:/mine/codex.exe')
    expect(readAccount).toHaveBeenCalledWith('C:/mine/codex.exe')
    login.cancel()
  })

  it('reports a sign-in address printed on stderr', async () => {
    const { login, children } = make()
    await login.start()
    children[0]!.stderr.emit('data', Buffer.from('navigate to https://auth.test/device?x=2 now'))
    expect(login.status().url).toBe('https://auth.test/device?x=2')
    login.cancel()
  })
})
