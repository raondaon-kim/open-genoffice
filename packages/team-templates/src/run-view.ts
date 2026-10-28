import type { TemplateDef } from './template-md'

/** same shape as @genoffice/report-writer's TemplateForRun (this package does not depend on it) */
export interface TemplateRunView {
  title: string
  purpose: string
  sections: Array<{
    index: number
    path: string[]
    heading: string
    level: number
    guidance: string
  }>
  coverLabels: string[]
  wikiPages: string[]
  styleRules: string
}

/**
 * The sections a fill writes: every heading without sub-headings, plus a parent heading whose
 * guidance asks for text of its own. `index` is the heading's ordinal in the outline (the form
 * has the same headings in the same order).
 */
export function templateForRun(def: TemplateDef, coverLabels: string[]): TemplateRunView {
  const sections: TemplateRunView['sections'] = []
  const stack: Array<{ level: number; heading: string }> = []
  def.outline.forEach((entry, index) => {
    while (stack.length && stack.at(-1)!.level >= entry.level) stack.pop()
    const next = def.outline[index + 1]
    const leaf = !next || next.level <= entry.level
    if (leaf || entry.guidance) {
      sections.push({
        index,
        path: stack.map((s) => s.heading),
        heading: entry.heading,
        level: entry.level,
        guidance: entry.guidance,
      })
    }
    stack.push({ level: entry.level, heading: entry.heading })
  })
  return {
    title: def.title,
    purpose: def.purpose,
    sections,
    coverLabels,
    wikiPages: def.wikiPages,
    styleRules: [def.notes, def.materials.length ? `필요한 자료: ${def.materials.join(', ')}` : '']
      .filter(Boolean)
      .join('\n'),
  }
}
