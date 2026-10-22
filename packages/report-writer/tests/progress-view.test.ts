import { describe, expect, it } from 'vitest'
import { deriveReportProgressView } from '../src/progress-view'

describe('deriveReportProgressView', () => {
  it('shows one row per chapter with its state while the run goes on', () => {
    const v = deriveReportProgressView([
      { kind: 'reading' },
      { kind: 'planning' },
      { kind: 'chapter', no: 1, of: 3, title: '원칙' },
      { kind: 'chapter', no: 2, of: 3, title: '규제' },
    ])
    expect(v.steps.map((s) => [s.label, s.state])).toEqual([
      ['report.reading', 'done'],
      ['report.planning', 'done'],
      ['report.chapter', 'done'],
      ['report.chapter', 'running'],
    ])
    expect(v.steps[3]!.vars).toEqual({ no: 2, of: 3, title: '규제' })
    expect(v.finished).toBe(false)
  })

  it('marks a failed chapter and finishes with done', () => {
    const v = deriveReportProgressView([
      { kind: 'planning' },
      { kind: 'chapter', no: 1, of: 2, title: 'a' },
      { kind: 'chapter-failed', no: 1, title: 'a', error: 'x' },
      { kind: 'chapter', no: 2, of: 2, title: 'b' },
      { kind: 'summary' },
      { kind: 'done', written: 1, failed: [1] },
    ])
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'failed', 'done', 'done'])
    expect(v).toMatchObject({ finished: true, outcome: 'done' })
  })

  it('a cancel or an error stops the running step', () => {
    const c = deriveReportProgressView([
      { kind: 'planning' },
      { kind: 'chapter', no: 1, of: 2, title: 'a' },
      { kind: 'cancelled', written: 0 },
    ])
    expect(c.steps.at(-1)!.state).toBe('failed')
    expect(c).toMatchObject({ finished: true, outcome: 'cancelled' })
    const e = deriveReportProgressView([{ kind: 'planning' }, { kind: 'error', error: 'boom' }])
    expect(e).toMatchObject({ finished: true, outcome: 'error', error: 'boom' })
  })
})
