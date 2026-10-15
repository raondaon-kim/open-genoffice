import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accountStateOf, resolveCodexCliPath } from '../src/codex-app-server'

const file = (dir: string, name: string) => {
  const p = join(dir, name)
  writeFileSync(p, 'x')
  return p
}

describe('resolveCodexCliPath with a bundled copy', () => {
  const win = { platform: 'win32' as const, env: { PATH: '' } }

  it('uses the bundled copy before the desktop app and PATH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-'))
    const bundled = file(dir, 'codex.exe')
    const r = await resolveCodexCliPath(undefined, {
      ...win,
      bundledPath: bundled,
      managedInstallRoot: join(dir, 'none'),
    })
    expect(r).toBe(bundled)
  })

  it('still prefers the path the user set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-'))
    const bundled = file(dir, 'codex.exe')
    const mine = file(dir, 'mine.exe')
    expect(await resolveCodexCliPath(mine, { ...win, bundledPath: bundled })).toBe(mine)
  })

  it('falls through to PATH when the bundled file is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-'))
    const onPath = join(dir, 'bin')
    mkdirSync(onPath)
    const exe = file(onPath, 'codex.exe')
    const r = await resolveCodexCliPath(undefined, {
      platform: 'win32',
      env: { PATH: onPath },
      bundledPath: join(dir, 'missing', 'codex.exe'),
      managedInstallRoot: join(dir, 'none'),
    })
    expect(r).toBe(exe)
  })
})

describe('accountStateOf', () => {
  it('maps the app-server account/read answer', () => {
    expect(accountStateOf({ account: null, requiresOpenaiAuth: true })).toEqual({
      state: 'needs-login',
    })
    expect(accountStateOf({ account: { email: 'a@b.test' }, requiresOpenaiAuth: true })).toEqual({
      state: 'connected',
      account: 'a@b.test',
    })
    expect(accountStateOf({ account: { type: 'chatgpt' } })).toEqual({
      state: 'connected',
      account: 'ChatGPT',
    })
    expect(accountStateOf(undefined)).toEqual({ state: 'error', reason: 'no account answer' })
  })
})
