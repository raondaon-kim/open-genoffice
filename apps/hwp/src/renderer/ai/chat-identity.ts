import type { AiConversationIdentity } from '../../shared/ipc'

/**
 * An untitled tab (blank or a form copy) keeps its conversation under an
 * "unsaved-…" chat. When its first Save As gives it a path, that conversation
 * moves to the file (project:rebindChat) instead of being replaced by the
 * file's — empty — history.
 */
export function shouldRebindChat(
  current: AiConversationIdentity | null,
  filePath: string | null,
): boolean {
  return Boolean(current && filePath && current.chatId.startsWith('unsaved-'))
}
