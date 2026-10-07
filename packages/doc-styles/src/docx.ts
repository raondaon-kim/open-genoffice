import {
  type PageCommon,
  type Rec,
  type SkeletonSlot,
  Invalid,
  bool,
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

/** a Word (.docx) document type: roles are paragraph formats the assistant applies with its formatting commands */

export const DOCX_KINDS = [
  'title',
  'subtitle',
  'heading',
  'body',
  'list',
  'caption',
  'quote',
  'other',
] as const
export type DocxKind = (typeof DOCX_KINDS)[number]
export const DOCX_ALIGNS = ['left', 'center', 'right', 'justify'] as const
export type DocxAlign = (typeof DOCX_ALIGNS)[number]
export const DOCX_BULLETS = ['none', 'bullet', 'number'] as const

export interface DocxRole {
  id: string
  label: string
  kind: DocxKind
  /** 1-6 when kind is heading */
  heading?: number
  /** points, half-point steps */
  size: number
  bold: boolean
  italic?: boolean
  align: DocxAlign
  /** font family; omitted = the document's body font */
  font?: string
  color?: string
  /** points */
  spacingBefore: number
  spacingAfter: number
  /** a multiple of the font's line height (1 = single) */
  lineSpacing: number
  /** points from the left margin */
  indentLeft: number
  /** points; negative = hanging indent */
  indentFirstLine: number
  bullet?: (typeof DOCX_BULLETS)[number]
}

export interface DocxStyle extends PageCommon {
  format: 'docx'
  page: {
    paper: string
    orientation: 'portrait' | 'landscape'
    marginMm: { left: number; right: number; top: number; bottom: number }
    /** the assistant can apply the page setup to the document */
    settable: boolean
  }
  fonts: { latin?: string; eastAsian?: string }
  roles: DocxRole[]
  skeleton: SkeletonSlot[]
}

function role(raw: unknown, i: number): DocxRole {
  if (!isRec(raw)) throw new Invalid(`roles[${i}] must be an object`)
  const p = `roles[${i}]`
  const kind = oneOf(raw.kind, `${p}.kind`, DOCX_KINDS)
  if (kind === 'heading') int(raw.heading, `${p}.heading (1-6 for a heading role)`, 1, 6)
  else if (raw.heading !== undefined) throw new Invalid(`${p}.heading is only for the heading kind`)
  return {
    id: roleId(raw.id, `${p}.id`),
    label: str(raw.label, `${p}.label`, 80),
    kind,
    ...(kind === 'heading' ? { heading: raw.heading as number } : {}),
    size: halfPoints(raw.size, `${p}.size`, 5, 100),
    bold: bool(raw.bold, `${p}.bold`),
    ...(raw.italic === undefined ? {} : { italic: bool(raw.italic, `${p}.italic`) }),
    align: oneOf(raw.align, `${p}.align`, DOCX_ALIGNS),
    ...(raw.font === undefined ? {} : { font: str(raw.font, `${p}.font`, 60) }),
    ...(raw.color === undefined ? {} : { color: hex(raw.color, `${p}.color`) }),
    spacingBefore: numIn(raw.spacingBefore, `${p}.spacingBefore`, 0, 200),
    spacingAfter: numIn(raw.spacingAfter, `${p}.spacingAfter`, 0, 200),
    lineSpacing: numIn(raw.lineSpacing, `${p}.lineSpacing`, 0.5, 4),
    indentLeft: numIn(raw.indentLeft, `${p}.indentLeft`, -100, 500),
    indentFirstLine: numIn(raw.indentFirstLine, `${p}.indentFirstLine`, -200, 200),
    ...(raw.bullet === undefined ? {} : { bullet: oneOf(raw.bullet, `${p}.bullet`, DOCX_BULLETS) }),
  }
}

export function validateDocx(raw: Rec): DocxStyle {
  const common = validateCommon(raw)
  const page = raw.page
  if (!isRec(page) || !isRec(page.marginMm)) throw new Invalid('page.marginMm must be an object')
  const margin = (k: string) => numIn((page.marginMm as Rec)[k], `page.marginMm.${k}`, 0, 100)
  const fonts = raw.fonts === undefined ? {} : raw.fonts
  if (!isRec(fonts)) throw new Invalid('fonts must be an object')
  if (!Array.isArray(raw.roles) || raw.roles.length === 0 || raw.roles.length > 40) {
    throw new Invalid('roles must be a list of 1-40 roles')
  }
  const roles = raw.roles.map(role)
  const ids = uniqueIds(roles, 'role')
  return {
    ...common,
    format: 'docx',
    page: {
      paper: str(page.paper, 'page.paper', 40),
      orientation: oneOf(page.orientation, 'page.orientation', ['portrait', 'landscape'] as const),
      marginMm: {
        left: margin('left'),
        right: margin('right'),
        top: margin('top'),
        bottom: margin('bottom'),
      },
      settable: bool(page.settable, 'page.settable'),
    },
    fonts: {
      ...(fonts.latin === undefined ? {} : { latin: str(fonts.latin, 'fonts.latin', 60) }),
      ...(fonts.eastAsian === undefined
        ? {}
        : { eastAsian: str(fonts.eastAsian, 'fonts.eastAsian', 60) }),
    },
    roles,
    skeleton: validateSkeleton(raw.skeleton, 'role', ids) as SkeletonSlot[],
  }
}
