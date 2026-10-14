import { describe, expect, it } from 'vitest'
import { maskSensitive } from '../src/node/mask'

describe('maskSensitive', () => {
  it('masks resident registration, card and account numbers', () => {
    const out = maskSensitive('주민 900101-1234567, 카드 1234-5678-9012-3456, 계좌 110-123-456789')
    expect(out).not.toMatch(/1234567|9012-3456|456789/)
    expect(out).toContain('******-*******')
  })

  it('keeps dates, amounts and project numbers', () => {
    const text = '2026-10-14, 3,000,000원, R25BK01238511, 02-1234-5678'
    expect(maskSensitive(text)).toBe(text)
  })
})
