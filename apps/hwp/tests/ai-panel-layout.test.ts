// @vitest-environment jsdom
// The HWP assistant uses the same panel layout as the other editors: a dock that comes
// first in the row (left by default, Settings › AI panel side moves it), a 34px rail
// when collapsed, the shared header/chat/composer classes, and the shared width store.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@genoffice/ui', () => ({
  AiComposer: () => React.createElement('div', { 'data-testid': 'composer' }),
  Markdown: ({ text }: { text: string }) => React.createElement('div', null, text),
  AiTypingIndicator: ({ label }: { label: string }) =>
    React.createElement('span', { className: 'ai-typing' }, label),
  AiPanelSideButton: () =>
    React.createElement('button', { className: 'ai-header-btn ai-panel-side-button' }),
  aiPanelWidthAtPointer: (x: number) => x,
  AttachmentWikiButton: () => null,
}))

import { HwpAiPanel } from '../src/renderer/ai/AiPanel'
import { HwpAiDock } from '../src/renderer/ai/AiDock'
import { SnapshotStack } from '../src/renderer/ai/snapshots'

function installApi(chat: unknown[] = []) {
  const api = {
    resolveProjectChat: vi.fn(async () => ({ projectId: 'default', chatId: '0123456789abcdef' })),
    getAiSettings: vi.fn(async () => ({ provider: 'openai' })),
    loadProjectChat: vi.fn(async () => chat),
    getLanguage: vi.fn(async () => 'ko'),
    onAiStream: vi.fn(() => () => undefined),
    aiSnapshot: vi.fn(async () => ({ ok: false, error: 'unused' })),
    aiQuery: vi.fn(async () => ({ ok: false, error: 'unused' })),
    setAiPanelPrefs: vi.fn(async () => ({ side: 'right' })),
  }
  ;(window as unknown as { hwpApi: unknown }).hwpApi = api
  return api
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollTo = () => undefined
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function renderPanel(onCollapse = () => undefined) {
  await act(async () => {
    root.render(
      React.createElement(
        'div',
        { className: 'ai-dock' },
        React.createElement(HwpAiPanel, {
          deps: {
            editor: () => null,
            fileName: () => 'doc.hwpx',
            markAiDirty: () => undefined,
            stack: new SnapshotStack(),
          },
          filePath: 'C:/docs/doc.hwpx',
          documentReady: true,
          onCollapse,
        } as never),
      ),
    )
  })
  await settle()
}

describe('HWP AI panel — shared panel layout', () => {
  it('renders the shared panel parts: resizer, header actions, chat and composer', async () => {
    installApi()
    const onCollapse = vi.fn()
    await renderPanel(onCollapse)
    const panel = container.querySelector('aside.copilot')
    expect(panel).not.toBeNull()
    expect(panel!.querySelector('.ai-panel-resizer')).not.toBeNull()
    expect(panel!.querySelector('.ai-panel-header .ai-panel-title')).not.toBeNull()
    expect(panel!.querySelector('.ai-panel-header .ai-panel-side-button')).not.toBeNull()
    expect(panel!.querySelector('.ai-chat')).not.toBeNull()
    expect(panel!.querySelector('.ai-composer [data-testid="composer"]')).not.toBeNull()
    act(() => (panel!.querySelector('.ai-panel-collapse') as HTMLButtonElement).click())
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('gives the dock the other editors’ default width', async () => {
    installApi()
    await renderPanel()
    const dock = container.querySelector('.ai-dock') as HTMLElement
    expect(dock.style.getPropertyValue('--ai-panel-width')).toBe('360px')
  })

  it('keeps a width the user already chose for the HWP panel', async () => {
    installApi()
    localStorage.setItem('hwp-ai-panel-width', '500')
    await renderPanel()
    const dock = container.querySelector('.ai-dock') as HTMLElement
    expect(dock.style.getPropertyValue('--ai-panel-width')).toBe('500px')
  })

  it('shows the conversation with the shared message classes and tool steps', async () => {
    installApi([
      { seq: 0, ts: 't', role: 'user', text: 'question' },
      {
        seq: 1,
        ts: 't',
        role: 'assistant',
        text: 'answer',
        tools: [
          { name: 'read_pages', summary: 'Read page 1' },
          { name: 'find', summary: 'Found 2 matches' },
        ],
      },
    ])
    await renderPanel()
    expect(container.querySelector('.ai-msg.ai-msg-user')?.textContent).toBe('question')
    const reply = container.querySelector('.ai-msg.ai-msg-assistant')
    expect(reply?.textContent).toContain('answer')
    expect(reply?.querySelector('.ai-work-group')?.textContent).toMatch(/2/)
  })

  it('opens the empty state at its top (no jump to the bottom of the long starter list)', async () => {
    installApi()
    const scrolled = vi.fn()
    Element.prototype.scrollTo = scrolled
    await renderPanel()
    expect(container.querySelector('.ai-chat-empty-title')).not.toBeNull()
    expect(scrolled).not.toHaveBeenCalled()
  })

  it('offers New chat only once there is a conversation, and it clears the view', async () => {
    installApi([{ seq: 0, ts: 't', role: 'user', text: 'question' }])
    await renderPanel()
    const newChat = container.querySelector('.ai-panel-new-chat') as HTMLButtonElement
    expect(newChat).not.toBeNull()
    act(() => newChat.click())
    expect(container.querySelector('.ai-msg')).toBeNull()
    expect(container.querySelector('.ai-panel-new-chat')).toBeNull()
    expect(container.querySelectorAll('.ai-chat-empty .ai-starter').length).toBeGreaterThan(0)
  })
})

describe('HWP AI dock — collapse to the rail', () => {
  function renderDock(open: boolean, onOpen = () => undefined) {
    act(() => {
      root.render(
        React.createElement(
          HwpAiDock,
          { open, lang: 'ko', onOpen },
          React.createElement('aside', { className: 'copilot' }, 'chat'),
        ),
      )
    })
  }

  it('shows the panel and no rail while open', () => {
    renderDock(true)
    const dock = container.querySelector('.ai-dock')!
    expect(dock.classList.contains('collapsed')).toBe(false)
    expect(dock.querySelector('.ai-rail')).toBeNull()
    expect(dock.querySelector('.copilot')).not.toBeNull()
  })

  it('collapses to a rail that reopens it, keeping the panel mounted', () => {
    const onOpen = vi.fn()
    renderDock(false, onOpen)
    const dock = container.querySelector('.ai-dock')!
    expect(dock.classList.contains('collapsed')).toBe(true)
    expect(dock.querySelector('.copilot')).not.toBeNull()
    act(() => (dock.querySelector('.ai-rail') as HTMLButtonElement).click())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
