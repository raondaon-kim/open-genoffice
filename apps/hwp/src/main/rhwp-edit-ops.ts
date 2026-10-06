import type { CharFormatProps, EditOp, ParaAlignment, ParaFormatProps } from '../shared/ai-contract'

/**
 * Turns renderer-supplied edit ops into `rhwp edit` invocations. Validation
 * lives here (the renderer is not trusted with argv): coordinates are
 * non-negative safe integers, texts are single-line where the CLI requires
 * it, format props are limited to the keys rhwp actually honours (unknown
 * keys are silently ignored by the CLI — spec §14 — so we reject them).
 *
 * Facts this compiler encodes (contract test: rhwp-cli.contract.test.ts):
 *  - `insert-paragraph --para N` inserts BEFORE N → "after P" is `--para P+1`
 *  - `delete-text --count` clamps at the paragraph end → whole-paragraph clear
 *  - header/footer text requires the header to exist; creating it twice fails
 *    with exit 1 "이미 … 존재" → the create step is tolerated
 *  - `insert-footnote-text --ctrl 0` addresses the first footnote of the paragraph
 */

export interface CompiledStep {
  /** index into the source `ops` array */
  opIndex: number
  /** `rhwp edit <command>` */
  command: string
  /** flags between the input path and `-o` */
  flags: string[]
  /** exit-1 stderr pattern that turns a failure of this step into a no-op */
  tolerate?: RegExp
}

export type CompileResult =
  { ok: true; steps: CompiledStep[] } | { ok: false; index: number; error: string }

export const MAX_EDIT_OPS = 20
/** larger than any paragraph; rhwp clamps it to the paragraph length */
export const DELETE_ALL_COUNT = 1_000_000

const CHAR_BOOL_KEYS = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'superscript',
  'subscript',
] as const
const ALIGNMENTS: readonly ParaAlignment[] = [
  'left',
  'center',
  'right',
  'justify',
  'distribute',
  'division',
]

class OpError extends Error {}

type Raw = Record<string, unknown>

function record(value: unknown): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OpError('op must be an object')
  return value as Raw
}

function index(raw: Raw, key: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const value = raw[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new OpError(`${key} must be an integer in [${min}, ${max}]`)
  }
  return value
}

function text(
  raw: Raw,
  key: string,
  opts: { allowEmpty?: boolean; singleLine?: boolean; hint?: string } = {},
): string {
  const value = raw[key]
  if (typeof value !== 'string') throw new OpError(`${key} must be a string`)
  if (!opts.allowEmpty && value.length === 0) throw new OpError(`${key} must not be empty`)
  if (opts.singleLine && /[\n\r\t]/.test(value)) {
    throw new OpError(
      `${key} must not contain newline or tab characters${opts.hint ? ` — ${opts.hint}` : ''}`,
    )
  }
  return value
}

function optBool(raw: Raw, key: string): boolean {
  const value = raw[key]
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new OpError(`${key} must be a boolean`)
  return value
}

const n = (value: number) => String(value)
const at = (raw: Raw) => [
  '--section',
  n(index(raw, 'section')),
  '--para',
  n(index(raw, 'paragraph')),
]
const atOffset = (raw: Raw) => [...at(raw), '--offset', n(index(raw, 'charOffset'))]
const cell = (raw: Raw) => [
  '--table',
  n(index(raw, 'table')),
  '--row',
  n(index(raw, 'row')),
  '--col',
  n(index(raw, 'col')),
]

function charProps(raw: unknown): CharFormatProps {
  const props = record(raw)
  const out: CharFormatProps = {}
  for (const key of Object.keys(props)) {
    if ((CHAR_BOOL_KEYS as readonly string[]).includes(key)) {
      if (typeof props[key] !== 'boolean') throw new OpError(`props.${key} must be a boolean`)
      out[key as (typeof CHAR_BOOL_KEYS)[number]] = props[key] as boolean
    } else if (key === 'textColor') {
      const color = props[key]
      if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        throw new OpError('props.textColor must be #rrggbb (rhwp ignores color names)')
      }
      out.textColor = color.toUpperCase()
    } else if (key === 'fontSize') {
      const size = props[key]
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > 200) {
        throw new OpError('props.fontSize must be an integer point size in [1, 200]')
      }
      // the engine takes 1/100 pt (1300 = 13 pt); the tool contract is whole points
      out.fontSize = size * 100
    } else {
      throw new OpError(`props.${key} is not a supported character format (rhwp would ignore it)`)
    }
  }
  if (Object.keys(out).length === 0) throw new OpError('props must contain at least one format')
  return out
}

