import { describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_SEED_ENV, seedDeepSeekKey } from '../src/main/ai-key-seed'

const KEY = 'sk-seed-test-0123456789abcdef'

function setup(
  options: {
    status?: 'missing' | 'ready' | 'unreadable'
    env?: Record<string, string | undefined>
    verify?: () => Promise<{ saved: boolean }>
  } = {},
) {
  const verifyAndSave = vi.fn(options.verify ?? (async () => ({ saved: true })))
  const warn = vi.fn()
  const run = () =>
    seedDeepSeekKey({
      secretStore: { status: () => options.status ?? 'missing' },
      settings: { verifyAndSave: verifyAndSave as never },
      env: options.env ?? { [DEEPSEEK_SEED_ENV]: KEY },
      warn,
    })
  return { run, verifyAndSave, warn }
}

describe('seedDeepSeekKey', () => {
  it('does nothing without the variable', async () => {
    const { run, verifyAndSave } = setup({ env: {} })
    expect(await run()).toBe('skipped')
    expect(verifyAndSave).not.toHaveBeenCalled()
  })

  it('does nothing for a blank variable', async () => {
    const { run, verifyAndSave } = setup({ env: { [DEEPSEEK_SEED_ENV]: '   ' } })
    expect(await run()).toBe('skipped')
    expect(verifyAndSave).not.toHaveBeenCalled()
  })

  it('never overwrites a key that is already stored', async () => {
    const { run, verifyAndSave } = setup({ status: 'ready' })
    expect(await run()).toBe('skipped')
    expect(verifyAndSave).not.toHaveBeenCalled()
  })

  it('saves through verifyAndSave when the profile has no key', async () => {
    const { run, verifyAndSave, warn } = setup({ status: 'missing' })
    expect(await run()).toBe('seeded')
    expect(verifyAndSave).toHaveBeenCalledWith({ providerId: 'deepseek', apiKey: KEY })
    expect(warn).not.toHaveBeenCalled()
  })

  it('replaces a stored key that can no longer be read', async () => {
    const { run, verifyAndSave } = setup({ status: 'unreadable' })
    expect(await run()).toBe('seeded')
    expect(verifyAndSave).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected key without leaking it', async () => {
    const { run, warn } = setup({ verify: async () => ({ saved: false }) })
    expect(await run()).toBe('failed')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY)
  })

  it('reports a thrown error without leaking the key', async () => {
    const { run, warn } = setup({
      verify: async () => {
        throw new Error(`HTTP 401 for Bearer ${KEY}`)
      },
    })
    expect(await run()).toBe('failed')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY)
  })
})
