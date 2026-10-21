import type { Lang } from '@genoffice/i18n'

/**
 * The first time a saved document is copied into the wiki, the person is
 * told once, as an OS notification, that whole saved documents are copied
 * and where to switch it off.
 */
const TEXT = {
  ko: {
    title: '저장한 문서가 업무 위키에 들어갑니다',
    body: '저장한 문서는 원본 그대로 업무 위키 폴더(raw/sources/genoffice-saved)에 복사되어 위키가 배웁니다. 설정 › 업무 위키에서 끌 수 있습니다.',
  },
  zh: {
    title: '保存的文档会进入工作维基',
    body: '保存的文档会按原样复制到工作维基文件夹（raw/sources/genoffice-saved），供维基学习。可在 设置 › 工作维基 中关闭。',
  },
  en: {
    title: 'Saved documents go into the work wiki',
    body: 'Saved documents are copied as they are into the work wiki folder (raw/sources/genoffice-saved) for the wiki to learn. You can switch this off in Settings › Work wiki.',
  },
} as const

export function mirrorNoticeText(lang: Lang | string): { title: string; body: string } {
  if (lang === 'ko') return TEXT.ko
  if (lang === 'zh' || lang === 'zh-TW') return TEXT.zh
  return TEXT.en
}

/**
 * Show the notice unless it was shown before. The flag is set before
 * notifying, so a failing notification is not retried on every save.
 * Returns whether the notification was shown.
 */
export function showMirrorNoticeOnce(o: {
  shown: () => boolean
  markShown: () => void
  notify: (title: string, body: string) => void
  lang: Lang | string
}): boolean {
  if (o.shown()) return false
  o.markShown()
  const { title, body } = mirrorNoticeText(o.lang)
  try {
    o.notify(title, body)
    return true
  } catch {
    return false
  }
}
