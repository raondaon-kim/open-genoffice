/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type { UpdateUiState } from '../src/shared/update-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UpdateButton } from '../src/renderer/src/UpdateButton'

/** the tab bar's update button: shown once a check found a newer version; opens the update window */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let push: ((state: UpdateUiState) => void) | null
const openUpdateDialog = vi.fn(async () => true)
const unsubscribe = vi.fn()

const state = (patch: Partial<UpdateUiState>): UpdateUiState =>
  ({
    phase: 'available',
    version: '0.5.5',
    currentVersion: '0.5.4',
    percent: 0,
    lang: 'ko',
    strings: {},
    ...patch,
  }) as UpdateUiState

async function mount(initial: UpdateUiState | null): Promise<void> {
  window.aiOffice = {
    getUpdateState: async () => initial,
    onUpdateStateChanged: (handler: (s: UpdateUiState) => void) => {
      push = handler
      return unsubscribe
    },
    openUpdateDialog,
  } as unknown as HomeApi
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(UpdateButton)))
    await Promise.resolve()
  })
}

const button = () => host.querySelector<HTMLButtonElement>('.tab-update-btn')

beforeEach(() => {
  push = null
  openUpdateDialog.mockClear()
  unsubscribe.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('UpdateButton', () => {
  it('stays hidden while no update is known', async () => {
    await mount(null)
    expect(button()).toBeNull()
  })

  it('appears with the new version when a check finds one', async () => {
    await mount(null)
    act(() => push!(state({})))
    expect(button()?.textContent).toContain('0.5.5')
  })

  it('shows an update found before the shell mounted', async () => {
    await mount(state({}))
    expect(button()?.textContent).toContain('0.5.5')
  })

  it('opens the update window when clicked', async () => {
    await mount(state({}))
    await act(async () => {
      button()!.click()
      await Promise.resolve()
    })
    expect(openUpdateDialog).toHaveBeenCalledTimes(1)
  })

  it('follows the download and offers the restart', async () => {
    await mount(state({}))
    act(() => push!(state({ phase: 'downloading', percent: 41.6 })))
    expect(button()?.textContent).toContain('42%')
    act(() => push!(state({ phase: 'downloaded', percent: 100 })))
    expect(button()?.textContent).toBe('Restart & install')
  })

  it('stops listening when unmounted', async () => {
    await mount(null)
    act(() => root.unmount())
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    root = createRoot(host)
  })
})
