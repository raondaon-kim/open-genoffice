// From IeumOffice (pblsketch/openoffice) apps/pdf/src/renderer/reading/shortcuts.ts, 20f27eb5.
import { quadToRect } from './annotations'

/**
 * Selection-bar shortcuts: while the markup bar over
 * a text selection is visible, one plain key runs one of its actions. Keys are
 * judged by `KeyboardEvent.code` (the physical key), so the same key works
 * with a Korean (or any other) input method active. Pure: the caller passes
 * the event and whether the bar is up and the document can be edited.
 */

export type SelectionBarAction = 'highlight' | 'underline' | 'strikeout' | 'note'

/** the physical key of each action and the key name shown in tooltips */
export const SELECTION_BAR_KEYS: Readonly<
  Record<SelectionBarAction, { codes: readonly string[]; label: string }>
> = {
  highlight: { codes: ['KeyH'], label: 'H' },
  underline: { codes: ['KeyU'], label: 'U' },
  strikeout: { codes: ['KeyS'], label: 'S' },
  note: { codes: ['KeyN'], label: 'N' },
}

const BY_CODE = new Map<string, SelectionBarAction>(
  (
    Object.entries(SELECTION_BAR_KEYS) as [SelectionBarAction, { codes: readonly string[] }][]
  ).flatMap(([action, { codes }]) => codes.map((code) => [code, action] as const)),
)

/** the fields of a keydown the judgement reads */
export interface SelectionBarKeyEvent {
  code: string
  key?: string
  isComposing?: boolean
  repeat?: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  target: EventTarget | null
}

export type SelectionBarKeyVerdict =
  | { action: SelectionBarAction }
  /** the key names a file edit on a document that cannot be edited */
  | { blocked: SelectionBarAction; reason: 'read-only' }

/** focus in a text field, a select or an editable region: keys belong to it */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null
  if (!el || typeof el !== 'object') return false
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return !!el.closest?.('[contenteditable]:not([contenteditable="false"])')
}

/**
 * What a keydown does while the selection bar may be visible; null when the
 * key is not a bar shortcut or must be left alone (bar hidden, an input method
 * composing, focus in an editable field, a modifier held, a held-down repeat).
 */
export function selectionBarKey(
  e: SelectionBarKeyEvent,
  /** blocked: a dialog is open or a redaction is being applied; the keys belong elsewhere */
  ctx: { visible: boolean; readOnly: boolean; blocked?: boolean },
): SelectionBarKeyVerdict | null {
  if (!ctx.visible || ctx.blocked) return null
  // an IME keydown during composition reports isComposing, or key 'Process' in Chromium
  if (e.isComposing || e.key === 'Process') return null
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  if (e.repeat) return null
  if (isEditableTarget(e.target)) return null
  const action = BY_CODE.get(e.code)
  if (!action) return null
  // every bar action changes the file: refused on a document that cannot be edited
  if (ctx.readOnly) return { blocked: action, reason: 'read-only' }
  return { action }
}

/** a tooltip or accessible name with its key, e.g. "Highlight (H)" */
export function labelWithKey(
  t: (key: 'selWithKey', params: { label: string; key: string }) => string,
  label: string,
  action: SelectionBarAction,
): string {
  return t('selWithKey', { label, key: SELECTION_BAR_KEYS[action].label })
}

/**
 * Where the memo of a selection goes (N on the bar): the top right of the selection's
 * last line on its last page, in PDF user space. Null without a selection.
 */
export function selectionEnd(
  quadsByPage: ReadonlyMap<number, number[][]>,
): { origIdx: number; at: [number, number] } | null {
  const pages = [...quadsByPage.keys()]
  const origIdx = pages[pages.length - 1]
  const quads = origIdx === undefined ? undefined : quadsByPage.get(origIdx)
  const last = quads?.[quads.length - 1]
  if (origIdx === undefined || !last) return null
  const [, , x2, y2] = quadToRect(last)
  return { origIdx, at: [x2, y2] }
}
