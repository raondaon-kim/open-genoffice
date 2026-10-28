import { describe, expect, it } from 'vitest'
import { detectSensitive, maskText, PLACEHOLDER } from '../src/rules'

/** a business registration number with a valid check digit, from its first nine digits */
function bizno(first9: string): string {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  const d = first9.split('').map(Number)
  let sum = d.reduce((s, x, i) => s + x * w[i], 0)
  sum += Math.floor((d[8] * 5) / 10)
  const check = (10 - (sum % 10)) % 10
  const all = first9 + check
  return `${all.slice(0, 3)}-${all.slice(3, 5)}-${all.slice(5)}`
}

/** a corporate registration number with a valid check digit, from its first twelve digits */
function corpno(first12: string): string {
  const d = first12.split('').map(Number)
  const sum = d.reduce((s, x, i) => s + x * (i % 2 === 0 ? 1 : 2), 0)
  const check = (10 - (sum % 10)) % 10
  const all = first12 + check
  return `${all.slice(0, 6)}-${all.slice(6)}`
}

describe('placeholders', () => {
  it('are the agreed Korean labels', () => {
    expect(PLACEHOLDER).toEqual({
      rrn: '[주민번호]',
      phone: '[전화번호]',
      email: '[이메일]',
      bizno: '[사업자번호]',
      corpno: '[법인번호]',
      account: '[계좌번호]',
      card: '[카드번호]',
    })
  })
})

describe('masked', () => {
  const VALID_BIZ = bizno('123456789')
  // 110171: month 01, day 71 is not a date, so this cannot be a resident number
  const VALID_CORP = corpno('110171012345')
  it.each([
    ['주민번호 900101-1234567', '주민번호 [주민번호]'],
    ['9001011234567', '[주민번호]'],
    ['외국인 900101-5234567', '외국인 [주민번호]'],
    ['2021년 이후 발급 040315-3987654', '2021년 이후 발급 [주민번호]'],
    ['010-1234-5678', '[전화번호]'],
    ['01012345678', '[전화번호]'],
    ['010 1234 5678', '[전화번호]'],
    ['+82 10-1234-5678', '[전화번호]'],
    ['02-123-4567', '[전화번호]'],
    ['031-1234-5678', '[전화번호]'],
    ['070-1234-5678', '[전화번호]'],
    ['1588-1234', '[전화번호]'],
    ['(02) 123-4567', '[전화번호]'],
    ['팩스: 02-123-4568', '팩스: [전화번호]'],
    ['hong@ubion.co.kr로', '[이메일]로'],
    [`사업자등록번호 ${VALID_BIZ}`, '사업자등록번호 [사업자번호]'],
    [`법인등록번호 ${VALID_CORP}`, '법인등록번호 [법인번호]'],
    ['계좌: 국민 123456-01-234567', '계좌: 국민 [계좌번호]'],
    ['예금주 홍길동 110-123-456789', '예금주 홍길동 [계좌번호]'],
    ['123-456789-01-012', '[계좌번호]'],
    ['4111-1111-1111-1111', '[카드번호]'],
  ])('%s', (input, expected) => {
    expect(maskText(input).text).toBe(expected)
  })

  it('a checksum-invalid business-number shape is not a business number', () => {
    const valid = bizno('123456789')
    const last = Number(valid.at(-1))
    const invalid = valid.slice(0, -1) + String((last + 1) % 10)
    expect(maskText(invalid).text).not.toContain('[사업자번호]')
  })
})

describe('left alone', () => {
  it.each([
    '2026-10-28',
    '2026.10.28',
    '1,250,000원',
    '1250만 원',
    '10:30',
    '3.5%',
    'p. 12',
    '2026년',
    '제12조 제3항',
    'v1.2.3',
    '제2026-0123호',
    '서울시 강남구 테헤란로 123',
    '홍길동',
    '010',
    '2026-10-28 ~ 2026-11-30',
  ])('%s', (input) => {
    expect(maskText(input).text).toBe(input)
  })
})

describe('detectSensitive', () => {
  it('returns matches in order with their rules', () => {
    const text = 'a 010-1234-5678 b hong@x.kr'
    const found = detectSensitive(text)
    expect(found.map((m) => m.rule)).toEqual(['phone', 'email'])
    expect(text.slice(found[0].start, found[0].end)).toBe('010-1234-5678')
    expect(text.slice(found[1].start, found[1].end)).toBe('hong@x.kr')
  })

  it('counts what it masked', () => {
    expect(maskText('a 010-1234-5678 b hong@x.kr').counts).toEqual({ phone: 1, email: 1 })
  })

  it('does not match inside a longer digit run', () => {
    expect(maskText('12345678901234567890').text).toBe('12345678901234567890')
  })
})
