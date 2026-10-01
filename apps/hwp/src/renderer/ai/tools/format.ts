import type { AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import type { EditOp } from '../../../shared/ai-contract'
import type { EditorLike, HwpAiContext, ToolModule } from '../context'
import { intArg, record, requireEditor, staleCoordinates, ToolError, toExecution } from '../errors'
import { planFormat } from '../router'
import type { FormatSpec } from '../router'
import { applyFileEdit, summarizeEdit } from './edit'

const MAX_FIELDS = 100

const tools: AgentToolDef[] = [
  {
    name: 'apply_format',
    description:
      'Format one whole body paragraph. target: {section, paragraph, length} from find. format: bold/italic/underline/strike/superscript/subscript (true/false, absolute), color "#rrggbb", fontSize (points), align (left|center|right|justify|distribute|division), sizeDelta / lineSpacingDelta (steps, -10..10), clear (reset character formatting). Absolute attributes are applied as a verified file edit; relative steps and plain alignment run live. One undo unit either way.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'object',
          properties: {
            section: { type: 'integer' },
            paragraph: { type: 'integer' },
            length: { type: 'integer' },
          },
          required: ['section', 'paragraph'],
        },
        format: {
          type: 'object',
          properties: {
            bold: { type: 'boolean' },
            italic: { type: 'boolean' },
            underline: { type: 'boolean' },
            strike: { type: 'boolean' },
            superscript: { type: 'boolean' },
            subscript: { type: 'boolean' },
            color: { type: 'string' },
            fontSize: { type: 'integer' },
            align: {
              type: 'string',
              enum: ['left', 'center', 'right', 'justify', 'distribute', 'division'],
            },
            sizeDelta: { type: 'integer' },
            lineSpacingDelta: { type: 'integer' },
            clear: { type: 'boolean' },
          },
        },
      },
      required: ['target', 'format'],
    },
  },
  {
    name: 'fill_fields',
    description:
      'Fill form fields (누름틀) by exact name from list_fields: data = {"필드이름": "값", …}. A repeated name is addressed as "이름[1]" (0-based order from list_fields). Fields the live control cannot set are filled through the engine as a file edit.',
    inputSchema: {
      type: 'object',
      properties: { data: { type: 'object', additionalProperties: { type: 'string' } } },
      required: ['data'],
    },
  },
]

async function ensureHwpctrl(editor: EditorLike): Promise<void> {
  const listed = await editor.plugins.list()
  if (!listed.some((plugin) => plugin.id === 'hwpctrl' && plugin.active))
    await editor.plugins.load('hwpctrl')
}

/**
 * the file phase after a live phase that shares its undo entry (pushed by the
 * caller). On failure: nothing ran live → drop that entry (it would otherwise
 * undo the user's later typing); something ran live → keep it and say so.
 */
