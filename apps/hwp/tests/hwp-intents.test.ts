import { describe, expect, it } from 'vitest'
import { HwpIntentStore } from '../src/main/hwp-intents'

const bytes = (...values: number[]) => new Uint8Array(values).buffer

describe('HwpIntentStore', () => {
  it('hands out a queued path once', () => {
    const store = new HwpIntentStore()
    store.queuePath(1, 'C:/docs/a.hwpx')
    expect(store.consume(1)).toEqual({ mode: 'open', path: 'C:/docs/a.hwpx' })
    expect(store.consume(1)).toBeNull()
  })

  it('hands out a blank document once', () => {
    const store = new HwpIntentStore()
    store.markBlank(2)
    expect(store.consume(2)).toEqual({ mode: 'blank' })
    expect(store.consume(2)).toBeNull()
  })

  it('hands out a form copy with its bytes and name but never a path', () => {
    const store = new HwpIntentStore()
    store.queueForm(3, { fileName: '결재문서본문.hwpx', data: bytes(1, 2, 3) })
    const intent = store.consume(3)
    expect(intent).toMatchObject({ mode: 'form', fileName: '결재문서본문.hwpx' })
    expect(intent).not.toHaveProperty('path')
    expect(Array.from(new Uint8Array((intent as { data: ArrayBuffer }).data))).toEqual([1, 2, 3])
    expect(store.consume(3)).toBeNull()
  })

  it('a form wins over anything else queued for the same view, and forget clears all', () => {
    const store = new HwpIntentStore()
    store.markBlank(4)
    store.queueForm(4, { fileName: 'f.hwp', data: bytes(9) })
    expect(store.consume(4)).toMatchObject({ mode: 'form' })
    store.queuePath(5, 'C:/x.hwp')
    store.markBlank(5)
    store.queueForm(5, { fileName: 'g.hwp', data: bytes(1) })
    store.forget(5)
    expect(store.consume(5)).toBeNull()
  })
})
