/**
 * Selection-bar shortcuts (from IeumOffice apps/pdf/tests/reading-shortcuts.test.ts, 20f27eb5):
 * each key, the same physical key under a Korean input method, and the cases that must be
 * left alone (composing, focus in a field, a modifier, a document that cannot be edited).
 */
import { describe, expect, it } from 'vitest'
import { createI18n } from '@genoffice/i18n'
import { strings } from '../src/renderer/i18n/strings'
import {
  labelWithKey,
  selectionBarKey,
  selectionEnd,
  type SelectionBarKeyEvent,
} from '../src/renderer/selection-shortcuts'

const key = (code: string, over: Partial<SelectionBarKeyEvent> = {}): SelectionBarKeyEvent => ({
  code,
  key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  target: document.body,
  ...over,
})

const editable = { visible: true, readOnly: false }

describe('selection-bar shortcuts', () => {
  it.each([
    ['KeyH', 'highlight'],
    ['KeyU', 'underline'],
    ['KeyS', 'strikeout'],
    ['KeyN', 'note'],
  ])('%s runs %s', (code, action) => {
    expect(selectionBarKey(key(code), editable)).toEqual({ action })
  })

  it('judges by the physical key: a Korean input method gives the same actions', () => {
    // with the 2-set Korean layout active, KeyH types ㅗ, KeyN ㅜ
    expect(selectionBarKey(key('KeyH', { key: 'ㅗ' }), editable)).toEqual({ action: 'highlight' })
    expect(selectionBarKey(key('KeyN', { key: 'ㅜ' }), editable)).toEqual({ action: 'note' })
  })

  it('leaves other keys alone, including the reading-assistant keys this app does not have', () => {
    for (const code of ['KeyA', 'KeyE', 'KeyT', 'Enter', 'NumpadEnter', 'Space', 'Escape']) {
      expect(selectionBarKey(key(code), editable)).toBeNull()
    }
  })

  it('does nothing while the bar is hidden', () => {
    expect(selectionBarKey(key('KeyH'), { visible: false, readOnly: false })).toBeNull()
  })

  it('ignores a key while an input method is composing', () => {
    expect(selectionBarKey(key('KeyH', { isComposing: true }), editable)).toBeNull()
    expect(selectionBarKey(key('KeyH', { key: 'Process' }), editable)).toBeNull()
  })

  it('ignores Ctrl, Alt and Meta combinations and held-down repeats', () => {
    expect(selectionBarKey(key('KeyS', { ctrlKey: true }), editable)).toBeNull()
    expect(selectionBarKey(key('KeyH', { altKey: true }), editable)).toBeNull()
    expect(selectionBarKey(key('KeyU', { metaKey: true }), editable)).toBeNull()
    expect(selectionBarKey(key('KeyH', { repeat: true }), editable)).toBeNull()
  })

  it('ignores keys typed into an input, a textarea or an editable region', () => {
    // the note draft card, the AI composer, the search box and form fields are these
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const select = document.createElement('select')
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    host.appendChild(inner)
    for (const target of [input, area, select, host, inner]) {
      for (const code of ['KeyH', 'KeyU', 'KeyS', 'KeyN']) {
        expect(selectionBarKey(key(code, { target }), editable)).toBeNull()
      }
    }
  })

  it('still reaches the bar while a plain button has focus', () => {
    const button = document.createElement('button')
    expect(selectionBarKey(key('KeyU', { target: button }), editable)).toEqual({
      action: 'underline',
    })
  })

  it('refuses every action on a document that cannot be edited', () => {
    const ro = { visible: true, readOnly: true }
    for (const [code, action] of [
      ['KeyH', 'highlight'],
      ['KeyU', 'underline'],
      ['KeyS', 'strikeout'],
      ['KeyN', 'note'],
    ] as const) {
      expect(selectionBarKey(key(code), ro)).toEqual({ blocked: action, reason: 'read-only' })
    }
  })

  it('puts the memo of a selection at the top right of its last line, on its last page', () => {
    // quads are PDF user space corner lists; any corner order
    const quads = new Map<number, number[][]>([
      [2, [[10, 700, 200, 700, 10, 688, 200, 688]]],
      [
        3,
        [
          [10, 500, 300, 500, 10, 488, 300, 488],
          [180, 476, 20, 476, 180, 464, 20, 464],
        ],
      ],
    ])
    expect(selectionEnd(quads)).toEqual({ origIdx: 3, at: [180, 476] })
  })

  it('has no memo place without a selection', () => {
    expect(selectionEnd(new Map())).toBeNull()
    expect(selectionEnd(new Map([[0, []]]))).toBeNull()
  })

  it('names the key in tooltips and accessible names', () => {
    const translate = createI18n(strings)
    const ko = (k: 'selWithKey', p: { label: string; key: string }) => translate('ko', k, p)
    const en = (k: 'selWithKey', p: { label: string; key: string }) => translate('en', k, p)
    expect(labelWithKey(ko, strings.ko.highlight, 'highlight')).toBe(`${strings.ko.highlight} (H)`)
    expect(labelWithKey(en, 'Note', 'note')).toBe('Note (N)')
  })
})
