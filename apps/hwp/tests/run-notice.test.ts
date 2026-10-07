import { describe, expect, it } from 'vitest'
import { HWP_MAX_TURNS } from '../src/renderer/ai/hwp-skill'
import { persistedRunText, runEndText } from '../src/renderer/ai/run-notice'
import type { RunEnd } from '../src/renderer/ai/run-notice'

const end = (over: Partial<RunEnd> = {}): RunEnd => ({
  text: '',
  cancelled: false,
  turnLimit: false,
  mutations: 0,
  ...over,
})

describe('run end text', () => {
  it('allows 20 turns', () => {
    expect(HWP_MAX_TURNS).toBe(20)
  })

  it('keeps the model text when there is one', () => {
    expect(runEndText(end({ text: '채웠습니다.' }), 'ko')).toBe('채웠습니다.')
  })

  it('explains a turn-limit stop with the number of applied edits and how to continue', () => {
    const ko = runEndText(end({ text: '진행 중', turnLimit: true, mutations: 3 }), 'ko')
    expect(ko).toMatch(/^진행 중\n\n/)
    expect(ko).toMatch(/3건/)
    expect(ko).toMatch(/'계속'/)
    expect(runEndText(end({ turnLimit: true, mutations: 1 }), 'en')).toMatch(
      /1 edit\(s\).*"continue"/,
    )
  })

  it('replaces "No reply." with what happened', () => {
    expect(runEndText(end({ mutations: 2 }), 'ko')).toMatch(/설명 없이.*2건.*AI 편집 되돌리기/)
    expect(runEndText(end({ mutations: 2 }), 'en')).toMatch(/2 edit\(s\).*Undo AI edit/)
    expect(runEndText(end({ mutations: 0 }), 'ko')).toMatch(/답 없이/)
    expect(runEndText(end({ mutations: 0 }), 'en')).toMatch(/without an answer/)
    expect(runEndText(end({ mutations: 0 }), 'en')).not.toMatch(/No reply/)
  })

  it('a stop shows the partial text or "Stopped."', () => {
    expect(runEndText(end({ cancelled: true }), 'en')).toBe('Stopped.')
    expect(runEndText(end({ cancelled: true }), 'ko')).toBe('중지했습니다.')
    expect(runEndText(end({ cancelled: true, text: '부분' }), 'ko')).toBe('부분')
  })
})

describe('persistedRunText', () => {
  it('saves what the model wrote', () => {
    expect(persistedRunText(end({ text: '완료' }), '완료', 0)).toBe('완료')
  })

  it('saves a run that used tools even without model text, with the notice', () => {
    expect(persistedRunText(end({ turnLimit: true, mutations: 2 }), 'NOTE', 5)).toBe('NOTE')
  })

  it('does not save a stopped run or an empty run without tools', () => {
    expect(persistedRunText(end({ cancelled: true, text: '부분' }), '부분', 3)).toBeNull()
    expect(persistedRunText(end(), 'NOTE', 0)).toBeNull()
  })
})
