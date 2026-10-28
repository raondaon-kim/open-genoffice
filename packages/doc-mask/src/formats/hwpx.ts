import type { Counts } from '../rules'
import { XML_FAMILIES } from '../xml-text'
import { readPackage, writePackage } from '../zip'
import { maskEntries, type PartPlan } from './package'
import { maskPlainText } from './text'

/** a 1×1 PNG: Hangul's first-page preview picture is replaced, not removed, so every reader
 *  that expects the entry still finds one */
const BLANK_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    'base64',
  ),
)

export function hwpxPlan(name: string): PartPlan {
  // body, headers, footers, footnotes, text boxes and table cells all live in the sections
  if (/^Contents\/section\d+\.xml$/i.test(name)) return { families: [XML_FAMILIES.hwpx] }
  if (/^Chart(s)?\//i.test(name)) return { families: [XML_FAMILIES.drawing] }
  return {}
}

export async function maskHwpx(bytes: Uint8Array): Promise<{ bytes: Uint8Array; counts: Counts }> {
  const { entries, counts } = await maskEntries(await readPackage(bytes), hwpxPlan, async (e) => {
    if (/^Preview\/PrvImage\.[a-z]+$/i.test(e.name)) return { data: BLANK_PNG, counts: {} }
    if (/^Preview\/PrvText\.txt$/i.test(e.name)) {
      const r = maskPlainText(e.data)
      return { data: r.bytes, counts: r.counts }
    }
    return undefined
  })
  return { bytes: await writePackage(entries), counts }
}
