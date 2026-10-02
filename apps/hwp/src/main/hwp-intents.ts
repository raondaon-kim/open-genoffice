import type { HwpOpenIntent } from '../shared/ipc'

export interface HwpFormIntent {
  /** the form's file name (no directory) — the tab never learns the form's path */
  fileName: string
  data: ArrayBuffer
}

/**
 * What each hwp view should open, queued at tab creation and consumed once by
 * the renderer after mount (avoids did-finish-load races). A form copy wins
 * over a blank flag or a path queued for the same view.
 */
export class HwpIntentStore {
  private readonly paths = new Map<number, string>()
  private readonly blanks = new Set<number>()
  private readonly forms = new Map<number, HwpFormIntent>()

  queuePath(id: number, path: string): void {
    this.paths.set(id, path)
  }

  markBlank(id: number): void {
    this.blanks.add(id)
  }

  queueForm(id: number, form: HwpFormIntent): void {
    this.forms.set(id, { fileName: form.fileName, data: form.data })
  }

  consume(id: number): HwpOpenIntent | null {
    const form = this.forms.get(id)
    const blank = this.blanks.has(id)
    const path = this.paths.get(id)
    this.forget(id)
    if (form) return { mode: 'form', fileName: form.fileName, data: form.data }
    if (blank) return { mode: 'blank' }
    return path ? { mode: 'open', path } : null
  }

  forget(id: number): void {
    this.paths.delete(id)
    this.blanks.delete(id)
    this.forms.delete(id)
  }
}
