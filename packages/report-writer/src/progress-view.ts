import type { ReportProgress } from './types'

export type ReportStepState = 'done' | 'running' | 'failed' | 'waiting'

export interface ReportProgressView {
  /** label is an i18n key; vars fill it */
  steps: Array<{ label: string; vars?: Record<string, unknown>; state: ReportStepState }>
  finished: boolean
  outcome?: 'done' | 'cancelled' | 'error'
  error?: string
}

/** the progress card's rows from the events so far: one row per stage and per chapter */
export function deriveReportProgressView(events: ReportProgress[]): ReportProgressView {
  const view: ReportProgressView = { steps: [], finished: false }
  const settleRunning = (state: ReportStepState) => {
    for (const s of view.steps) if (s.state === 'running') s.state = state
  }
  const start = (label: string, vars?: Record<string, unknown>) => {
    settleRunning('done')
    view.steps.push({ label, ...(vars ? { vars } : {}), state: 'running' })
  }
  for (const e of events) {
    switch (e.kind) {
      case 'reading':
        start('report.reading')
        break
      case 'planning':
        start('report.planning')
        break
      case 'chapter':
        start('report.chapter', { no: e.no, of: e.of, title: e.title })
        break
      case 'chapter-failed': {
        const row = view.steps.find(
          (s) => s.label === 'report.chapter' && s.vars?.no === e.no && s.state === 'running',
        )
        if (row) row.state = 'failed'
        break
      }
      case 'summary':
        start('report.summary')
        break
      case 'done':
        settleRunning('done')
        view.finished = true
        view.outcome = 'done'
        break
      case 'cancelled':
        settleRunning('failed')
        view.finished = true
        view.outcome = 'cancelled'
        break
      case 'error':
        settleRunning('failed')
        view.finished = true
        view.outcome = 'error'
        view.error = e.error
        break
    }
  }
  return view
}
