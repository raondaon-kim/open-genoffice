import type { AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import type { AiEditResult, EditOp } from '../../../shared/ai-contract'
import type { HwpAiContext, ToolModule } from '../context'
import { intArg, optStrArg, record, requireEditor, strArg, ToolError, toExecution } from '../errors'
import { withFence } from '../fence'
import { ensureSnapshot } from '../snapshots'

export const TEXT_OPS = [
  'replace_phrase',
  'set_paragraph_text',
  'insert_paragraph_after',
  'delete_paragraph',
] as const
export const TABLE_OPS = [
  'set_cell',
  'insert_row',
  'insert_col',
  'delete_row',
  'delete_col',
  'merge_cells',
  'split_cell',
  'insert_table',
] as const
export const ELEMENT_KINDS = [
  'footnote',
  'endnote',
  'page_break',
  'column_break',
  'header_text',
  'footer_text',
  'bookmark',
] as const
const MAX_OPS = 20

type Ok = Extract<AiEditResult, { ok: true }>
type Rec = Record<string, unknown>

/** the reloaded bytes are HWPX whatever the file on disk is called */
export function snapshotFileName(name: string): string {
  return `${name.replace(/\.(hwp|hwpx)$/i, '')}.hwpx`
}

const OP_DOC = `Coordinates are 0-based engine coordinates from find / get_document_overview / read_table. Text arguments are single paragraphs (no newlines).`

const tools: AgentToolDef[] = [
  {
    name: 'edit_text',
    description: `Edit existing body text as one batch (one reload). ops: replace_phrase {find, replace, occurrence?} — document-wide replace (body and table cells; occurrence = only the k-th hit, 1-based); set_paragraph_text {section, paragraph, text} — replace a whole paragraph's text (keeps its formatting; empty text clears it); insert_paragraph_after {section, paragraph, text} — new paragraph below (inherits formatting); delete_paragraph {section, paragraph}. ${OP_DOC} Later ops see earlier ops' paragraph shifts; batch top-down or use replace_phrase.`,
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_OPS,
          items: {
            type: 'object',
            properties: { op: { type: 'string', enum: [...TEXT_OPS] } },
            required: ['op'],
          },
        },
      },
      required: ['ops'],
    },
  },
  {
    name: 'edit_table',
    description: `Edit tables as one batch (one reload). ops: set_cell {table, row, col, text} (merged cells are addressed by their anchor cell); insert_row {table, row, below?}; insert_col {table, col, right?}; delete_row {table, row}; delete_col {table, col}; merge_cells {table, row, col, endRow, endCol}; split_cell {table, row, col}; insert_table {section, paragraph, rows, cols} — new empty table at that paragraph. ${OP_DOC}`,
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_OPS,
          items: {
            type: 'object',
            properties: { op: { type: 'string', enum: [...TABLE_OPS] } },
            required: ['op'],
          },
        },
      },
      required: ['ops'],
    },
  },
  {
    name: 'insert_element',
    description: `Insert one non-text element. kind: footnote (text optional — goes to the paragraph's first footnote), endnote, page_break, column_break (all at {section, paragraph, charOffset?}), header_text / footer_text (text required; appended to the section's header/footer, created if missing — at.section only), bookmark (name required). ${OP_DOC}`,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...ELEMENT_KINDS] },
        at: {
          type: 'object',
          properties: {
            section: { type: 'integer' },
            paragraph: { type: 'integer' },
            charOffset: { type: 'integer' },
          },
          required: ['section'],
        },
        text: { type: 'string' },
        name: { type: 'string', description: 'bookmark name' },
      },
      required: ['kind', 'at'],
    },
  },
  {
    name: 'undo_ai_edit',
    description:
      'Revert the most recent AI edit in this tab (file edits, formatting and field fills alike, one unit per tool call). Repeat to go further back. The user can also press ⌘Z for live formatting.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function describeFailure(result: Extract<AiEditResult, { ok: false }>): string {
  const where = result.failedOp === null ? 'Edit could not start' : `op ${result.failedOp} failed`
  return `${where}: ${result.error}${result.journal.length ? ` (${result.journal.length} earlier op(s) had run on the temp copy — nothing reached the document)` : ''}`
}

