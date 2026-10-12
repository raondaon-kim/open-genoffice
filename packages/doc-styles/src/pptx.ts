import {
  type PageCommon,
  type Rec,
  Invalid,
  bool,
  colorRef,
  halfPoints,
  hex,
  int,
  isRec,
  numIn,
  oneOf,
  roleId,
  str,
  uniqueIds,
  validateCommon,
  validateSkeleton,
} from './common'

/**
 * A PowerPoint (.pptx) deck type: theme (fonts, colors), text roles and slide layouts built from them.
 * A layout also carries its design: a background color, decoration shapes and per-element colors, all as
 * color tokens (dark, light, mute, tint, accent1-6) or #RRGGBB, so a deck is designed, not just typeset.
 */

export const PPTX_KINDS = ['title', 'subtitle', 'body', 'caption', 'label', 'other'] as const
export type PptxKind = (typeof PPTX_KINDS)[number]
export const PPTX_ALIGNS = ['left', 'center', 'right'] as const
/** slide shape: widescreen, standard, or A4 landscape (297 x 210 mm, common for Korean bid proposals) */
export const PPTX_RATIOS = ['16:9', '4:3', 'A4'] as const
export const DECOR_SHAPES = ['rect', 'roundRect', 'ellipse'] as const

/** a box as fractions of the slide width/height */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface PptxRole {
  id: string
  label: string
  kind: PptxKind
  /** points, half-point steps */
  size: number
  bold: boolean
  align: (typeof PPTX_ALIGNS)[number]
  /** a color token or #RRGGBB (default: dark) */
  color?: string
  /** list level 1-5 for body roles */
  level?: number
  box?: Box
}

export interface PptxDecor {
  shape: (typeof DECOR_SHAPES)[number]
  box: Box
  fill: string
}

export interface PptxElement {
  role: string
  /** the name the text of this element is given by in create_styled_deck (default: the role id) */
  key?: string
  box?: Box
  /** overrides the role's color on this layout (light text on a dark cover) */
  color?: string
}

export interface PptxLayout {
  id: string
  label: string
  /** when to use this layout (a sentence for the assistant) */
  use: string
  /** slide background: a color token or #RRGGBB (default: the theme's light color) */
  background?: string
  /** shapes drawn behind the text, in order */
  decor?: PptxDecor[]
  elements: PptxElement[]
}

export interface PptxSlot {
  slot: string
  layout?: string
  layouts?: string[]
  required?: boolean
  repeat?: boolean
}

export interface PptxStyle extends PageCommon {
  format: 'pptx'
  slide: { ratio: (typeof PPTX_RATIOS)[number] }
  theme: {
    fontMajor: string
    fontMinor: string
    fontEastAsian?: string
    colors: { dark: string; light: string; accent: string[] }
  }
  roles: PptxRole[]
  layouts: PptxLayout[]
  skeleton: PptxSlot[]
  /**
   * deck-type writing rules for the assistant (density, page anatomy, conventions); when absent the
   * generic presentation rules apply (a few short phrases per slide)
   */
  rules?: string[]
}

function box(raw: unknown, path: string): Box {
  if (!isRec(raw)) throw new Invalid(`${path} must be an object {x, y, w, h}`)
  const b = {
    x: numIn(raw.x, `${path}.x`, 0, 1),
    y: numIn(raw.y, `${path}.y`, 0, 1),
    w: numIn(raw.w, `${path}.w`, 0.001, 1),
    h: numIn(raw.h, `${path}.h`, 0.001, 1),
  }
  if (b.x + b.w > 1.001 || b.y + b.h > 1.001)
    throw new Invalid(`${path} must stay inside the slide`)
  return b
}

function role(raw: unknown, i: number): PptxRole {
  if (!isRec(raw)) throw new Invalid(`roles[${i}] must be an object`)
  const p = `roles[${i}]`
  return {
    id: roleId(raw.id, `${p}.id`),
    label: str(raw.label, `${p}.label`, 80),
    kind: oneOf(raw.kind, `${p}.kind`, PPTX_KINDS),
    size: halfPoints(raw.size, `${p}.size`, 6, 120),
    bold: bool(raw.bold, `${p}.bold`),
    align: oneOf(raw.align, `${p}.align`, PPTX_ALIGNS),
    ...(raw.color === undefined ? {} : { color: colorRef(raw.color, `${p}.color`) }),
    ...(raw.level === undefined ? {} : { level: int(raw.level, `${p}.level`, 1, 5) }),
    ...(raw.box === undefined ? {} : { box: box(raw.box, `${p}.box`) }),
  }
}

