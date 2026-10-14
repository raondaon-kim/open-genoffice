/**
 * Patterns masked before anything is written to the wiki: resident registration numbers,
 * card numbers, and bank account numbers (only after the word 계좌/account, so phone numbers,
 * dates and project numbers stay).
 */
const RULES: Array<[RegExp, string]> = [
  [/\b\d{6}-[1-4]\d{6}\b/g, '******-*******'],
  [/\b\d{4}-\d{4}-\d{4}-\d{4}\b/g, '****-****-****-****'],
  [/(계좌|account)[^\d\n]{0,10}[\d-]{10,20}/gi, '$1 [가림]'],
]

export function maskSensitive(text: string): string {
  return RULES.reduce((out, [re, rep]) => out.replace(re, rep), text)
}
