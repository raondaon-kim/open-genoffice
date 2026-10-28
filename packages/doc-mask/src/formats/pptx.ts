import type { Counts } from '../rules'
import { XML_FAMILIES } from '../xml-text'
import { readPackage, writePackage } from '../zip'
import { maskDocx } from './docx'
import { dropParts, embeddedHook, isThumbnail } from './office'
import { maskEntries, type PartPlan } from './package'
import { maskXlsx } from './xlsx'

export function pptxPlan(name: string): PartPlan {
  if (/^ppt\//i.test(name)) return { families: [XML_FAMILIES.drawing] }
  return {}
}

export async function maskPptx(bytes: Uint8Array): Promise<{ bytes: Uint8Array; counts: Counts }> {
  const { entries, counts } = await maskEntries(
    await readPackage(bytes),
    pptxPlan,
    embeddedHook({ xlsx: maskXlsx, docx: maskDocx, pptx: maskPptx }),
  )
  return { bytes: await writePackage(dropParts(entries, isThumbnail)), counts }
}
