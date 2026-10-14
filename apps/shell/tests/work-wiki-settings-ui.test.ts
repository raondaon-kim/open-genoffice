/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, WorkWikiSettings } from '../src/shared/home-api'
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

async function render(initial: WorkWikiSettings, picked: string | null) {
  let current = initial
  const set = vi.fn(async (patch: Partial<WorkWikiSettings>) => {
    current = { ...current, ...patch }
    return current
  })
  window.aiOffice = {
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
  return set
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
})
