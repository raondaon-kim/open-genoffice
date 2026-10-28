/**
 * Detection of personal and company identification numbers in plain text.
 *
 * Deterministic rules only (no AI): resident/foreigner registration numbers, phone and fax
 * numbers, e-mail addresses, business and corporate registration numbers, account and card
 * numbers. Names and addresses are deliberately left alone. Dates, amounts, times, versions and
 * article numbers must never match. When a digit group could be an account number or something
 * else, it is treated as an account number: an over-masked document number costs a template
 * little, a leaked account costs a lot.
 */

export type RuleId = 'rrn' | 'phone' | 'email' | 'bizno' | 'corpno' | 'account' | 'card'

export type Counts = Partial<Record<RuleId, number>>

export const PLACEHOLDER: Record<RuleId, string> = {
  rrn: '[주민번호]',
  phone: '[전화번호]',
  email: '[이메일]',
  bizno: '[사업자번호]',
  corpno: '[법인번호]',
  account: '[계좌번호]',
  card: '[카드번호]',
}

export interface SensitiveMatch {
  start: number
  end: number
  rule: RuleId
}

const digitsOf = (s: string): string => s.replace(/\D/g, '')

function isValidBirthDate(yymmdd: string): boolean {
  const mm = Number(yymmdd.slice(2, 4))
  const dd = Number(yymmdd.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1) return false
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1]
  return dd <= days
}

/** resident / foreigner registration number: a birth date and a 7th digit 1–8. Numbers issued
 *  since October 2020 have a random last digit, so no checksum is applied. */
function isRrn(digits: string): boolean {
  return digits.length === 13 && isValidBirthDate(digits.slice(0, 6)) && /[1-8]/.test(digits[6])
}

function isCorpNo(digits: string): boolean {
  if (digits.length !== 13 || isRrn(digits)) return false
  const d = digits.split('').map(Number)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += d[i] * (i % 2 === 0 ? 1 : 2)
  return (10 - (sum % 10)) % 10 === d[12]
}

function isBizNo(digits: string): boolean {
  if (digits.length !== 10) return false
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  const d = digits.split('').map(Number)
  let sum = 0
  for (let i = 0; i < 9; i++) sum += d[i] * w[i]
  sum += Math.floor((d[8] * 5) / 10)
  return (10 - (sum % 10)) % 10 === d[9]
}

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let x = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      x *= 2
      if (x > 9) x -= 9
    }
    sum += x
  }
  return sum % 10 === 0
}

/** a hyphen/dot-separated group that reads as a calendar date (2026-10-28, 26.10.28) */
function looksLikeDate(s: string): boolean {
  const parts = s.split(/[-./]/)
  if (parts.length !== 3) return false
  const [y, m, d] = parts.map(Number)
  const yearOk = (parts[0].length === 4 && y >= 1900 && y <= 2199) || parts[0].length === 2
  return yearOk && m >= 1 && m <= 12 && d >= 1 && d <= 31 && parts[1].length <= 2
}

const BANKS =
  '국민|신한|우리|하나|농협|기업|카카오뱅크|토스뱅크|새마을|우체국|수협|부산|대구|경남|광주|전북|제주|SC제일|씨티|케이뱅크|산업|신협'

interface Rule {
  id: RuleId
  find(text: string): Array<[number, number]>
}

function scan(
  re: RegExp,
  text: string,
  accept: (m: RegExpExecArray) => [number, number] | null,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(text)) !== null) {
    if (m[0].length === 0) {
      g.lastIndex++
      continue
    }
    const span = accept(m)
    if (span) out.push(span)
  }
  return out
}

const whole = (m: RegExpExecArray): [number, number] => [m.index, m.index + m[0].length]

const AREA = '(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70|50[2-8])'

/** in precedence order: an earlier rule wins an overlap */
const RULES: Rule[] = [
  {
    id: 'email',
    find: (t) =>
      scan(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, t, whole),
  },
  {
    id: 'rrn',
    find: (t) =>
      scan(/(?<!\d)\d{6}[- ]?\d{7}(?!\d)/, t, (m) => (isRrn(digitsOf(m[0])) ? whole(m) : null)),
  },
  {
    id: 'corpno',
    find: (t) =>
      scan(/(?<!\d)\d{6}-?\d{7}(?!\d)/, t, (m) => (isCorpNo(digitsOf(m[0])) ? whole(m) : null)),
  },
  {
    id: 'card',
    find: (t) =>
      scan(/(?<!\d)(?:\d{4}[- ]){3}\d{4}(?!\d)|(?<!\d)\d{16}(?!\d)/, t, (m) =>
        luhn(digitsOf(m[0])) ? whole(m) : null,
      ),
  },
  {
    id: 'bizno',
    find: (t) =>
      scan(/(?<![\d-])\d{3}-\d{2}-\d{5}(?![\d-])/, t, (m) =>
        isBizNo(digitsOf(m[0])) ? whole(m) : null,
      ),
  },
  {
    id: 'phone',
    find: (t) => [
      // mobile, optionally international
      ...scan(
        /(?:\+82[ -]?(?:\(0\))?|(?<!\d)0)1[016789][ .-]?\d{3,4}[ .-]?\d{4}(?!\d)/,
        t,
        whole,
      ),
      // landline / fax / internet phone, optionally international or with the area code in brackets
      ...scan(
        new RegExp(
          `(?:\\+82[ -]?${AREA}[ .-]?|\\(0${AREA}\\)[ ]?|(?<!\\d)0${AREA}[ .-]?)\\d{3,4}[ .-]?\\d{4}(?!\\d)`,
        ),
        t,
        whole,
      ),
      // nationwide representative numbers (1588-1234, 1600-…, 1899-…)
      ...scan(/(?<![\d-])1(?:5|6|8)\d{2}-\d{4}(?![\d-])/, t, whole),
    ],
  },
  {
    id: 'account',
    find: (t) => [
      // a long digit group shortly after an account word or a bank name
      ...scan(
        new RegExp(`(?:계좌|예금주|입금|은행|account|${BANKS})[^\\n\\d]{0,15}(\\d[\\d-]{8,22}\\d)`, 'i'),
        t,
        (m) => {
          const n = digitsOf(m[1]).length
          if (n < 10 || n > 16 || looksLikeDate(m[1])) return null
          const start = m.index + m[0].length - m[1].length
          return [start, start + m[1].length]
        },
      ),
      // three or four hyphenated groups totalling 10–16 digits, whatever surrounds them
      ...scan(/(?<![\d-])\d+(?:-\d+){2,3}(?![\d-])/, t, (m) => {
        const n = digitsOf(m[0]).length
        return n >= 10 && n <= 16 && !looksLikeDate(m[0]) ? whole(m) : null
      }),
    ],
  },
]

export function detectSensitive(text: string): SensitiveMatch[] {
  const taken: SensitiveMatch[] = []
  for (const rule of RULES) {
    for (const [start, end] of rule.find(text)) {
      if (taken.some((t) => start < t.end && end > t.start)) continue
      taken.push({ start, end, rule: rule.id })
    }
  }
  return taken.sort((a, b) => a.start - b.start)
}

export function maskText(text: string): { text: string; counts: Counts } {
  const found = detectSensitive(text)
  if (found.length === 0) return { text, counts: {} }
  const counts: Counts = {}
  let out = ''
  let cursor = 0
  for (const m of found) {
    out += text.slice(cursor, m.start) + PLACEHOLDER[m.rule]
    cursor = m.end
    counts[m.rule] = (counts[m.rule] ?? 0) + 1
  }
  return { text: out + text.slice(cursor), counts }
}
