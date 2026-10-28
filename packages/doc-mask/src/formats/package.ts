import type { Counts } from '../rules'
import { addCounts, maskXmlGeneric, maskXmlParagraphs, type XmlFamily } from '../xml-text'
import { decodePart, isXmlPart, type PackageEntry } from '../zip'

type XmlStep = (xml: string) => { xml: string; counts: Counts }

export interface PartPlan {
  /** run before the families, e.g. turning numeric cells into strings */
  before?: XmlStep
  /** paragraph families whose split runs are masked together */
  families?: readonly XmlFamily[]
}

export interface EntryHook {
  /** replace or drop (null) a non-XML entry; undefined = keep as is */
  (entry: PackageEntry): Promise<{ data: Uint8Array; counts: Counts } | null | undefined>
}

const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

/**
 * Masks every XML part of a package: the part's families first (numbers split across runs),
 * then the catch-all pass over every text node and attribute value. Unchanged parts keep their
 * bytes. Non-XML entries go through `other` (embedded workbooks, preview images).
 */
export async function maskEntries(
  entries: PackageEntry[],
  planFor: (name: string) => PartPlan,
  other?: EntryHook,
): Promise<{ entries: PackageEntry[]; counts: Counts }> {
  const counts: Counts = {}
  const out: PackageEntry[] = []
  for (const entry of entries) {
    await yieldToLoop()
    if (!isXmlPart(entry.name)) {
      const replaced = other ? await other(entry) : undefined
      if (replaced === null) continue
      if (replaced) {
        addCounts(counts, replaced.counts)
        out.push({ name: entry.name, data: replaced.data })
      } else {
        out.push(entry)
      }
      continue
    }
    const part = decodePart(entry.data)
    const plan = planFor(entry.name)
    const steps: XmlStep[] = [
      ...(plan.before ? [plan.before] : []),
      ...(plan.families ?? []).map((f) => (xml: string) => maskXmlParagraphs(xml, f)),
      maskXmlGeneric,
    ]
    let xml = part.text
    for (const step of steps) {
      const r = step(xml)
      xml = r.xml
      addCounts(counts, r.counts)
    }
    out.push(xml === part.text ? entry : { name: entry.name, data: part.encode(xml) })
  }
  return { entries: out, counts }
}