function paraProps(raw: unknown): ParaFormatProps {
  const props = record(raw)
  const out: ParaFormatProps = {}
  for (const key of Object.keys(props)) {
    if (key === 'alignment') {
      const value = props[key]
      if (typeof value !== 'string' || !ALIGNMENTS.includes(value as ParaAlignment)) {
        throw new OpError(`props.alignment must be one of ${ALIGNMENTS.join('|')}`)
      }
      out.alignment = value as ParaAlignment
    } else if (key === 'lineSpacing') {
      const value = props[key]
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 50 || value > 400) {
        throw new OpError('props.lineSpacing must be an integer percent in [50, 400]')
      }
      out.lineSpacing = value
    } else {
      throw new OpError(`props.${key} is not a supported paragraph format (rhwp would ignore it)`)
    }
  }
  if (Object.keys(out).length === 0) throw new OpError('props must contain at least one format')
  return out
}

type Compiler = (raw: Raw) => Array<Omit<CompiledStep, 'opIndex'>>

const COMPILERS: Record<EditOp['op'], Compiler> = {
  replace_phrase: (raw) => {
    const find = text(raw, 'find')
    const replace = text(raw, 'replace', { allowEmpty: true })
    const occurrence = raw.occurrence === undefined ? undefined : index(raw, 'occurrence', 1)
    return [
      {
        command: 'replace-text',
        flags: [
          '--find',
          find,
          '--replace',
          replace,
          ...(occurrence === undefined ? [] : ['--occurrence', n(occurrence)]),
        ],
      },
    ]
  },
  set_paragraph_text: (raw) => {
    const body = text(raw, 'text', {
      allowEmpty: true,
      singleLine: true,
      hint: 'use insert_paragraph_after for additional paragraphs',
    })
    const where = at(raw)
    const steps: Array<Omit<CompiledStep, 'opIndex'>> = [
      {
        command: 'delete-text',
        flags: [...where, '--offset', '0', '--count', n(DELETE_ALL_COUNT)],
      },
    ]
    if (body.length > 0)
      steps.push({ command: 'insert-text', flags: [...where, '--offset', '0', '--text', body] })
    return steps
  },
  insert_paragraph_after: (raw) => {
    const body = text(raw, 'text', {
      allowEmpty: true,
      singleLine: true,
      hint: 'one paragraph per op',
    })
    const section = n(index(raw, 'section'))
    const target = n(index(raw, 'paragraph') + 1)
    const steps: Array<Omit<CompiledStep, 'opIndex'>> = [
      { command: 'insert-paragraph', flags: ['--section', section, '--para', target] },
    ]
    if (body.length > 0) {
      steps.push({
        command: 'insert-text',
        flags: ['--section', section, '--para', target, '--offset', '0', '--text', body],
      })
    }
    return steps
  },
  delete_paragraph: (raw) => [{ command: 'delete-paragraph', flags: at(raw) }],
  set_cell: (raw) => [
    {
      command: 'set-cell',
      flags: [...cell(raw), '--text', text(raw, 'text', { allowEmpty: true, singleLine: true })],
    },
  ],
  insert_row: (raw) => [
    {
      command: 'insert-row',
      flags: [
        '--table',
        n(index(raw, 'table')),
        '--row',
        n(index(raw, 'row')),
        ...(optBool(raw, 'below') ? ['--below'] : []),
      ],
    },
  ],
  insert_col: (raw) => [
    {
      command: 'insert-col',
      flags: [
        '--table',
        n(index(raw, 'table')),
        '--col',
        n(index(raw, 'col')),
        ...(optBool(raw, 'right') ? ['--right'] : []),
      ],
    },
  ],
  delete_row: (raw) => [
    {
      command: 'delete-row',
      flags: ['--table', n(index(raw, 'table')), '--row', n(index(raw, 'row'))],
    },
  ],
  delete_col: (raw) => [
    {
      command: 'delete-col',
      flags: ['--table', n(index(raw, 'table')), '--col', n(index(raw, 'col'))],
    },
  ],
  merge_cells: (raw) => [
    {
      command: 'merge-cells',
      flags: [
        ...cell(raw),
        '--end-row',
        n(index(raw, 'endRow')),
        '--end-col',
        n(index(raw, 'endCol')),
      ],
    },
  ],
  split_cell: (raw) => [{ command: 'split-cell', flags: cell(raw) }],
  insert_table: (raw) => [
    {
      command: 'insert-table',
      flags: [
        '--rows',
        n(index(raw, 'rows', 1)),
        '--cols',
        n(index(raw, 'cols', 1, 256)),
        ...at(raw),
        '--offset',
        '0',
      ],
    },
  ],
  delete_table: (raw) => [{ command: 'delete-table', flags: ['--table', n(index(raw, 'table'))] }],
  insert_footnote: (raw) => {
    const steps: Array<Omit<CompiledStep, 'opIndex'>> = [
      { command: 'insert-footnote', flags: atOffset(raw) },
    ]
    if (raw.text !== undefined) {
      steps.push({
        command: 'insert-footnote-text',
        flags: [...at(raw), '--ctrl', '0', '--text', text(raw, 'text', { singleLine: true })],
      })
    }
    return steps
  },
  insert_endnote: (raw) => [{ command: 'insert-endnote', flags: atOffset(raw) }],
  insert_page_break: (raw) => [{ command: 'insert-page-break', flags: atOffset(raw) }],
  insert_column_break: (raw) => [{ command: 'insert-column-break', flags: atOffset(raw) }],
  header_text: (raw) => headerFooter(raw, '--header'),
  footer_text: (raw) => headerFooter(raw, '--footer'),
  add_bookmark: (raw) => {
    const name = text(raw, 'name')
    if (!/\S/.test(name)) throw new OpError('name must contain a non-space character')
    return [{ command: 'add-bookmark', flags: ['--name', name, ...atOffset(raw)] }]
  },
  fill_fields: (raw) => {
    const data = record(raw.data)
    const entries = Object.entries(data)
    if (entries.length === 0) throw new OpError('data must not be empty')
    for (const [key, value] of entries) {
      if (typeof value !== 'string') throw new OpError(`data["${key}"] must be a string`)
    }
    return [{ command: 'fill-fields', flags: ['--data', JSON.stringify(data)] }]
  },
  apply_char_format: (raw) => [
    {
      command: 'apply-char-format',
      flags: ['--props', JSON.stringify(charProps(raw.props)), ...at(raw)],
    },
  ],
  apply_para_format: (raw) => [
    {
      command: 'apply-para-format',
      flags: ['--props', JSON.stringify(paraProps(raw.props)), ...at(raw)],
    },
  ],
}

