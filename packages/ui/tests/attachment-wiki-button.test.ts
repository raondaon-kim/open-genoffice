/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AttachmentWikiButton, resetAttachmentWikiStatus } from '../src/AttachmentWikiButton'
import { ATTACHMENT_WIKI_LABELS } from '../src/strings-attachment-wiki'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  resetAttachmentWikiStatus()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const api = (enabled = true, result: object = { path: 'C:/a.pdf', status: 'added' }) => ({
  status: vi.fn(async () => ({ enabled })),
  addMaterial: vi.fn(async () => [result]),
})
const render = async (props: object) => {
  await act(async () =>
    root.render(
      createElement(AttachmentWikiButton, {
        path: 'C:/a.pdf',
        name: 'a.pdf',
        lang: 'ko',
        ...props,
      } as never),
    ),
  )
}
const button = () => host.querySelector<HTMLButtonElement>('.ai-attachment-wiki-btn')

it('renders nothing without the api, when the wiki is off, or for a format the wiki does not take', async () => {
  await render({ api: undefined })
  expect(button()).toBeNull()
  await render({ api: api(false) })
  expect(button()).toBeNull()
  resetAttachmentWikiStatus()
  await render({ api: api(true), name: 'photo.png', path: 'C:/photo.png' })
  expect(button()).toBeNull()
})

it('adds once and shows the added state; a second click sends nothing', async () => {
  const a = api()
  const onResult = vi.fn()
  await render({ api: a, onResult })
  expect(button()!.dataset.state).toBe('idle')
  expect(button()!.getAttribute('aria-label')).toBe(ATTACHMENT_WIKI_LABELS.ko.add)
  await act(async () => button()!.click())
  await act(async () => button()!.click())
  expect(a.addMaterial).toHaveBeenCalledTimes(1)
  expect(a.addMaterial).toHaveBeenCalledWith(['C:/a.pdf'])
  expect(button()!.dataset.state).toBe('added')
  expect(onResult).toHaveBeenCalledWith({ path: 'C:/a.pdf', status: 'added' }, undefined)
})

it('shows a duplicate as already added', async () => {
  await render({ api: api(true, { path: 'C:/a.pdf', status: 'duplicate' }) })
  await act(async () => button()!.click())
  expect(button()!.dataset.state).toBe('duplicate')
  expect(button()!.getAttribute('aria-label')).toBe(ATTACHMENT_WIKI_LABELS.ko.duplicate)
})

it('fails with the reason, reports it, and retries on the next click', async () => {
  const a = api(true, { path: 'C:/a.pdf', status: 'skipped', reason: 'wiki-off' })
  const onResult = vi.fn()
  await render({ api: a, onResult })
  await act(async () => button()!.click())
  expect(button()!.dataset.state).toBe('failed')
  expect(button()!.getAttribute('aria-label')).toContain(
    ATTACHMENT_WIKI_LABELS.ko.reasons['wiki-off'],
  )
  expect(onResult.mock.calls[0]![1]).toContain(ATTACHMENT_WIKI_LABELS.ko.reasons['wiki-off'])
  a.addMaterial.mockResolvedValueOnce([{ path: 'C:/a.pdf', status: 'added' }])
  await act(async () => button()!.click())
  expect(button()!.dataset.state).toBe('added')
})

it('a rejected request is a failure, not a crash', async () => {
  const a = api()
  a.addMaterial.mockRejectedValueOnce(new Error('ipc down'))
  await render({ api: a })
  await act(async () => button()!.click())
  expect(button()!.dataset.state).toBe('failed')
})

it('has every label in all 21 languages', () => {
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
  for (const lang of langs) {
    const l = ATTACHMENT_WIKI_LABELS[lang as keyof typeof ATTACHMENT_WIKI_LABELS]
    for (const key of ['add', 'adding', 'added', 'duplicate', 'failed'] as const)
      expect(l[key], `${lang}.${key}`).toBeTruthy()
    for (const r of [
      'unsupported',
      'too-large',
      'no-text',
      'unreadable',
      'too-many',
      'wiki-off',
      'not-attached',
    ] as const)
      expect(l.reasons[r], `${lang}.${r}`).toBeTruthy()
  }
})
