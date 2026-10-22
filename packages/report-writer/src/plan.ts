import type { Brief, PlannedChapter, ReportPlan } from './types'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []

/** a page id as the plan named it, matched against the ids the index listed */
function knownPage(id: string, pages: Set<string>): string | null {
  if (pages.has(id)) return id
  if (!id.includes('/')) {
    for (const p of pages) if (p.endsWith(`/${id}`)) return p
  }
  return null
}

/**
 * The model's plan made safe to run: chapters numbered 1..N, unknown wiki pages and attachment
 * parts dropped, a topic owned by two chapters kept with the first. Throws when there is no
 * title or no chapter.
 */
export function validatePlan(
  raw: unknown,
  known: { pages: Set<string>; parts: Set<string> },
): ReportPlan {
  if (typeof raw !== 'object' || raw === null) throw new Error('the plan is not an object')
  const r = raw as Record<string, unknown>
  const title = str(r.title)
  if (!title) throw new Error('the plan has no title')
  if (!Array.isArray(r.chapters) || r.chapters.length === 0) {
    throw new Error('the plan has no chapters')
  }
  const b = (typeof r.brief === 'object' && r.brief !== null ? r.brief : {}) as Record<
    string,
    unknown
  >
  const terms: Record<string, string> = {}
  if (typeof b.terms === 'object' && b.terms !== null) {
    for (const [k, v] of Object.entries(b.terms)) if (str(v)) terms[k] = str(v)
  }
  const brief: Brief = {
    purpose: str(b.purpose),
    reader: str(b.reader),
    messages: strs(b.messages),
    terms,
  }
  const owned = new Set<string>()
  const chapters: PlannedChapter[] = r.chapters.map((c, i) => {
    const ch = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>
    const owns = strs(ch.owns).filter((t) => !owned.has(t))
    for (const t of owns) owned.add(t)
    const pages = strs(ch.wikiPages)
      .map((p) => knownPage(p, known.pages))
      .filter((p): p is string => p !== null)
    return {
      no: i + 1,
      title: str(ch.title) || `${i + 1}장`,
      point: str(ch.point),
      owns,
      stances: strs(ch.stances),
      sections: strs(ch.sections),
      attachmentParts: strs(ch.attachmentParts).filter((p) => known.parts.has(p)),
      wikiPages: [...new Set(pages)],
    }
  })
  return { brief, title, tocFromAttachment: r.tocFromAttachment === true, chapters }
}
