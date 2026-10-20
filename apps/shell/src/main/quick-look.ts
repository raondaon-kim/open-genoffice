import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import * as CFB from 'cfb'
import JSZip from 'jszip'
import type { QuickLookPayload } from '../shared/home-api'
import { extractText as defaultExtractText } from './file-index/extract'

/**
 * Home's Quick Look (Space on a file row): what to show without opening a tab — the image file
 * itself, or the first-page thumbnail a document carries plus the start of its text.
 */

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_THUMB_BYTES = 2 * 1024 * 1024
/** documents are read whole for their thumbnail; past this only the text extractor looks at them */
const MAX_THUMB_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_TEXT_CHARS = 6000
const CACHE_SIZE = 20

const OOXML = new Set(['docx', 'xlsx', 'pptx'])
const OOXML_THUMBS = ['docProps/thumbnail.jpeg', 'docProps/thumbnail.jpg', 'docProps/thumbnail.png']

type Extract = typeof defaultExtractText

const cache = new Map<string, QuickLookPayload>()

export function clearQuickLookCache(): void {
  cache.clear()
}

/** png or jpeg by magic bytes; anything else is not shown */
function sniff(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  return null
}

function dataUrl(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0 || bytes.length > MAX_THUMB_BYTES) return undefined
  const mime = sniff(bytes)
  return mime ? `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` : undefined
}

async function zipEntry(bytes: Buffer, names: string[]): Promise<Uint8Array | undefined> {
  const zip = await JSZip.loadAsync(bytes)
  for (const name of names) {
    const file = zip.file(name)
    if (file) return file.async('uint8array')
  }
  return undefined
}

/** the preview image a document stores for itself (Office, hwpx, HWP5); never throws */
async function thumbnailOf(path: string, ext: string, size: number): Promise<string | undefined> {
  if (size > MAX_THUMB_SOURCE_BYTES) return undefined
  try {
    if (OOXML.has(ext)) {
      const bytes = await zipEntry(await readFile(path), OOXML_THUMBS)
      return bytes ? dataUrl(bytes) : undefined
    }
    if (ext === 'hwpx') {
      const bytes = await zipEntry(await readFile(path), ['Preview/PrvImage.png'])
      return bytes ? dataUrl(bytes) : undefined
    }
    if (ext === 'hwp') {
      const doc = CFB.read(await readFile(path), { type: 'buffer' })
      const entry = CFB.find(doc, 'PrvImage')
      return entry?.content
        ? dataUrl(Uint8Array.from(entry.content as ArrayLike<number>))
        : undefined
    }
  } catch {
    // a damaged or mislabeled file simply has no thumbnail
  }
  return undefined
}

/** drop page markers and runs of blank lines; keep the start */
function tidy(raw: string): { text: string; truncated: boolean } {
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .replace(/^\[page \d+\][ \t]*\n?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned.length > MAX_TEXT_CHARS
    ? { text: cleaned.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { text: cleaned, truncated: false }
}

async function build(
  path: string,
  ext: string,
  size: number,
  mtimeMs: number,
  extract: Extract,
): Promise<QuickLookPayload> {
  const base = { ok: true as const, path, name: basename(path), ext, sizeBytes: size, mtimeMs }
  const mime = IMAGE_MIME[ext]
  if (mime) {
    if (size > MAX_IMAGE_BYTES) return { ...base, truncated: false }
    const bytes = await readFile(path)
    return { ...base, image: `data:${mime};base64,${bytes.toString('base64')}`, truncated: false }
  }
  const [image, extracted] = await Promise.all([
    thumbnailOf(path, ext, size),
    extract(path).catch(() => ({ kind: 'error' as const, error: 'extract failed' })),
  ])
  const body = extracted.kind === 'text' && extracted.text.trim() ? tidy(extracted.text) : null
  return {
    ...base,
    ...(image ? { image } : {}),
    ...(body ? { text: body.text } : {}),
    truncated: body?.truncated ?? false,
  }
}

/** never throws: a missing file and an unexpected failure come back as `ok: false` */
export async function quickLook(
  path: string,
  deps: { extractText?: Extract } = {},
): Promise<QuickLookPayload> {
  const name = basename(path)
  let st
  try {
    st = await stat(path)
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
    return { ok: false, path, name, error: missing ? 'missing' : 'unreadable' }
  }
  if (!st.isFile()) return { ok: false, path, name, error: 'unreadable' }
  const key = `${path}|${st.size}|${st.mtimeMs}`
  const hit = cache.get(key)
  if (hit) return hit
  try {
    const ext = extname(path).slice(1).toLowerCase()
    const payload = await build(
      path,
      ext,
      st.size,
      st.mtimeMs,
      deps.extractText ?? defaultExtractText,
    )
    cache.set(key, payload)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
    return payload
  } catch {
    return { ok: false, path, name, error: 'unreadable' }
  }
}
