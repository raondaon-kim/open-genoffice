// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickLook } from '../src/renderer/src/QuickLook'
import { QUICK_LOOK_LABELS } from '../src/renderer/src/quick-look-strings'
import type { QuickLookPayload } from '../src/shared/home-api'

const items = [
  { path: 'C:/d/a.docx', name: 'a.docx', ext: 'docx' },
  { path: 'C:/d/b.png', name: 'b.png', ext: 'png' },
  { path: 'C:/d/c.pdf', name: 'c.pdf', ext: 'pdf' },
]
const ok = (
  path: string,
  extra: Partial<Extract<QuickLookPayload, { ok: true }>> = {},
): QuickLookPayload => ({
  ok: true,
  path,
  name: path.split('/').pop()!,
  ext: path.split('.').pop()!,
  sizeBytes: 2048,
  mtimeMs: Date.UTC(2026, 9, 20),
  truncated: false,
  ...extra,
})

let host: HTMLDivElement
let root: Root
let quickLook: ReturnType<typeof vi.fn>

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  quickLook = vi.fn(async (path: string) => ok(path, { text: `text of ${path}` }))
  ;(window as unknown as { aiOffice: unknown }).aiOffice = { quickLook }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}
const render = async (props: Partial<React.ComponentProps<typeof QuickLook>> = {}) => {
  const handlers = { onIndex: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() }
  await act(async () =>
    root.render(
      React.createElement(QuickLook, { items, index: 0, lang: 'ko', ...handlers, ...props }),
    ),
  )
  await settle()
  return handlers
}
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!
const press = (key: string) =>
  act(() => {
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

describe('Quick Look overlay', () => {
  it('shows the file name and the start of its text, and says when the text was cut', async () => {
    quickLook.mockResolvedValueOnce(ok('C:/d/a.docx', { text: '본문 앞부분', truncated: true }))
    await render()
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    expect(dialog().textContent).toContain('a.docx')
    expect(host.querySelector('.quick-look-text')!.textContent).toBe('본문 앞부분')
    expect(dialog().textContent).toContain(QUICK_LOOK_LABELS.ko.truncated)
  })

  it('shows an image payload as an image', async () => {
    quickLook.mockResolvedValueOnce(ok('C:/d/b.png', { image: 'data:image/png;base64,AAAA' }))
    await render({ index: 1 })
    expect(host.querySelector<HTMLImageElement>('.quick-look-image')!.getAttribute('src')).toBe(
      'data:image/png;base64,AAAA',
    )
  })

  it('names the problem for a missing file, a format without preview and an IPC failure', async () => {
    quickLook.mockResolvedValueOnce({
      ok: false,
      path: 'C:/d/a.docx',
      name: 'a.docx',
      error: 'missing',
    })
    await render()
    expect(dialog().textContent).toContain(QUICK_LOOK_LABELS.ko.missing)
    act(() => root.unmount())
    root = createRoot(host)
    quickLook.mockResolvedValueOnce(ok('C:/d/a.docx'))
    await render()
    expect(dialog().textContent).toContain(QUICK_LOOK_LABELS.ko.unsupported)
    act(() => root.unmount())
    root = createRoot(host)
    quickLook.mockRejectedValueOnce(new Error('ipc'))
    await render()
    expect(dialog().textContent).toContain(QUICK_LOOK_LABELS.ko.unreadable)
  })

  it('Space and Esc close it; Enter and the Open button open the file', async () => {
    const h = await render()
    press(' ')
    press('Escape')
    expect(h.onClose).toHaveBeenCalledTimes(2)
    press('Enter')
    expect(h.onOpen).toHaveBeenCalledWith('C:/d/a.docx')
    act(() => host.querySelector<HTMLButtonElement>('.quick-look-open')!.click())
    expect(h.onOpen).toHaveBeenCalledTimes(2)
  })

  it('arrows step within the list and stop at its ends', async () => {
    const first = await render({ index: 0 })
    press('ArrowUp')
    press('ArrowDown')
    expect(first.onIndex.mock.calls).toEqual([[1]])
    act(() => root.unmount())
    root = createRoot(host)
    const last = await render({ index: 2 })
    press('ArrowDown')
    press('ArrowUp')
    expect(last.onIndex.mock.calls).toEqual([[1]])
  })

  it('shows the reply for the file now selected, never a late one for an earlier file', async () => {
    let release!: (p: QuickLookPayload) => void
    quickLook.mockImplementationOnce(() => new Promise((r) => (release = r)))
    const h = await render({ index: 0 })
    await act(async () =>
      root.render(React.createElement(QuickLook, { items, index: 2, lang: 'ko', ...h })),
    )
    await settle()
    await act(async () => release(ok('C:/d/a.docx', { text: 'LATE' })))
    await settle()
    expect(dialog().textContent).toContain('c.pdf')
    expect(dialog().textContent).not.toContain('LATE')
  })

  it('has every label in the 21 Home languages', () => {
    const langs = [
      'zh',
      'en',
      'ja',
      'ko',
      'fr',
      'de',
      'es',
      'th',
      'id',
      'ru',
      'ar',
      'pt',
      'it',
      'pl',
      'cs',
      'nl',
      'ms',
      'he',
      'hi',
      'zh-TW',
      'vi',
    ]
    const keys = [
      'open',
      'close',
      'loading',
      'unsupported',
      'missing',
      'tooLarge',
      'unreadable',
      'truncated',
      'previous',
      'next',
    ] as const
    for (const lang of langs)
      for (const key of keys)
        expect(
          QUICK_LOOK_LABELS[lang as keyof typeof QUICK_LOOK_LABELS][key],
          `${lang}.${key}`,
        ).toBeTruthy()
  })
})
