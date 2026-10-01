import { describe, expect, it } from 'vitest'
import { codexCardView } from '../src/renderer/src/settings/codex-card'

const bundled = {
  path: 'C:\\Program Files\\Open GenOffice\\resources\\native\\codex-app-server.exe',
  source: 'bundled' as const,
  version: '0.159.3',
}

describe('codexCardView', () => {
  it('shows checking before the first status arrives', () => {
    expect(codexCardView(null, null)).toMatchObject({ badge: 'checking', actions: [] })
  })

  it('shows the account and plan when connected, with sign-out', () => {
    expect(
      codexCardView(
        {
          state: 'connected',
          accountType: 'chatgpt',
          email: 'a@b.com',
          planType: 'prolite',
          binary: bundled,
        },
        null,
      ),
    ).toEqual({
      badge: 'connected',
      title: 'Connected as a@b.com',
      detail: 'ChatGPT plan: prolite',
      actions: ['logout'],
      binaryLine: 'Codex 0.159.3 · bundled with Open GenOffice',
      deviceCode: null,
    })
  })

  it('labels an API-key sign-in honestly', () => {
    expect(
      codexCardView({ state: 'connected', accountType: 'apiKey', binary: bundled }, null),
    ).toMatchObject({
      title: 'Connected with an OpenAI API key',
      detail: null,
    })
  })

  it('offers every sign-in method when signed out', () => {
    expect(codexCardView({ state: 'signed-out', binary: bundled }, null)).toMatchObject({
      badge: 'signed-out',
      title: 'Not signed in',
      actions: ['login', 'login-device', 'login-api-key'],
    })
  })

  it('shows the device code while a device sign-in is open, and cancel for any open sign-in', () => {
    const device = {
      method: 'chatgptDeviceCode' as const,
      loginId: 'L2',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'AB-12',
    }
    expect(codexCardView({ state: 'signed-out' }, device)).toMatchObject({
      badge: 'signing-in',
      actions: ['cancel'],
      deviceCode: { code: 'AB-12', url: 'https://auth.openai.com/codex/device' },
    })
    expect(
      codexCardView({ state: 'signed-out' }, { method: 'chatgpt', loginId: 'L1' }),
    ).toMatchObject({
      badge: 'signing-in',
      title: 'Finish signing in in your browser',
      actions: ['cancel'],
      deviceCode: null,
    })
  })

  it('surfaces an unusable binary as an error with retry', () => {
    expect(
      codexCardView(
        { state: 'error', message: 'Codex executable not found: D:\\nope\\codex.exe' },
        null,
      ),
    ).toEqual({
      badge: 'error',
      title: 'Codex is unavailable',
      detail: 'Codex executable not found: D:\\nope\\codex.exe',
      actions: ['retry'],
      binaryLine: null,
      deviceCode: null,
    })
  })

  it('names a custom or detected binary by its path', () => {
    const view = codexCardView(
      {
        state: 'signed-out',
        binary: { path: 'D:\\tools\\codex.exe', source: 'custom', version: '0.159.2' },
      },
      null,
    )
    expect(view.binaryLine).toBe('Codex 0.159.2 · custom path D:\\tools\\codex.exe')
  })
})