export function validatePptx(raw: Rec): PptxStyle {
  const common = validateCommon(raw)
  const slide = raw.slide
  if (!isRec(slide)) throw new Invalid('slide must be an object')
  const theme = raw.theme
  if (!isRec(theme) || !isRec(theme.colors)) throw new Invalid('theme.colors must be an object')
  const colors = theme.colors
  if (!Array.isArray(colors.accent) || colors.accent.length > 8)
    throw new Invalid('theme.colors.accent must be a list of at most 8 colors')
  if (!Array.isArray(raw.roles) || raw.roles.length === 0 || raw.roles.length > 30) {
    throw new Invalid('roles must be a list of 1-30 roles')
  }
  const roles = raw.roles.map(role)
  const roleIds = uniqueIds(roles, 'role')
  if (!Array.isArray(raw.layouts) || raw.layouts.length === 0 || raw.layouts.length > 20) {
    throw new Invalid('layouts must be a list of 1-20 layouts')
  }
  const layouts = raw.layouts.map((l, i): PptxLayout => {
    if (!isRec(l)) throw new Invalid(`layouts[${i}] must be an object`)
    const p = `layouts[${i}]`
    if (!Array.isArray(l.elements) || l.elements.length === 0 || l.elements.length > 16) {
      throw new Invalid(`${p}.elements must be a list of 1-16 elements`)
    }
    const keys = new Set<string>()
    const elements = l.elements.map((e, j): PptxElement => {
      if (!isRec(e)) throw new Invalid(`${p}.elements[${j}] must be an object`)
      const ref = str(e.role, `${p}.elements[${j}].role`, 41)
      if (!roleIds.has(ref))
        throw new Invalid(`${p}.elements[${j}] points at the missing role "${ref}"`)
      const key = e.key === undefined ? ref : roleId(e.key, `${p}.elements[${j}].key`)
      if (keys.has(key))
        throw new Invalid(`duplicate element key "${key}" in ${p} (give repeated roles a key)`)
      keys.add(key)
      return {
        role: ref,
        ...(e.key === undefined ? {} : { key }),
        ...(e.box === undefined ? {} : { box: box(e.box, `${p}.elements[${j}].box`) }),
        ...(e.color === undefined ? {} : { color: colorRef(e.color, `${p}.elements[${j}].color`) }),
      }
    })
    if (l.decor !== undefined && (!Array.isArray(l.decor) || l.decor.length > 12)) {
      throw new Invalid(`${p}.decor must be a list of at most 12 shapes`)
    }
    const decor = (l.decor as unknown[] | undefined)?.map((d, j): PptxDecor => {
      if (!isRec(d)) throw new Invalid(`${p}.decor[${j}] must be an object`)
      return {
        shape: oneOf(d.shape, `${p}.decor[${j}].shape`, DECOR_SHAPES),
        box: box(d.box, `${p}.decor[${j}].box`),
        fill: colorRef(d.fill, `${p}.decor[${j}].fill`),
      }
    })
    return {
      id: roleId(l.id, `${p}.id`),
      label: str(l.label, `${p}.label`, 80),
      use: str(l.use, `${p}.use`, 200),
      ...(l.background === undefined
        ? {}
        : { background: colorRef(l.background, `${p}.background`) }),
      ...(decor && decor.length ? { decor } : {}),
      elements,
    }
  })
  const layoutIds = uniqueIds(layouts, 'layout')
  return {
    ...common,
    format: 'pptx',
    slide: { ratio: oneOf(slide.ratio, 'slide.ratio', PPTX_RATIOS) },
    theme: {
      fontMajor: str(theme.fontMajor, 'theme.fontMajor', 60),
      fontMinor: str(theme.fontMinor, 'theme.fontMinor', 60),
      ...(theme.fontEastAsian === undefined
        ? {}
        : { fontEastAsian: str(theme.fontEastAsian, 'theme.fontEastAsian', 60) }),
      colors: {
        dark: hex(colors.dark, 'theme.colors.dark'),
        light: hex(colors.light, 'theme.colors.light'),
        accent: colors.accent.map((c, i) => hex(c, `theme.colors.accent[${i}]`)),
      },
    },
    roles,
    layouts,
    skeleton: validateSkeleton(raw.skeleton, 'layout', layoutIds) as PptxSlot[],
    ...(raw.rules === undefined ? {} : { rules: rulesOf(raw.rules) }),
  }
}

function rulesOf(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 12) {
    throw new Invalid('rules must be a list of at most 12 lines')
  }
  return raw.map((r, i) => str(r, `rules[${i}]`, 300))
}
