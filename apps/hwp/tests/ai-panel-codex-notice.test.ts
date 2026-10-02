// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CODEX_SIGN_IN_NOTICE } from '@genoffice/ai-provider'

vi.mock('@genoffice/ui', () => ({
  ModelPicker: () => React.createElement('div', { 'data-testid': 'picker' }),
  AiComposer: () => React.createElement('div', { 'data-testid': 'composer' }),
  Markdown: ({ text }: { text: string }) => React.createElement('div', null, text),
  ThinkingBox: ({ text, live }: { text: string; live: boolean }) =>
    React.createElement('div', { 'data-testid': 'thinking', 'data-live': String(live) }, text),
  thinkingLabels: () => ({ thinking: 'Thinking…', show: 'Show', hide: 'Hide' }),
}))

import { HwpAiPanel } from '../src/renderer/ai/AiPanel'
import { SnapshotStack } from '../src/renderer/ai/snapshots'

const codexRoute = { providerId: 'codex', modelId: 'gpt-5.6-luna' }

function installApi(codexStatus: string, models: unknown[]) {
  ;(window as unknown as { hwpApi: unknown }).hwpApi = {
    resolveProjectChat: vi.fn(async () => ({ projectId: 'default', chatId: '0123456789abcdef' })),
    getAiPublicSettings: vi.fn(async () => ({
      globalDefault: codexRoute,
      providers: [
        { id: 'genspark', label: 'Genspark', status: 'unavailable', hasApiKey: false },
        { id: 'codex', label: 'Codex (ChatGPT)', status: codexStatus, hasApiKey: false },
      ],
    })),
    listAiModels: vi.fn(async () => ({ models })),
    getAiConversationRoute: vi.fn(async () => codexRoute),
    setAiConversationRoute: vi.fn(async (_identity: unknown, route: unknown) => route),
    loadProjectChat: vi.fn(async () => []),
    getLanguage: vi.fn(async () => 'en'),
    onAiStream: vi.fn(() => () => undefined),
  }
}

describe('HWP AI panel on the default Codex route', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // jsdom has no layout: the panel scrolls its chat list on every render
    Element.prototype.scrollTo = () => undefined
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('points a signed-out user to Settings › AI instead of "add a provider key"', async () => {
    installApi('not-configured', [])
    await act(async () => {
      root.render(
        React.createElement(HwpAiPanel, {
          deps: {
            editor: () => null,
            fileName: () => 'doc.hwp',
            markAiDirty: () => undefined,
            stack: new SnapshotStack(),
          },
          filePath: null,
          documentReady: false,
          onCollapse: () => undefined,
        } as never),
      )
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const notice = container.querySelector('.hwp-ai__notice')
    expect(notice?.textContent).toBe(CODEX_SIGN_IN_NOTICE)
  })
})