function headerFooter(
  raw: Raw,
  which: '--header' | '--footer',
): Array<Omit<CompiledStep, 'opIndex'>> {
  const section = n(index(raw, 'section'))
  const body = text(raw, 'text', { singleLine: true })
  return [
    { command: 'insert-header-footer', flags: [which, '--section', section], tolerate: /이미/ },
    { command: 'insert-header-footer-text', flags: [which, '--section', section, '--text', body] },
  ]
}

export function compileEditOps(ops: unknown): CompileResult {
  if (!Array.isArray(ops)) return { ok: false, index: -1, error: 'ops must be an array' }
  if (ops.length === 0) return { ok: false, index: -1, error: 'ops must contain at least one op' }
  if (ops.length > MAX_EDIT_OPS) {
    return {
      ok: false,
      index: -1,
      error: `at most ${MAX_EDIT_OPS} ops per edit (got ${ops.length})`,
    }
  }
  const steps: CompiledStep[] = []
  for (let i = 0; i < ops.length; i++) {
    try {
      const raw = record(ops[i])
      const name = raw.op
      if (typeof name !== 'string' || !Object.hasOwn(COMPILERS, name)) {
        throw new OpError(`unknown op "${String(name)}"`)
      }
      for (const step of COMPILERS[name as EditOp['op']](raw)) steps.push({ opIndex: i, ...step })
    } catch (err) {
      if (err instanceof OpError) return { ok: false, index: i, error: err.message }
      throw err
    }
  }
  return { ok: true, steps }
}
