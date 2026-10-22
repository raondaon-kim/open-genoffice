/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deriveReportProgressView } from '@genoffice/report-writer'
import { ReportProgressCard } from '../src/ReportProgressCard'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const render = (props: object) =>
  act(async () => root.render(createElement(ReportProgressCard, { lang: 'ko', ...props } as never)))

it('renders one row per step with its state and a cancel button while running', async () => {
  const onCancel = vi.fn()
  const view = deriveReportProgressView([
    { kind: 'reading' },
    { kind: 'planning' },
    { kind: 'chapter', no: 1, of: 3, title: '원칙' },
  ])
  await render({ view, onCancel })
  const rows = [...host.querySelectorAll('.ai-report-step')]
  expect(rows.map((r) => r.className)).toEqual([
    'ai-report-step is-done',
    'ai-report-step is-done',
    'ai-report-step is-running',
  ])
  expect(rows[2]!.textContent).toContain('1/3')
  expect(rows[2]!.textContent).toContain('원칙')
  const cancel = host.querySelector<HTMLButtonElement>('.ai-report-cancel')!
  act(() => cancel.click())
  expect(onCancel).toHaveBeenCalled()
})

it('shows the outcome and no cancel button when finished', async () => {
  const view = deriveReportProgressView([
    { kind: 'planning' },
    { kind: 'error', error: '목차를 만들지 못했습니다' },
  ])
  await render({ view, onCancel: () => undefined })
  expect(host.querySelector('.ai-report-cancel')).toBeNull()
  expect(host.textContent).toContain('목차를 만들지 못했습니다')
})

it('falls back to English for a language without strings', async () => {
  await render({ view: deriveReportProgressView([{ kind: 'planning' }]), lang: 'fr' })
  expect(host.textContent).toContain('Planning')
})
