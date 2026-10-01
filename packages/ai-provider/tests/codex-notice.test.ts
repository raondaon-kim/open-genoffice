import { describe, expect, it } from 'vitest'
import { CODEX_SIGN_IN_NOTICE, codexSignInNotice } from '../src/index'

const signedOut = [
  { id: 'genspark', status: 'unavailable' },
  { id: 'codex', status: 'not-configured' },
]

describe('codexSignInNotice', () => {
  it('tells a signed-out user on the default Codex route where to sign in', () => {
    expect(codexSignInNotice({ providerId: 'codex', modelId: 'gpt-5.6-luna' }, signedOut)).toBe(
      CODEX_SIGN_IN_NOTICE,
    )
    expect(CODEX_SIGN_IN_NOTICE).toMatch(/Settings › AI/)
    expect(CODEX_SIGN_IN_NOTICE).toMatch(/Codex/)
  })

  it('also covers an unusable Codex (binary error) and providers not loaded yet', () => {
    const route = { providerId: 'codex', modelId: 'gpt-5.6-luna' }
    expect(codexSignInNotice(route, [{ id: 'codex', status: 'unavailable' }])).toBe(
      CODEX_SIGN_IN_NOTICE,
    )
    expect(codexSignInNotice(route, [])).toBe(CODEX_SIGN_IN_NOTICE)
  })

  it('stays quiet when Codex is connected or the route is another provider', () => {
    expect(
      codexSignInNotice({ providerId: 'codex', modelId: 'gpt-5.6-luna' }, [
        { id: 'codex', status: 'connected' },
      ]),
    ).toBeNull()
    expect(codexSignInNotice({ providerId: 'openai', modelId: 'gpt-4.1' }, signedOut)).toBeNull()
    expect(codexSignInNotice(null, signedOut)).toBeNull()
  })
})
