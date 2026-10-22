import type { Attachment } from './types'

const READ_CHUNK_CHARS = 24000
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export interface AttachmentRef {
  path: string
  name: string
  ext: string
}

export type AttachmentReader = (
  path: string,
  offset: number,
  maxChars: number,
) => Promise<{ ok: boolean; text?: string; totalChars?: number; error?: string }>

/**
 * Every text attachment read in full through the app's paged reader (images are skipped: they
 * are not text material). A file that cannot be read throws, naming it: attachments are
 * mandatory material, so the run must not go on without one.
 */
export async function readAllAttachments(
  list: AttachmentRef[],
  read: AttachmentReader,
): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const a of list) {
    if (IMAGE_EXTS.has(a.ext.toLowerCase())) continue
    let text = ''
    for (let offset = 0; ;) {
      const r = await read(a.path, offset, READ_CHUNK_CHARS)
      if (!r.ok)
        throw new Error(`첨부를 읽을 수 없습니다: ${a.name} (${r.error ?? 'unknown error'})`)
      const piece = r.text ?? ''
      text += piece
      offset += piece.length
      if (piece.length === 0 || offset >= (r.totalChars ?? 0)) break
    }
    out.push({ name: a.name, text })
  }
  return out
}
