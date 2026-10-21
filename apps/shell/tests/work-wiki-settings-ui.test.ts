/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, LlmWikiStatusView, WorkWikiSettings } from '../src/shared/home-api'
import { WorkWikiSettingsBlock } from '../src/renderer/src/WorkWikiSettings'

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

const t = ((key: string) => key) as never

async function render(
  initial: WorkWikiSettings,
  picked: string | null,
  llmStatus?: LlmWikiStatusView,
) {
  let current = initial
  const set = vi.fn(async (patch: Partial<WorkWikiSettings>) => {
    current = { ...current, ...patch }
    return current
  })
  const openLlmWiki = vi.fn(async () => true)
  window.aiOffice = {
    ...(llmStatus ? { getLlmWikiStatus: async () => llmStatus, openLlmWiki } : {}),
    getWorkWikiSettings: async () => current,
    setWorkWikiSettings: set,
    pickWorkWikiFolder: async () => picked,
  } as unknown as HomeApi
  await act(async () => {
    root.render(createElement(WorkWikiSettingsBlock, { t }))
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return Object.assign(set, { openLlmWiki })
}

const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  ) as HTMLButtonElement | undefined

describe('work wiki settings block', () => {
  it('lists excluded folders and adds one through the folder picker', async () => {
    const set = await render({ enabled: true, folder: 'D:/wiki', exclude: ['D:/private'] }, 'D:/hr')
    expect(host.textContent).toContain('D:/private')
    await act(async () => {
      button('setWorkWikiExcludeAdd')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(set).toHaveBeenCalledWith({ exclude: ['D:/private', 'D:/hr'] })
  })

  it('removes an excluded folder', async () => {
    const set = await render({ enabled: true, folder: 'D:/wiki', exclude: ['D:/private'] }, null)
    await act(async () => {
      button('setWorkWikiExcludeRemove')!.click()
      await Promise.resolve()
    })
    expect(set).toHaveBeenCalledWith({ exclude: [] })
  })

  it('shows why LLM Wiki is not running and keeps its open button off', async () => {
    await render({ enabled: true, folder: 'D:/wiki', exclude: [] }, null, {
      state: 'failed',
      reason: 'x',
      available: true,
    })
    expect(host.textContent).toContain('setLlmWikiFailed')
    expect(button('setLlmWikiOpen')!.disabled).toBe(true)
  })

  it('opens LLM Wiki from the button when it is running', async () => {
    const set = await render({ enabled: true, folder: 'D:/wiki', exclude: [] }, null, {
      state: 'running',
      available: true,
    })
    expect(host.textContent).toContain('setLlmWikiRunning')
    expect(button('setLlmWikiOpen')!.disabled).toBe(false)
    await act(async () => {
      button('setLlmWikiOpen')!.click()
      await Promise.resolve()
    })
    expect(set.openLlmWiki).toHaveBeenCalled()
  })

  it('shows the saved-copies switch, on by default, and saves it', async () => {
    const set = await render(
      {
        enabled: true,
        folder: 'D:/wiki',
        exclude: [],
        mirrorSaved: true,
        mirrorNoticeShown: false,
      },
      null,
    )
    expect(host.textContent).toContain('setWorkWikiMirrorSavedDesc')
    const sw = [...host.querySelectorAll('[role="switch"]')].find(
      (b) => b.getAttribute('aria-label') === 'setWorkWikiMirrorSaved',
    ) as HTMLButtonElement
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      sw.click()
      await Promise.resolve()
    })
    expect(set).toHaveBeenCalledWith({ mirrorSaved: false })
  })

  it('says so when this install does not include LLM Wiki', async () => {
    await render({ enabled: true, folder: 'D:/wiki', exclude: [] }, null, {
      state: 'stopped',
      available: false,
    })
    expect(host.textContent).toContain('setLlmWikiMissing')
  })
})
