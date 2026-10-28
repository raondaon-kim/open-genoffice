import type { Lang } from '@genoffice/i18n'

export interface ReportLabels {
  title: string
  wikiWaiting: string
  reading: string
  planning: string
  chapter: (v: { no: number; of: number; title: string }) => string
  summary: string
  done: string
  cancelled: string
  error: string
  cancel: string
}

const ko: ReportLabels = {
  title: '문서 쓰기',
  wikiWaiting: '업무 위키 준비 중…',
  reading: '첨부 읽기',
  planning: '목차 만들기',
  chapter: ({ no, of, title }) => `${no}/${of}장 · ${title}`,
  summary: '요약과 확인 필요 사항',
  done: '다 썼습니다',
  cancelled: '취소했습니다. 이미 쓴 장은 남아 있습니다.',
  error: '쓰지 못했습니다',
  cancel: '취소',
}

const en: ReportLabels = {
  title: 'Writing the document',
  wikiWaiting: 'Waiting for the work wiki…',
  reading: 'Reading attachments',
  planning: 'Planning the outline',
  chapter: ({ no, of, title }) => `Chapter ${no}/${of} · ${title}`,
  summary: 'Summary and open items',
  done: 'Done',
  cancelled: 'Cancelled. Chapters already written stay.',
  error: 'Could not write the document',
  cancel: 'Cancel',
}

/** Korean and English; other languages fall back to English */
export const REPORT_LABELS: Partial<Record<Lang, ReportLabels>> = { ko, en }
export const reportLabels = (lang: Lang): ReportLabels => REPORT_LABELS[lang] ?? en
