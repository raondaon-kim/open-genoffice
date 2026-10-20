// The status line after a save that did not land: a cancel (the Save As dialog closed,
// or the user kept the disk copy a sibling split-pane copy wrote) is quiet, a failure
// says why.
import { describe, expect, it } from 'vitest'
import { saveFailedStatus } from '../src/renderer/save-status'

describe('saveFailedStatus', () => {
  it('is empty for a canceled save', () => {
    expect(saveFailedStatus({ ok: false, canceled: true })).toBe('')
  })

  it('names the error of a failed save', () => {
    expect(saveFailedStatus({ ok: false, error: 'disk full' })).toBe('Save failed: disk full')
  })

  it('falls back when the error is missing', () => {
    expect(saveFailedStatus({ ok: false })).toBe('Save failed: unknown error')
  })
})
