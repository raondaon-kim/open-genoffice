import type { Counts } from '../rules'
import { XML_FAMILIES } from '../xml-text'
import { readPackage, writePackage } from '../zip'
import { dropParts, embeddedHook, isCompoundFile, isThumbnail } from './office'
import { maskEntries, type PartPlan } from './package'
import { maskPptx } from './pptx'
import { maskXlsx } from './xlsx'

export function docxPlan(name: string): PartPlan {
  if (/^word\/(charts|diagrams)\//i.test(name)) return { families: [XML_FAMILIES.drawing] }
  // body, headers, footers, notes, comments, glossary; DrawingML text in shapes uses a:t
  if (/^word\//i.test(name)) return { families: [XML_FAMILIES.docx, XML_FAMILIES.drawing] }
  return {}
}

export async function maskDocx(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; counts: Counts } | { encrypted: true }> {
  if (isCompoundFile(bytes)) return { encrypted: true }
  const { entries, counts } = await maskEntries(
    await readPackage(bytes),
    docxPlan,
    embeddedHook({ xlsx: maskXlsx, docx: maskDocx, pptx: maskPptx }),
  )
  return { bytes: await writePackage(dropParts(entries, isThumbnail)), counts }
}
