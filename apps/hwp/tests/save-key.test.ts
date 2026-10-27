import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveKeyLabel } from '../src/renderer/ai/save-key'

/** the assistant repeats the save shortcut it is told; on Windows that was "⌘S" (a Mac key) */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('save shortcut label', () => {
  it('is ⌘S on a Mac and Ctrl+S elsewhere', () => {
    expect(saveKeyLabel('MacIntel')).toBe('⌘S')
    expect(saveKeyLabel('Win32')).toBe('Ctrl+S')
    expect(saveKeyLabel('Linux x86_64')).toBe('Ctrl+S')
  })

  it('the assistant instructions name Ctrl+S on Windows, never ⌘S', async () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'Win32' })
    vi.resetModules()
    const { SYSTEM_PROMPT, AGENT_TOOLS } = await import('../src/renderer/ai/hwp-skill')
    const text = SYSTEM_PROMPT + JSON.stringify(AGENT_TOOLS)
    expect(text).toContain('Ctrl+S')
    expect(text).not.toContain('⌘S')
  })
})
