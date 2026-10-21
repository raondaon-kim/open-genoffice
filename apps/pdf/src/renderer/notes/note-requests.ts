// From IeumOffice (pblsketch/openoffice) apps/pdf/src/renderer/notes/note-requests.ts, 6c33de7a,
// without the passage-card and overview requests this app does not have.
/**
 * What "Add to note" sends for each kind of item: text parts only. The main
 * process knows the view's PDF and its note and builds the inserted Markdown
 * (quote with the page link, then the body). Pages are the PDF file's own: an
 * original page index + 1,
 * which is where `#page=N` lands in any viewer.
 */
import type { PdfNoteInsertRequest, PdfNoteResult } from '../../shared/ipc'
import type { AnnotItem } from '../annot-panel/items'
import type { TFunc } from '../i18n/locale'

const withTitle = (title: string | undefined) => (title?.trim() ? { title: title.trim() } : {})

const MARKUPS = new Set(['highlight', 'underline', 'strikeout'])

/** an annotation panel item; null for items that cannot go to the note (no page, drawings, stamps) */
export function annotNoteRequest(item: AnnotItem, title?: string): PdfNoteInsertRequest | null {
  if (item.page === null || item.notFound) return null
  const page = item.page + 1
  if (MARKUPS.has(item.kind)) {
    return { kind: 'quote', excerpt: item.text, page, ...withTitle(title) }
  }
  if (item.kind === 'note') {
    const memo = [item.memo ?? item.text, ...(item.replyTexts ?? [])]
      .map((text) => text.trim())
      .filter(Boolean)
      .join('\n\n')
    return { kind: 'quote', excerpt: '', page, body: memo, ...withTitle(title) }
  }
  return null
}

/** the notice after a note call; null when nothing needs saying (a cancelled dialog, a second click) */
export function noteResultNotice(
  result: PdfNoteResult,
  t: TFunc,
  action: 'open' | 'insert',
): string | null {
  if (result.ok) return action === 'insert' ? t('ntInserted') : null
  switch (result.reason) {
    case 'unsaved':
      return t('ntSaveFirst')
    case 'unavailable':
      return t('ntUnavailable')
    case 'cancelled':
    case 'busy':
      return null
    default:
      return t('ntFailed', { reason: result.message ?? '' }).trim()
  }
}
