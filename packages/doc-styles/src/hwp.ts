import {
  type PageCommon,
  type Rec,
  type SkeletonSlot,
  Invalid,
  bool,
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

/** a Hangul (.hwp/.hwpx) document type (spec §4.1); pages without a "format" are Hangul pages */

export const ALIGNMENTS = ['left', 'center', 'right', 'justify', 'distribute', 'division'] as const
export type StyleAlign = (typeof ALIGNMENTS)[number]

export interface StyleRole {
  id: string
  label: string
  /** descriptive marker kind (N., 가., □, ○, text …); generation uses lead and the shape values */
  marker: string
  /** leading spaces the tool adds in front of the text */
  lead: number
  /** points (half points allowed) */
  size: number
  bold: boolean
  align: StyleAlign
  marginLeft: number
  marginRight: number
  indent: number
  spacingBefore: number
  spacingAfter: number
  /** percent */
  lineSpacing: number
}

export type { SkeletonSlot }

export interface DocStyle extends PageCommon {
  format?: 'hwp'
  page: {
    paper: string
    marginMm: { left: number; right: number; top: number; bottom: number }
    /** the engine cannot set paper or margins; kept as reference */
    settable: boolean
  }
  roles: StyleRole[]
  skeleton: SkeletonSlot[]
}

function role(raw: unknown, i: number): StyleRole {
  if (!isRec(raw)) throw new Invalid(`roles[${i}] must be an object`)
  const p = `roles[${i}]`
  const size = raw.size
  if (typeof size !== 'number' || size < 5 || size > 100 || (size * 2) % 1 !== 0) {
    throw new Invalid(`${p}.size must be between 5 and 100 points in half-point steps`)
  }
  return {
    id: roleId(raw.id, `${p}.id`),
    label: str(raw.label, `${p}.label`, 80),
    marker: str(raw.marker, `${p}.marker`, 12),
    lead: int(raw.lead, `${p}.lead`, 0, 20),
    size,
    bold: bool(raw.bold, `${p}.bold`),
    align: oneOf(raw.align, `${p}.align`, ALIGNMENTS),
    marginLeft: int(raw.marginLeft, `${p}.marginLeft`, -100000, 100000),
    marginRight: int(raw.marginRight, `${p}.marginRight`, -100000, 100000),
    indent: int(raw.indent, `${p}.indent`, -100000, 100000),
    spacingBefore: int(raw.spacingBefore, `${p}.spacingBefore`, 0, 100000),
    spacingAfter: int(raw.spacingAfter, `${p}.spacingAfter`, 0, 100000),
    lineSpacing: int(raw.lineSpacing, `${p}.lineSpacing`, 50, 500),
  }
}

export function validateHwp(raw: Rec): DocStyle {
  const common = validateCommon(raw)
  const page = raw.page
  if (!isRec(page) || !isRec(page.marginMm)) throw new Invalid('page.marginMm must be an object')
  const margin = (k: string) => numIn((page.marginMm as Rec)[k], `page.marginMm.${k}`, 0, 100)
  if (!Array.isArray(raw.roles) || raw.roles.length === 0 || raw.roles.length > 40) {
    throw new Invalid('roles must be a list of 1-40 roles')
  }
  const roles = raw.roles.map(role)
  const ids = uniqueIds(roles, 'role')
  return {
    ...common,
    format: 'hwp',
    page: {
      paper: str(page.paper, 'page.paper', 40),
      marginMm: {
        left: margin('left'),
        right: margin('right'),
        top: margin('top'),
        bottom: margin('bottom'),
      },
      settable: bool(page.settable, 'page.settable'),
    },
    roles,
    skeleton: validateSkeleton(raw.skeleton, 'role', ids) as SkeletonSlot[],
  }
}
