import type { Counts } from '../rules'
import { decodePart, type PackageEntry } from '../zip'
import type { EntryHook } from './package'

/** an OLE compound file: what Office writes for a password-protected docx/xlsx/pptx */
export function isCompoundFile(bytes: Uint8Array): boolean {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return bytes.length >= 8 && magic.every((b, i) => bytes[i] === b)
}

/** pictures of the document's own first page; they are not needed to open the file */
export const isThumbnail = (name: string): boolean => /^docProps\/thumbnail\.[a-z0-9]+$/i.test(name)

/**
 * Removes parts and every reference to them, so the package stays valid: the relationship
 * pointing at the part (any *.rels) and its content-type override.
 */
export function dropParts(entries: PackageEntry[], drop: (name: string) => boolean): PackageEntry[] {
  const dropped = entries.filter((e) => drop(e.name)).map((e) => e.name)
  if (dropped.length === 0) return entries
  const mentions = (s: string) => dropped.some((n) => s.includes(n))
  return entries
    .filter((e) => !drop(e.name))
    .map((e) => {
      if (!/\.rels$/i.test(e.name) && e.name !== '[Content_Types].xml') return e
      const part = decodePart(e.data)
      const xml = part.text
        .replace(/<Relationship\b[^>]*\/>/g, (tag) => (mentions(tag) ? '' : tag))
        .replace(/<Override\b[^>]*\/>/g, (tag) => (mentions(tag) ? '' : tag))
      return xml === part.text ? e : { name: e.name, data: part.encode(xml) }
    })
}

/** embedded Office files are masked as what they are; other entries stay */
export function embeddedHook(maskers: {
  xlsx: (b: Uint8Array) => Promise<{ bytes: Uint8Array; counts: Counts }>
  docx?: (b: Uint8Array) => Promise<{ bytes: Uint8Array; counts: Counts } | { encrypted: true }>
  pptx?: (b: Uint8Array) => Promise<{ bytes: Uint8Array; counts: Counts }>
}): EntryHook {
  return async (entry) => {
    if (!/\/embeddings\//i.test(entry.name)) return undefined
    const ext = /\.([a-z]+)$/i.exec(entry.name)?.[1]?.toLowerCase()
    const masker =
      ext === 'xlsx' ? maskers.xlsx : ext === 'docx' ? maskers.docx : ext === 'pptx' ? maskers.pptx : undefined
    if (!masker) return undefined
    const r = await masker(entry.data)
    // an encrypted embedded document cannot be masked; the verification pass decides on it
    if ('encrypted' in r) return undefined
    return { data: r.bytes, counts: r.counts }
  }
}
