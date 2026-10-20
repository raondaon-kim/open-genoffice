// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('@genoffice/ui', () => ({
  AttachmentWikiButton: ({ name }: { name: string }) =>
    React.createElement('i', { 'data-wiki': name }),
}))
import { AttachmentCard } from '../src/renderer/ai/AttachmentCard'

it('renders the shared card: type icon, name, size, wiki button and remove badge', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  const root = createRoot(host)
  const onRemove = vi.fn()
  await act(async () =>
    root.render(
      React.createElement(AttachmentCard, {
        attachment: {
          path: 'C:/a/제안요청서.hwp',
          name: '제안요청서.hwp',
          ext: 'hwp',
          sizeBytes: 2048,
        },
        lang: 'ko',
        removeLabel: '첨부 제거',
        disabled: false,
        onRemove,
        onFailure: () => {},
      }),
    ),
  )
  const card = host.querySelector('.ai-attachment-card')!
  expect(card.querySelector('.ai-attachment-card-icon img')).not.toBeNull()
  expect(card.querySelector('.ai-attachment-card-name')!.textContent).toBe('제안요청서.hwp')
  expect(card.querySelector('.ai-attachment-card-size')!.textContent).toBe('2.00 KB')
  expect(card.querySelector('[data-wiki="제안요청서.hwp"]')).not.toBeNull()
  const remove = card.querySelector<HTMLButtonElement>('.ai-attachment-thumb-remove')!
  expect(remove.getAttribute('data-tip')).toBe('첨부 제거')
  await act(async () => remove.click())
  expect(onRemove).toHaveBeenCalledWith('C:/a/제안요청서.hwp')
  act(() => root.unmount())
})
