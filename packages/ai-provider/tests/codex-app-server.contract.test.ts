/** @vitest-environment node */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cancelCodexLogin, readCodexAccount, startCodexLogin } from '../src/codex-account'
import { listCodexModels, shutdownCodexAppServers, withCodexRpc } from '../src/codex-app-server'

/**
 * Pins the app-server protocol the app relies on against the bundled binary
 * (npm run fetch:codex). Uses the developer's real ~/.codex sign-in, so it only
 * reads and starts-then-cancels sign-ins. NEVER add account/logout or an apiKey
 * login here: on 2026-10-01 a probe of account/logout signed the machine out.
 */
const exe = process.platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server'
const BIN =
  process.env.CODEX_APP_SERVER_BIN ??
  join(
    resolve(__dirname, '../../..'),
    'apps',
    'shell',
    'native',
    'codex',
    `${process.platform}-${process.arch}`,
    exe,
  )

describe.skipIf(!existsSync(BIN))('codex app-server contract (bundled binary)', () => {
  afterAll(() => shutdownCodexAppServers())

  it('initializes and reports the pinned version', async () => {
    const userAgent = await withCodexRpc(BIN, async (rpc) => rpc.userAgent)
    expect(userAgent).toMatch(/^genoffice\/0\.159\.3 /)
  })

  it('reads the account summary without refreshing tokens', async () => {
    const status = await withCodexRpc(BIN, (rpc) => readCodexAccount(rpc))
    expect(['connected', 'signed-out']).toContain(status.state)
  })

  it('lists models with a default when signed in', async () => {
    const status = await withCodexRpc(BIN, (rpc) => readCodexAccount(rpc))
    if (status.state !== 'connected') return
    const catalog = await listCodexModels(BIN)
    expect(catalog.models.length).toBeGreaterThan(0)
    expect(catalog.models).toContain(catalog.defaultModel)
  })

  it('starts and cancels browser and device-code sign-ins without changing the account', async () => {
    await withCodexRpc(BIN, async (rpc) => {
      const before = await readCodexAccount(rpc)
      const browser = await startCodexLogin(rpc, 'chatgpt')
      if (browser.method !== 'chatgpt') throw new Error('expected a browser sign-in')
      expect(browser.authUrl).toMatch(/^https:\/\//)
      await cancelCodexLogin(rpc, browser.loginId)
      const device = await startCodexLogin(rpc, 'chatgptDeviceCode')
      if (device.method !== 'chatgptDeviceCode') throw new Error('expected a device-code sign-in')
      expect(device.verificationUrl).toMatch(/^https:\/\//)
      expect(device.userCode.length).toBeGreaterThan(3)
      await cancelCodexLogin(rpc, device.loginId)
      expect(await readCodexAccount(rpc)).toEqual(before)
    })
  })
})
