import { type Counts, maskText } from '../rules'
import { XML_FAMILIES, type XmlFamily } from '../xml-text'
import { readPackage, writePackage } from '../zip'
import { maskEntries, type PartPlan } from './package'

/** inline strings: <c t="inlineStr"><is><t>…</t></is></c>, rich runs like shared strings */
const INLINE: XmlFamily = { paragraph: 'is', text: ['t'], preserveSpace: true }

const NUMERIC_CELL =
  /<c\b((?:[^>"']|"[^"]*"|'[^']*')*?)>(\s*(?:<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>)?\s*)<v>([^<]*)<\/v>\s*<\/c>/g

/**
 * A number typed into a cell is stored as a number (`<v>9001011234567</v>`), not as text. When its
 * digits are an identification number the cell becomes a string cell holding the placeholder.
 */
export function maskNumericCells(xml: string): { xml: string; counts: Counts } {
  const counts: Counts = {}
  const out = xml.replace(NUMERIC_CELL, (all, attrs: string, _formula: string, value: string) => {
    const type = /\st\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    if (type !== undefined && type !== 'n') return all
    if (!/^\d+$/.test(value.trim())) return all
    const masked = maskText(value.trim())
    if (masked.text === value.trim()) return all
    for (const [rule, n] of Object.entries(masked.counts)) {
      counts[rule as keyof Counts] = (counts[rule as keyof Counts] ?? 0) + (n ?? 0)
    }
    const rest = attrs.replace(/\st\s*=\s*"[^"]*"/, '')
    return `<c${rest} t="inlineStr"><is><t>${masked.text}</t></is></c>`
  })
  return { xml: out, counts }
}

export function xlsxPlan(name: string): PartPlan {
  if (/^xl\/sharedStrings\.xml$/i.test(name)) return { families: [XML_FAMILIES.sheet] }
  if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
    return { before: maskNumericCells, families: [INLINE] }
  }
  if (/^xl\/(comments|threadedComments)/i.test(name)) return { families: [XML_FAMILIES.sheet] }
  if (/^xl\/(charts|drawings)\//i.test(name)) return { families: [XML_FAMILIES.drawing] }
  return {}
}

export async function maskXlsx(bytes: Uint8Array): Promise<{ bytes: Uint8Array; counts: Counts }> {
  const { entries, counts } = await maskEntries(await readPackage(bytes), xlsxPlan)
  return { bytes: await writePackage(entries), counts }
}
