import gajungtongsinmunMd from './gajungtongsinmun.md?raw'

export interface HwpTemplate {
  id: string
  name: string
  category: string
  description: string
  keywords: string[]
  fileName: string
  /** Markdown source used by the HwpForge generator (tables become real Hangul tables) */
  source: string
}

/**
 * Built-in Hangul document templates for Korean K-12 school work.
 *
 * Sources are plain Markdown with {자리표시자} tokens the teacher replaces after
 * creation (school name, dates, ...). Expanding the pack = adding one .md here
 * plus a manifest row.
 */
export const HWP_TEMPLATES: HwpTemplate[] = [
  {
    id: 'gajungtongsinmun-fieldtrip',
    name: '가정통신문 (현장체험학습 안내)',
    category: '학급·담임 운영',
    description: '현장체험학습 일정·준비물·참가 신청 안내 가정통신문',
    keywords: ['가정통신문', '체험학습', '현장체험학습', '안내장', '학부모', '참가신청'],
    fileName: '가정통신문_현장체험학습',
    source: gajungtongsinmunMd,
  },
]
