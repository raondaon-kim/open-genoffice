/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexLoginView, CodexStatusView, HomeApi } from '../src/shared/home-api'
import { CodexConnectionRow } from '../src/renderer/src/CodexConnectionRow'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const t = ((key: string, p?: Record<string, string>) =>
  p ? `${key}:${Object.values(p).join(',')}` : key) as never

async function render(status: CodexStatusView, login: CodexLoginView = { state: 'idle' }) {
  const start = vi.fn(async (): Promise<CodexLoginView> => ({
    state: 'waiting',
    url: 'https://auth.test/x',
  }))
  const cancel = vi.fn(async () => undefined)
  const onConnected = vi.fn()
  window.aiOffice = {
    getCodexStatus: async () => status,
    getCodexLogin: async () => login,
    startCodexLogin: start,
    cancelCodexLogin: cancel,
  } as unknown as HomeApi
  await act(async () => {
    root.render(createElement(CodexConnectionRow, { t, cliPath: '', onConnected }))
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return { start, cancel, onConnected }
}

const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label) as
    HTMLButtonElement | undefined

describe('Codex connection row', () => {
  it('shows who is connected, offers no login, and tells the pane', async () => {
    const { onConnected } = await render({
      state: 'connected',
      account: 'a@b.test',
      loginable: true,
    })
    expect(host.textContent).toContain('setCodexConnected:a@b.test')
    expect(button('setCodexLogin')).toBeUndefined()
    expect(onConnected).toHaveBeenCalled()
  })

  it('offers Login when sign-in is needed and starts it', async () => {
    const { start } = await render({ state: 'needs-login', loginable: true })
    expect(host.textContent).toContain('setCodexNeedsLogin')
    await act(async () => {
      button('setCodexLogin')!.click()
      await Promise.resolve()
    })
    expect(start).toHaveBeenCalled()
    expect(host.textContent).toContain('https://auth.test/x')
    expect(button('setCodexLoginCancel')).toBeDefined()
  })

  it('says the component is missing and offers no login', async () => {
    await render({ state: 'missing', reason: 'x', loginable: false })
    expect(host.textContent).toContain('setCodexMissing')
    expect(button('setCodexLogin')).toBeUndefined()
  })

  it('cancels a running sign-in', async () => {
    const { cancel } = await render({ state: 'needs-login', loginable: true }, { state: 'waiting' })
    await act(async () => {
      button('setCodexLoginCancel')!.click()
      await Promise.resolve()
    })
    expect(cancel).toHaveBeenCalled()
  })

  it('shows why a sign-in failed', async () => {
    await render(
      { state: 'needs-login', loginable: true },
      { state: 'failed', reason: 'timed out' },
    )
    expect(host.textContent).toContain('setCodexLoginFailed:timed out')
  })
})
