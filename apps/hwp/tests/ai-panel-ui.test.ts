// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@genoffice/ui', () => ({
  AiComposer: () => React.createElement('div', { 'data-testid': 'composer' }),
  Markdown: ({ text }: { text: string }) => React.createElement('div', null, text),
}))

import { HwpAiPanel } from '../src/renderer/ai/AiPanel'
import { SnapshotStack } from '../src/renderer/ai/snapshots'

function editor() {
  return {
    getDocumentState: vi.fn(async () => ({
      schemaVersion: 1,
      format: 'hwpx',
      documentEpoch: 1,
      changeSeq: 1,
      dirty: false,
      pageCount: 1,
      documentSha256: 'a'.repeat(64),
    })),
    exportHwpx: vi.fn(async () => new Uint8Array([1, 2, 3])),
  }
}

function installApi(explore: unknown, chat: unknown[] = []) {
  const api = {
    resolveProjectChat: vi.fn(async () => ({ projectId: 'default', chatId: '0123456789abcdef' })),
    getAiSettings: vi.fn(async () => ({ provider: 'openai' })),
    loadProjectChat: vi.fn(async () => chat),
    getLanguage: vi.fn(async () => 'ko'),
    onAiStream: vi.fn(() => () => undefined),
    aiSnapshot: vi.fn(async () => ({ ok: true })),
    aiQuery: vi.fn(async () => explore),
  }
  ;(window as unknown as { hwpApi: unknown }).hwpApi = api
  return api
}

describe('HWP AI panel — engine-suggested chips', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo = () => undefined
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(documentReady: boolean, stack = new SnapshotStack()) {
    await act(async () => {
      root.render(
        React.createElement(HwpAiPanel, {
          deps: {
            editor: () => editor(),
            fileName: () => 'doc.hwpx',
            markAiDirty: () => undefined,
            stack,
          },
          filePath: 'C:/docs/doc.hwpx',
          documentReady,
          onCollapse: () => undefined,
        } as never),
      )
    })
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }

  it('shows up to three explore suggestions once the document is open', async () => {
    const api = installApi({
      ok: true,
      result: {
        exitCode: 0,
        stderr: '',
        envelope: {
          schemaVersion: '1.0',
          menu: [
            { why: '표 1개 — 격자 추출·수정' },
            { why: '요약' },
            { why: '검색' },
            { why: '넷째' },
          ],
        },
      },
    })
    await render(true)
    const chips = [...container.querySelectorAll('.hwp-ai__starter--chip')].map(
      (c) => c.textContent,
    )
    expect(chips).toEqual(['표 1개 — 격자 추출·수정', '요약', '검색'])
    expect(api.aiQuery).toHaveBeenCalledWith(expect.objectContaining({ tool: 'explore' }))
  })

  it('shows no chips and asks nothing while the document is still loading', async () => {
    const api = installApi({ ok: false, error: 'unused' })
    await render(false)
    expect(container.querySelectorAll('.hwp-ai__starter--chip')).toHaveLength(0)
    expect(api.aiQuery).not.toHaveBeenCalled()
  })

  it('keeps the AI undo history across a collapse (the stack lives in the app)', async () => {
    installApi({ ok: false, error: 'explore failed' })
    const stack = new SnapshotStack()
    stack.push({ sha: 'a'.repeat(64), bytes: new Uint8Array([1]) })
    // a remount after collapse/expand gets the app's stack back
    await render(true, stack)
    expect(container.querySelector('.hwp-ai__undo')?.textContent).toMatch(/(1)/)
  })

  it('restores the saved conversation of the document and reads the AI settings', async () => {
    const api = installApi({ ok: false, error: 'explore failed' }, [
      { seq: 0, ts: 't', role: 'user', text: 'question' },
      { seq: 1, ts: 't', role: 'assistant', text: 'answer' },
    ])
    await render(true)
    const texts = [...container.querySelectorAll('.hwp-ai__msg')].map((m) => m.textContent)
    expect(texts).toEqual(['question', 'answer'])
    expect(api.getAiSettings).toHaveBeenCalled()
  })

  it('hides the undo button until an AI edit exists', async () => {
    installApi({ ok: false, error: 'explore failed' })
    await render(true)
    expect(container.querySelector('.hwp-ai__undo')).toBeNull()
    expect(container.querySelectorAll('.hwp-ai__starter--chip')).toHaveLength(0)
  })
})
