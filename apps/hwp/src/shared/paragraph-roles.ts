/**
 * A document's own paragraph roles (spec §4.1): paragraphs that share a marker,
 * leading-space count, text size and weight. Pure functions, shared by the main
 * process (the insert_paragraph_like step expansion) and the renderer (form_map).
 */

export type Marker =
  | 'N.'
  | '가.'
  | 'N)'
  | '가)'
  | '(N)'
  | '(가)'
  | '①'
  | '□'
  | '○'
  | '-'
  | '·'
  | '▸'
  | '※'
  | '붙임'
  | '끝'
  | 'Ⅰ.'
  | '제N조'
  | 'text'
  | 'empty'

const MARKERS: Array<[Marker, RegExp]> = [
  ['N.', /^\d{1,2}\.(?!\d)/],
  // the 14 enumeration syllables only: a range like [가-하] covers every Hangul syllable ("끝.")
  ['가.', /^[가나다라마바사아자차카타파하]\./],
  ['N)', /^\d{1,2}\)/],
  ['가)', /^[가나다라마바사아자차카타파하]\)/],
  ['(N)', /^\(\d{1,2}\)/],
  ['(가)', /^\([가나다라마바사아자차카타파하]\)/],
  ['①', /^[①-⑳]/],
  ['□', /^[□■]/],
  ['○', /^[○●◦ㅇ]/],
  ['-', /^[-–—]\s/],
  ['·', /^[·•ㆍ∙]/],
  ['▸', /^[▸▶►▷]/],
  ['※', /^※/],
  ['붙임', /^붙\s*임/],
  ['끝', /^끝\.?$/],
  ['Ⅰ.', /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\./],
  ['제N조', /^제\s*\d+\s*조/],
]

const OUTLINE = new Set<Marker>([
  '□',
  '○',
  '-',
  '※',
  '▸',
  'N.',
  '가.',
  'N)',
  '가)',
  '(N)',
  '(가)',
  '①',
  'Ⅰ.',
  '·',
])

/** the kind of marker a paragraph starts with (leading whitespace ignored) */
export function markerOf(text: string): Marker {
  const trimmed = text.trim()
  if (trimmed === '') return 'empty'
  for (const [name, re] of MARKERS) if (re.test(trimmed)) return name
  return 'text'
}

export interface RoleSource {
  section: number
  paragraph: number
  empty: boolean
  preview: string
  lead?: number
  fontSize?: number
  bold?: boolean
  indent?: number
}

export interface Role {
  id: number
  marker: Marker
  lead: number
  size: number | null
  bold: boolean
  count: number
  example: { section: number; paragraph: number }
  indentRange: [number, number] | null
}

/** roles in order of first appearance; `roleOf` maps "section.paragraph" to a role id */
export function buildRoles(paragraphs: RoleSource[]): {
  roles: Role[]
  roleOf: Map<string, number>
} {
  const roles: Role[] = []
  const byKey = new Map<string, Role>()
  const roleOf = new Map<string, number>()
  for (const p of paragraphs) {
    if (p.empty) continue
    const marker = markerOf(p.preview)
    const lead = p.lead ?? 0
    const size = p.fontSize ?? null
    const bold = p.bold === true
    const key = `${marker}|${lead}|${size ?? ''}|${bold}`
    let role = byKey.get(key)
    if (!role) {
      role = {
        id: roles.length,
        marker,
        lead,
        size,
        bold,
        count: 0,
        example: { section: p.section, paragraph: p.paragraph },
        indentRange: null,
      }
      roles.push(role)
      byKey.set(key, role)
    }
    role.count++
    if (typeof p.indent === 'number') {
      role.indentRange = role.indentRange
        ? [Math.min(role.indentRange[0], p.indent), Math.max(role.indentRange[1], p.indent)]
        : [p.indent, p.indent]
    }
    roleOf.set(`${p.section}.${p.paragraph}`, role.id)
  }
  return { roles, roleOf }
}

/**
 * the extra leading spaces one outline level adds over the previous one: the median
 * difference between adjacent paragraphs of different outline markers where the next
 * one is indented further. 2 when the document shows none.
 */
export function levelStep(paragraphs: RoleSource[]): number {
  const text = paragraphs.filter((p) => !p.empty)
  const diffs: number[] = []
  for (let i = 0; i + 1 < text.length; i++) {
    const a = markerOf(text[i]!.preview)
    const b = markerOf(text[i + 1]!.preview)
    if (a === b || !OUTLINE.has(a) || !OUTLINE.has(b)) continue
    const diff = (text[i + 1]!.lead ?? 0) - (text[i]!.lead ?? 0)
    if (diff > 0) diffs.push(diff)
  }
  if (diffs.length === 0) return 2
  diffs.sort((x, y) => x - y)
  return diffs[Math.floor(diffs.length / 2)]!
}