function firstParagraph(ops: EditOp[]): { section: number; paragraph: number } | null {
  for (const op of ops) {
    if ('paragraph' in op && 'section' in op)
      return { section: op.section, paragraph: op.paragraph }
  }
  return null
}

export function summarizeEdit(ops: EditOp[], result: Ok, focused: boolean): string {
  const lines = result.journal.map((entry) => {
    const envelope = (entry.envelope ?? {}) as Rec
    const bits: string[] = []
    if (entry.tolerated) bits.push('skipped — already present')
    if (entry.noop) bits.push('no change')
    for (const key of [
      'replacedCount',
      'insertedChars',
      'overflow',
      'filledCount',
      'notFound',
      'ambiguous',
    ] as const) {
      const value = envelope[key]
      if (value === undefined || (Array.isArray(value) && value.length === 0)) continue
      bits.push(`${key}=${JSON.stringify(value)}`)
    }
    return `- op ${entry.opIndex} ${entry.op} → ${entry.command}${bits.length ? ` (${bits.join(', ')})` : ''}`
  })
  const pages = result.changedPages.map((p) => p + 1)
  return [
    `Applied ${ops.length} op(s); ${result.diffCount ?? '?'} IR change(s); pages touched: ${pages.length ? pages.join(', ') : 'none reported'}.`,
    ...lines,
    focused ? 'The view moved to the first edited paragraph.' : '',
    'The document was reloaded with the change and is unsaved — the user saves with ⌘S. undo_ai_edit reverts this whole edit. Paragraph indices may have shifted: run find again before further edits.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * snapshot → main edit chain → SHA fence → reload. `skipPush` when the caller
 * already pushed the pre-edit snapshot (live phase of apply_format).
 */
export async function applyFileEdit(
  ctx: HwpAiContext,
  ops: EditOp[],
  opts: { skipPush?: boolean } = {},
): Promise<{ result: Ok; focused: boolean }> {
  const editor = requireEditor(ctx)
  const api = ctx.api()
  const fenced = await withFence(editor, async () => {
    const snapshot = await ensureSnapshot(editor, ctx.stack, api)
    return { snapshot, result: await api.aiEdit({ sha: snapshot.sha, ops }) }
  })
  if (!fenced.ok) {
    throw new ToolError(
      'The document changed while the edit was being prepared — nothing was applied. Read the target again and retry.',
      'document changed',
    )
  }
  const { snapshot, result } = fenced.value
  if (!result.ok) {
    throw new ToolError(
      describeFailure(result),
      result.failedOp === null ? 'edit unavailable' : `op ${result.failedOp} failed`,
    )
  }
  if (!opts.skipPush) ctx.stack.push(snapshot)
  const bytes = new Uint8Array(result.data)
  const fileName = snapshotFileName(ctx.fileName())
  try {
    await editor.loadFile(bytes, fileName, { skipUnsavedGuard: true })
  } catch (err) {
    if (!opts.skipPush) ctx.stack.pop()
    try {
      await editor.loadFile(snapshot.bytes, fileName, { skipUnsavedGuard: true })
    } catch {
      /* the studio keeps whatever it has; the error below tells the user */
    }
    throw new ToolError(
      `Reloading the edited document failed: ${err instanceof Error ? err.message : String(err)} — the previous content was restored.`,
      'reload failed',
    )
  }
  ctx.stack.noteLoaded({ sha: result.outputSha, bytes })
  ctx.stack.markSent(result.outputSha)
  ctx.markAiDirty()
  let focused = false
  const target = firstParagraph(ops)
  if (target) {
    try {
      focused = (
        await editor.focusTarget({ kind: 'body_paragraph', ...target, charOffset: 0, length: 1 })
      ).focused
    } catch {
      focused = false
    }
  }
  return { result, focused }
}

export async function undoAiEdit(ctx: HwpAiContext): Promise<ToolExecution> {
  const editor = requireEditor(ctx)
  const snapshot = ctx.stack.pop()
  if (!snapshot)
    return {
      output: 'Nothing to undo — no AI edit has been applied in this tab.',
      summary: 'nothing to undo',
    }
  try {
    await editor.loadFile(snapshot.bytes, snapshotFileName(ctx.fileName()), {
      skipUnsavedGuard: true,
    })
  } catch (err) {
    ctx.stack.push(snapshot)
    throw new ToolError(
      `Undo failed: ${err instanceof Error ? err.message : String(err)}`,
      'undo failed',
    )
  }
  ctx.stack.noteLoaded(snapshot)
  ctx.markAiDirty()
  return {
    output: `Reverted the last AI edit (${ctx.stack.depth} more can be undone). The document is unsaved — ⌘S saves it.`,
    mutated: true,
    summary: 'AI edit reverted',
  }
}

function opsArg(input: Rec, allowed: readonly string[], other: string): EditOp[] {
  const ops = input.ops
  if (!Array.isArray(ops) || ops.length === 0)
    throw new ToolError('ops must be a non-empty array', 'invalid argument')
  if (ops.length > MAX_OPS)
    throw new ToolError(`at most ${MAX_OPS} ops per call (got ${ops.length})`, 'invalid argument')
  ops.forEach((op, i) => {
    const name = record(op, `ops[${i}]`).op
    if (typeof name !== 'string' || !allowed.includes(name)) {
      throw new ToolError(
        `ops[${i}].op "${String(name)}" is not allowed here — this tool takes ${allowed.join(', ')}; ${other} covers the rest.`,
        'invalid argument',
      )
    }
  })
  return ops as EditOp[]
}

function elementOp(input: Rec): EditOp {
  const kind = strArg(input, 'kind')
  const at = record(input.at, 'at')
  const section = intArg(at, 'section', { min: 0 })
  const text = optStrArg(input, 'text')
  if (kind === 'header_text' || kind === 'footer_text') {
    if (!text) throw new ToolError(`${kind} needs text`, 'invalid argument')
    return { op: kind, section, text }
  }
  const paragraph = intArg(at, 'paragraph', { min: 0 })
  const charOffset = intArg(at, 'charOffset', { min: 0, fallback: 0 })
  switch (kind) {
    case 'footnote':
      return { op: 'insert_footnote', section, paragraph, charOffset, ...(text ? { text } : {}) }
    case 'endnote':
      return { op: 'insert_endnote', section, paragraph, charOffset }
    case 'page_break':
      return { op: 'insert_page_break', section, paragraph, charOffset }
    case 'column_break':
      return { op: 'insert_column_break', section, paragraph, charOffset }
    case 'bookmark': {
      const name = optStrArg(input, 'name')
      if (!name || !/\S/.test(name))
        throw new ToolError('bookmark needs a name', 'invalid argument')
      return { op: 'add_bookmark', section, paragraph, charOffset, name }
    }
    default:
      throw new ToolError(`kind must be one of ${ELEMENT_KINDS.join(', ')}`, 'invalid argument')
  }
}

async function runOps(ctx: HwpAiContext, ops: EditOp[], label: string): Promise<ToolExecution> {
  const { result, focused } = await applyFileEdit(ctx, ops)
  return {
    output: summarizeEdit(ops, result, focused),
    mutated: true,
    summary: `${label}: ${ops.length} op(s) applied`,
  }
}

export const editTools: ToolModule = {
  tools,
  async execute(ctx, call) {
    const input = record(call.input ?? {}, 'input')
    switch (call.name) {
      case 'edit_text':
        return runOps(ctx, opsArg(input, TEXT_OPS, 'edit_table'), 'text edited')
      case 'edit_table':
        return runOps(ctx, opsArg(input, TABLE_OPS, 'edit_text'), 'table edited')
      case 'insert_element':
        return runOps(ctx, [elementOp(input)], 'element inserted')
      case 'undo_ai_edit':
        return undoAiEdit(ctx)
      default:
        throw new ToolError(`Unknown edit tool: ${call.name}`, 'unknown tool')
    }
  },
}

const raw = editTools.execute
editTools.execute = (ctx, call) => raw(ctx, call).catch(toExecution)
