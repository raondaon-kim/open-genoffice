// @vitest-environment jsdom
// The split pane's role wiring for the Hangul editor (modelled on IeumOffice's
// apps/hwp/tests/split-pane.test.ts): a secondary pane folds the AI panel to its
// rail while the panel stays mounted, a click on that rail asks the shell to
// focus this pane and remembers the panel as open, and the app reports focus
// pings from its root. The shell's bridge is faked.
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SplitPaneRole } from '@genoffice/ui'
import { HwpAiDock } from '../src/renderer/ai/AiDock'

interface FakeSplit {
  requestFocus: ReturnType<typeof vi.fn>
  reportFocus: ReturnType<typeof vi.fn>
  /** the shell moves this view to another role: every listener hears it */
  push(role: SplitPaneRole | null): void
}

function installSplit(initial: SplitPaneRole | null): FakeSplit {
  let role = initial
  const listeners = new Set<(role: SplitPaneRole | null) => void>()
  const requestFocus = vi.fn()
  const reportFocus = vi.fn()
  ;(window as { aiOfficeSplit?: unknown }).aiOfficeSplit = {
    getRole: async () => role,
    onRoleChanged: (handler: (role: SplitPaneRole | null) => void) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    requestFocus,
    reportFocus,
  }
  return {
    requestFocus,
    reportFocus,
    push(next) {
      role = next
      for (const handler of listeners) handler(next)
    },
  }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (window as { aiOfficeSplit?: unknown }).aiOfficeSplit
  vi.unstubAllGlobals()
})

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function renderDock(open: boolean, onOpen = vi.fn()): Promise<typeof onOpen> {
  act(() => {
    root.render(
      React.createElement(
        HwpAiDock,
        { open, lang: 'ko', onOpen },
        React.createElement('aside', { className: 'copilot' }, 'chat'),
      ),
    )
  })
  await settle()
  return onOpen
}

const dock = () => container.querySelector('.ai-dock') as HTMLElement
const rail = () => dock().querySelector('.ai-rail') as HTMLButtonElement | null

describe('Hangul AI dock in a split', () => {
  it('shows the panel outside a split when open', async () => {
    await renderDock(true)
    expect(dock().classList.contains('collapsed')).toBe(false)
    expect(rail()).toBeNull()
  })

  it('folds to the rail in a secondary pane, keeping the panel mounted', async () => {
    installSplit('secondary')
    await renderDock(true)
    expect(dock().classList.contains('collapsed')).toBe(true)
    expect(rail()).not.toBeNull()
    expect(dock().querySelector('.copilot')).not.toBeNull()
  })

  it('asks the shell for focus from the rail of a secondary pane', async () => {
    const split = installSplit('secondary')
    const onOpen = await renderDock(false)
    act(() => rail()!.click())
    expect(split.requestFocus).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows the panel again once the pane becomes the focus pane', async () => {
    const split = installSplit('secondary')
    await renderDock(true)
    expect(dock().classList.contains('collapsed')).toBe(true)
    act(() => split.push('focus'))
    expect(dock().classList.contains('collapsed')).toBe(false)
  })

  it('opens from the rail without asking for focus outside a split', async () => {
    const split = installSplit(null)
    const onOpen = await renderDock(false)
    act(() => rail()!.click())
    expect(split.requestFocus).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('Hangul split wiring', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

  it('exposes the shell split bridge from the preload', () => {
    const preload = src('src/preload/index.ts')
    expect(preload).toMatch(/from '@genoffice\/electron-utils\/split-pane-bridge'/)
    expect(preload).toMatch(/exposeInMainWorld\('aiOfficeSplit', splitPaneBridge\(ipcRenderer\)\)/)
  })

  it('reports focus pings from the app root', () => {
    expect(src('src/renderer/App.tsx')).toMatch(/useSplitPaneFocusPing\(\)/)
  })
})
