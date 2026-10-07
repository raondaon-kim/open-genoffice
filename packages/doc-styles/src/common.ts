/** shared validation helpers for the document-style wiki pages (spec §4.1) */

export type Rec = Record<string, unknown>
export class Invalid extends Error {}

export const ID = /^[a-z][a-z0-9-]{1,40}$/
export const BLOCK = /```json style\s*\n([\s\S]*?)\n```/
export const HEX = /^#[0-9A-Fa-f]{6}$/

export const isRec = (v: unknown): v is Rec =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)

export function str(v: unknown, path: string, max = 200, allowEmpty = false): string {
  if (typeof v !== 'string' || (!allowEmpty && v.trim() === '') || v.length > max) {
    throw new Invalid(`${path} must be a non-empty string (max ${max})`)
  }
  return v
}

export function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Invalid(`${path} must be an integer in [${min}, ${max}]`)
  }
  return v
}

export function numIn(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || Number.isNaN(v) || v < min || v > max) {
    throw new Invalid(`${path} must be a number in [${min}, ${max}]`)
  }
  return v
}

/** points in half-point steps */
export function halfPoints(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || v < min || v > max || (v * 2) % 1 !== 0) {
    throw new Invalid(`${path} must be between ${min} and ${max} points in half-point steps`)
  }
  return v
}

export function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new Invalid(`${path} must be a boolean`)
  return v
}

export function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new Invalid(`${path} must be one of ${allowed.join(', ')}`)
  }
  return v as T
}

export function hex(v: unknown, path: string): string {
  if (typeof v !== 'string' || !HEX.test(v))
    throw new Invalid(`${path} must be a color like #1F4FD8`)
  return v.toUpperCase()
}

export const COLOR_TOKENS = [
  'dark',
  'light',
  'mute',
  'tint',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
] as const

/** a color token (dark, light, mute, tint, accent1-6) or #RRGGBB */
export function colorRef(v: unknown, path: string): string {
  if (typeof v === 'string' && (COLOR_TOKENS as readonly string[]).includes(v)) return v
  if (typeof v === 'string' && HEX.test(v)) return v.toUpperCase()
  throw new Invalid(`${path} must be a color token (${COLOR_TOKENS.join(', ')}) or #RRGGBB`)
}

export function roleId(v: unknown, path: string): string {
  const id = str(v, path, 41)
  if (!ID.test(id)) throw new Invalid(`${path} must match ${ID}`)
  return id
}

export function uniqueIds<T extends { id: string }>(items: T[], what: string): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id)) throw new Invalid(`duplicate ${what} id "${item.id}"`)
    ids.add(item.id)
  }
  return ids
}

export interface PageCommon {
  id: string
  title: string
  version: number
  /** true until a person has reviewed the values */
  draft?: boolean
  evidence: { documents: number; note: string }
}

export function validateCommon(raw: Rec): PageCommon {
  const id = roleId(raw.id, 'id')
  const evidence = raw.evidence
  if (!isRec(evidence)) throw new Invalid('evidence must be an object')
  return {
    id,
    title: str(raw.title, 'title', 80),
    version: int(raw.version, 'version', 1, 1000),
    ...(raw.draft === undefined ? {} : { draft: bool(raw.draft, 'draft') }),
    evidence: {
      documents: int(evidence.documents, 'evidence.documents', 0, 100000),
      note: str(evidence.note, 'evidence.note', 400, true),
    },
  }
}

export interface SkeletonSlot {
  slot: string
  role?: string
  roles?: string[]
  required?: boolean
  repeat?: boolean
}

/** a skeleton: ordered slots that each point at one or several ids of `refKey` ("role" for text pages, "layout" for decks) */
export function validateSkeleton<K extends 'role' | 'layout'>(
  raw: unknown,
  refKey: K,
  known: Set<string>,
): Array<
  { slot: string; required?: boolean; repeat?: boolean } & { [P in K]?: string } & {
    [P in `${K}s`]?: string[]
  }
> {
  if (!Array.isArray(raw) || raw.length === 0)
    throw new Invalid('skeleton must be a non-empty list')
  const plural = `${refKey}s`
  const slots = new Set<string>()
  return raw.map((s, i) => {
    if (!isRec(s)) throw new Invalid(`skeleton[${i}] must be an object`)
    const slot = str(s.slot, `skeleton[${i}].slot`, 40)
    if (slots.has(slot)) throw new Invalid(`duplicate skeleton slot "${slot}"`)
    slots.add(slot)
    const one = s[refKey] !== undefined
    const many = s[plural] !== undefined
    if (one === many)
      throw new Invalid(`skeleton[${i}] needs exactly one of ${refKey} or ${plural}`)
    const refs = one ? [str(s[refKey], `skeleton[${i}].${refKey}`, 41)] : (s[plural] as unknown[])
    if (!Array.isArray(refs) || refs.length === 0) {
      throw new Invalid(`skeleton[${i}].${plural} must be a non-empty list`)
    }
    for (const ref of refs) {
      if (typeof ref !== 'string' || !known.has(ref)) {
        throw new Invalid(`skeleton[${i}] points at the missing ${refKey} "${String(ref)}"`)
      }
    }
    return {
      slot,
      ...(one ? { [refKey]: refs[0] as string } : { [plural]: refs as string[] }),
      ...(s.required === undefined
        ? {}
        : { required: bool(s.required, `skeleton[${i}].required`) }),
      ...(s.repeat === undefined ? {} : { repeat: bool(s.repeat, `skeleton[${i}].repeat`) }),
    } as never
  })
}
