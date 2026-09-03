import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import type { RhwpEditor } from '@rhwp/editor'

/** Text cap per read_pages fed back to the model (the payload is resent each turn) */
const READ_CHUNK_CHARS = 24_000

/** Capability surface the App provides to AI tools; getters because the loop outlives render closures */
export interface HwpAiDeps {
  editor(): RhwpEditor | null
  fileName(): string
}

async function ensureHwpctrl(editor: RhwpEditor): Promise<void> {
  const listed = await editor.plugins.list()
  if (!listed.some((plugin) => plugin.id === 'hwpctrl' && plugin.active)) {
    await editor.plugins.load('hwpctrl')
  }
}

/** Call a method on the embedded Hangul-compatible control (hwpctl plugin). */
async function hwpCall(editor: RhwpEditor, method: string, ...args: unknown[]): Promise<unknown> {
  await ensureHwpctrl(editor)
  return editor.hwpctrl.call(method, args)
}

/** Extract readable text from a rendered page SVG in document order. */
function svgToText(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const lines: string[] = []
  for (const node of doc.querySelectorAll('text')) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

function textResult(text: string): ToolExecution {
  const clipped = text.length > READ_CHUNK_CHARS
  return {
    output: clipped ? `${text.slice(0, READ_CHUNK_CHARS)}\n[truncated]` : text,
    summary: `${text.length} chars read`,
  }
}

function errorResult(err: unknown): ToolExecution {
  return {
    output: err instanceof Error ? err.message : String(err),
    isError: true,
    summary: 'failed',
  }
}

function intArg(call: AgentToolCall, key: string, fallback?: number): number {
  const value = (call.input as Record<string, unknown>)[key]
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (fallback !== undefined) return fallback
  throw new Error(`${key} must be an integer`)
}

function strArg(call: AgentToolCall, key: string): string {
  const value = (call.input as Record<string, unknown>)[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string`)
}

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: 'read_pages',
    description:
      'Read the text content of a page range of the open Hangul document (with [Page N] markers). Read the relevant pages before answering; at most 10 pages per call, over-long output is truncated.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'integer', description: 'Start page number (1-based)' },
        end: {
          type: 'integer',
          description: 'End page number (inclusive); if omitted, only the start page is read',
        },
      },
      required: ['start'],
    },
  },
  {
    name: 'get_document_state',
    description:
      'Get the current document state: file format (hwp/hwpx), page count, and unsaved-changes flag.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_fields',
    description:
      'List the fillable form fields (누름틀) in the document. Call this before fill_field to learn the exact field names.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'fill_field',
    description:
      'Fill one form field (누름틀) with text. Use exact field names from list_fields. Changes are unsaved until the user presses ⌘S.',
    inputSchema: {
      type: 'object',
      properties: {
        field: { type: 'string', description: 'Exact field name from list_fields' },
        text: { type: 'string', description: 'Replacement text for the field' },
      },
      required: ['field', 'text'],
    },
  },
  {
    name: 'get_table_cell',
    description:
      'Read the text of one table cell. tablePara is the paragraph index of the table in the body; row and col are 0-based.',
    inputSchema: {
      type: 'object',
      properties: {
        tablePara: { type: 'integer', description: 'Body paragraph index of the table' },
        row: { type: 'integer', description: 'Row index (0-based)' },
        col: { type: 'integer', description: 'Column index (0-based)' },
        colCount: { type: 'integer', description: 'Total column count of the table' },
      },
      required: ['tablePara', 'row', 'col', 'colCount'],
    },
  },
  {
    name: 'set_table_cell',
    description:
      'Replace the text of one table cell (existing cell text is replaced in full). Changes are unsaved until the user presses ⌘S.',
    inputSchema: {
      type: 'object',
      properties: {
        tablePara: { type: 'integer', description: 'Body paragraph index of the table' },
        row: { type: 'integer', description: 'Row index (0-based)' },
        col: { type: 'integer', description: 'Column index (0-based)' },
        colCount: { type: 'integer', description: 'Total column count of the table' },
        text: { type: 'string', description: 'New cell text' },
      },
      required: ['tablePara', 'row', 'col', 'colCount', 'text'],
    },
  },
  {
    name: 'insert_text_at',
    description:
      'Insert text at the start of a body paragraph (caret is moved to the paragraph first). section and paragraph are 0-based indices. For replacing a paragraph, read it first and tell the user when a full replace is not possible.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'integer', description: 'Section index (0-based)' },
        paragraph: { type: 'integer', description: 'Paragraph index within the section (0-based)' },
        text: { type: 'string', description: 'Text to insert at the paragraph start' },
      },
      required: ['section', 'paragraph', 'text'],
    },
  },
]

export async function executeHwpTool(deps: HwpAiDeps, call: AgentToolCall): Promise<ToolExecution> {
  const editor = deps.editor()
  if (!editor) return { output: 'The document is not open yet.', isError: true, summary: 'no document' }
  try {
    switch (call.name) {
      case 'read_pages': {
        const state = await editor.getDocumentState()
        const start = Math.max(1, intArg(call, 'start'))
        const end = Math.min(state.pageCount, start + 9, Math.max(start, intArg(call, 'end', start)))
        const parts: string[] = []
        for (let page = start; page <= end; page++) {
          const svg = await editor.getPageSvg(page - 1)
          parts.push(`[Page ${page}]\n${svgToText(svg)}`)
        }
        return textResult(parts.join('\n\n'))
      }
      case 'get_document_state': {
        const state = await editor.getDocumentState()
        return {
          output: JSON.stringify(
            {
              format: state.format,
              pageCount: state.pageCount,
              dirty: state.dirty,
              changeSeq: state.changeSeq,
            },
            null,
            2,
          ),
          summary: `${state.format}, ${state.pageCount} page(s)`,
        }
      }
      case 'list_fields': {
        const fields = await hwpCall(editor, 'GetFieldList')
        return {
          output: typeof fields === 'string' ? fields : JSON.stringify(fields ?? [], null, 2),
          summary: 'form fields listed',
        }
      }
      case 'fill_field': {
        const field = strArg(call, 'field')
        const text = strArg(call, 'text')
        await hwpCall(editor, 'PutFieldText', field, text)
        return { output: `Field "${field}" filled.`, mutated: true, summary: `filled "${field}"` }
      }
      case 'get_table_cell': {
        const text = await hwpCall(
          editor,
          'GetCellText',
          intArg(call, 'tablePara'),
          intArg(call, 'row'),
          intArg(call, 'col'),
          intArg(call, 'colCount'),
        )
        return textResult(typeof text === 'string' ? text : JSON.stringify(text))
      }
      case 'set_table_cell': {
        await hwpCall(
          editor,
          'SetCellText',
          intArg(call, 'tablePara'),
          intArg(call, 'row'),
          intArg(call, 'col'),
          strArg(call, 'text'),
          intArg(call, 'colCount'),
        )
        return {
          output: `Cell (${intArg(call, 'row')},${intArg(call, 'col')}) updated.`,
          mutated: true,
          summary: 'table cell updated',
        }
      }
      case 'insert_text_at': {
        const section = intArg(call, 'section')
        const paragraph = intArg(call, 'paragraph')
        const text = strArg(call, 'text')
        await editor.focusTarget({ kind: 'body_paragraph', section, paragraph, charOffset: 0, length: 0 })
        await hwpCall(editor, 'InsertText', text)
        return {
          output: `Text inserted at section ${section}, paragraph ${paragraph}.`,
          mutated: true,
          summary: 'text inserted',
        }
      }
      default:
        return { output: `Unknown tool: ${call.name}`, isError: true, summary: 'unknown tool' }
    }
  } catch (err) {
    return errorResult(err)
  }
}