async function filePhase(
  ctx: HwpAiContext,
  ops: EditOp[],
  appliedLive: string[],
): Promise<Awaited<ReturnType<typeof applyFileEdit>>> {
  try {
    // apply_format checked its coordinates before the live phase moved the document
    return await applyFileEdit(ctx, ops, { skipPush: true, skipReadCheck: true })
  } catch (err) {
    if (appliedLive.length === 0) {
      ctx.stack.pop()
      throw err
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new ToolError(
      `${message.replace(/ — nothing was applied\./, '.')} Already applied live: ${appliedLive.join(', ')} (undo_ai_edit reverts them).`,
      err instanceof ToolError ? err.summary : 'failed',
    )
  }
}

/** a live AI change: unsaved for the user, and known to the model (its coordinates stay valid) */
async function noteAiChange(ctx: HwpAiContext, editor: EditorLike): Promise<void> {
  ctx.markAiDirty()
  const sha = (await editor.getDocumentState()).documentSha256
  ctx.stack.noteRead(sha)
  ctx.stack.sealTop(sha)
}

async function applyFormat(
  ctx: HwpAiContext,
  input: Record<string, unknown>,
): Promise<ToolExecution> {
  const editor = requireEditor(ctx)
  const target = record(input.target, 'target')
  const section = intArg(target, 'section', { min: 0 })
  const paragraph = intArg(target, 'paragraph', { min: 0 })
  const length = intArg(target, 'length', { min: 1, fallback: 1 })
  const plan = planFormat(record(input.format, 'format') as FormatSpec)

  // one undo unit for both phases: the pre-format bytes
  const snapshot = await ctx.stack.capture(editor)
  if (ctx.stack.coordinatesStale(snapshot.sha)) throw staleCoordinates()
  ctx.stack.push(snapshot)
  const applied: string[] = []
  if (plan.live.length > 0) {
    const focus = await editor.focusTarget({
      kind: 'body_paragraph',
      section,
      paragraph,
      charOffset: 0,
      length,
    })
    if (!focus.focused) {
      ctx.stack.pop()
      throw new ToolError(
        'Target paragraph not found — the coordinates are stale. Run find again and retry.',
        'target not found',
      )
    }
    for (const id of plan.live) {
      const result = await editor.commands.execute(id)
      if (!result.ok) {
        if (applied.length > 0) await noteAiChange(ctx, editor)
        else ctx.stack.pop()
        throw new ToolError(
          `The editor refused ${id}: ${result.reason}${result.message ? ` — ${result.message}` : ''}. Already applied live: ${applied.join(', ') || 'nothing'} (undo_ai_edit reverts them).`,
          'command refused',
        )
      }
      applied.push(id)
    }
    await noteAiChange(ctx, editor)
  }
  let fileSummary = ''
  if (plan.char || plan.para) {
    const ops: EditOp[] = []
    if (plan.char) ops.push({ op: 'apply_char_format', section, paragraph, props: plan.char })
    if (plan.para) ops.push({ op: 'apply_para_format', section, paragraph, props: plan.para })
    const { result, focused } = await filePhase(ctx, ops, applied)
    fileSummary = summarizeEdit(ops, result, focused)
  }
  return {
    output: [
      `Formatted paragraph ${paragraph} (section ${section}).`,
      applied.length ? `Live commands: ${applied.join(', ')} — the user can also press ⌘Z.` : '',
      fileSummary || 'The change is unsaved — the user saves with ⌘S; undo_ai_edit reverts it.',
    ]
      .filter(Boolean)
      .join('\n'),
    mutated: true,
    summary: `paragraph ${paragraph} formatted`,
  }
}

async function fillFields(
  ctx: HwpAiContext,
  input: Record<string, unknown>,
): Promise<ToolExecution> {
  const editor = requireEditor(ctx)
  const data = record(input.data, 'data')
  const entries = Object.entries(data)
  if (entries.length === 0) throw new ToolError('data must not be empty', 'invalid argument')
  if (entries.length > MAX_FIELDS)
    throw new ToolError(`at most ${MAX_FIELDS} fields per call`, 'invalid argument')
  for (const [name, value] of entries) {
    if (typeof value !== 'string')
      throw new ToolError(`data["${name}"] must be a string`, 'invalid argument')
  }
  const snapshot = await ctx.stack.capture(editor)
  ctx.stack.push(snapshot)
  await ensureHwpctrl(editor)
  const live: string[] = []
  const refused: string[] = []
  for (const [name, value] of entries) {
    const ok = await editor.hwpctrl.call('PutFieldText', [name, value])
    if (ok === false) refused.push(name)
    else live.push(name)
  }
  if (live.length > 0) await noteAiChange(ctx, editor)
  if (refused.length === 0) {
    return {
      output: `Filled ${live.length} field(s): ${live.join(', ')}. The change is unsaved — the user saves with ⌘S; undo_ai_edit reverts it.`,
      mutated: true,
      summary: `${live.length} field(s) filled`,
    }
  }
  const rest = Object.fromEntries(entries.filter(([name]) => refused.includes(name))) as Record<
    string,
    string
  >
  const ops: EditOp[] = [{ op: 'fill_fields', data: rest }]
  const { result, focused } = await filePhase(ctx, ops, live)
  return {
    output: [
      live.length ? `Filled live: ${live.join(', ')}.` : '',
      `Filled through the engine: ${refused.join(', ')}.`,
      summarizeEdit(ops, result, focused),
    ]
      .filter(Boolean)
      .join('\n'),
    mutated: true,
    summary: `${entries.length} field(s) filled`,
  }
}

export const formatTools: ToolModule = {
  tools,
  async execute(ctx, call) {
    const input = record(call.input ?? {}, 'input')
    switch (call.name) {
      case 'apply_format':
        return applyFormat(ctx, input)
      case 'fill_fields':
        return fillFields(ctx, input)
      default:
        throw new ToolError(`Unknown format tool: ${call.name}`, 'unknown tool')
    }
  },
}

const raw = formatTools.execute
formatTools.execute = (ctx, call) => raw(ctx, call).catch(toExecution)
