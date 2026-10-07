import type { CharFormatProps, ParaAlignment, ParaFormatProps } from '../../shared/ai-contract'
import { ToolError } from './errors'

/**
 * Live vs file routing for apply_format (spec §14). The studio's format:bold
 * etc. are toggles and current formatting cannot be read back, so absolute
 * character attributes go through `rhwp edit apply-char-format` (absolute,
 * any RGB). Only relative steps (size ±, line spacing ±) and — when nothing
 * else needs a file edit — alignment run live through commands.execute.
 */

export interface FormatSpec {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  superscript?: boolean
  subscript?: boolean
  /** #rrggbb */
  color?: string
  /** absolute point size */
  fontSize?: number
  align?: ParaAlignment
  /** font-size steps, -10..10 */
  sizeDelta?: number
  /** line-spacing steps, -10..10 */
  lineSpacingDelta?: number
  /** reset character formatting (bold/italic/…/color) */
  clear?: boolean
}

export interface FormatPlan {
  /** studio command ids, in order */
  live: string[]
  char: CharFormatProps | null
  para: ParaFormatProps | null
}

export const ALIGN_COMMANDS: Record<ParaAlignment, string> = {
  left: 'format:align-left',
  center: 'format:align-center',
  right: 'format:align-right',
  justify: 'format:align-justify',
  distribute: 'format:align-distribute',
  division: 'format:align-split',
}

export const MAX_DELTA = 10

type CharFlag = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'superscript' | 'subscript'

const CHAR_FLAGS: Array<[keyof FormatSpec, CharFlag]> = [
  ['bold', 'bold'],
  ['italic', 'italic'],
  ['underline', 'underline'],
  ['strike', 'strikethrough'],
  ['superscript', 'superscript'],
  ['subscript', 'subscript'],
]

function delta(value: number | undefined, key: string): number {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_DELTA) {
    throw new ToolError(
      `${key} must be an integer between -${MAX_DELTA} and ${MAX_DELTA}`,
      'invalid argument',
    )
  }
  return value
}

const repeat = (id: string, times: number): string[] => Array.from({ length: times }, () => id)

export function planFormat(spec: FormatSpec): FormatPlan {
  const char: CharFormatProps = {}
  if (spec.clear) {
    Object.assign(char, {
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      superscript: false,
      subscript: false,
      textColor: '#000000',
    })
  }
  for (const [from, to] of CHAR_FLAGS) {
    const value = spec[from]
    if (value === undefined) continue
    if (typeof value !== 'boolean')
      throw new ToolError(`${from} must be a boolean`, 'invalid argument')
    char[to] = value
  }
  if (spec.color !== undefined) {
    if (typeof spec.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(spec.color)) {
      throw new ToolError('color must be #rrggbb', 'invalid argument')
    }
    char.textColor = spec.color.toUpperCase()
  }
  if (spec.fontSize !== undefined) {
    if (!Number.isSafeInteger(spec.fontSize) || spec.fontSize < 1 || spec.fontSize > 200) {
      throw new ToolError('fontSize must be an integer point size in [1, 200]', 'invalid argument')
    }
    char.fontSize = spec.fontSize
  }
  if (spec.align !== undefined && !(spec.align in ALIGN_COMMANDS)) {
    throw new ToolError(
      `align must be one of ${Object.keys(ALIGN_COMMANDS).join(', ')}`,
      'invalid argument',
    )
  }
  const size = delta(spec.sizeDelta, 'sizeDelta')
  const spacing = delta(spec.lineSpacingDelta, 'lineSpacingDelta')
  const live = [
    ...repeat(size > 0 ? 'format:font-size-increase' : 'format:font-size-decrease', Math.abs(size)),
    ...repeat(
      spacing > 0 ? 'format:line-spacing-increase' : 'format:line-spacing-decrease',
      Math.abs(spacing),
    ),
  ]
  const hasChar = Object.keys(char).length > 0
  let para: ParaFormatProps | null = null
  if (spec.align) {
    if (hasChar) para = { alignment: spec.align }
    else live.push(ALIGN_COMMANDS[spec.align])
  }
  if (!hasChar && live.length === 0 && !para) {
    throw new ToolError(
      'format must contain at least one attribute (bold, italic, underline, strike, superscript, subscript, color, fontSize, align, sizeDelta, lineSpacingDelta, clear)',
      'invalid argument',
    )
  }
  return { live, char: hasChar ? char : null, para }
}
