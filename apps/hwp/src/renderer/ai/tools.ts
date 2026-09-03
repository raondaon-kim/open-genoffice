import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import type { RhwpEditor } from '@rhwp/editor'
import type { HwpApi } from '../../shared/ipc'

/** renderer API bridge (same object App declares on window) */
function hwpApi(): HwpApi | undefined {
  return (window as unknown as { hwpApi?: HwpApi }).hwpApi
}

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

/** Call a method on the embedded Hangul-compatible control (hwpctrl plugin). */
async function hwpCall(editor: RhwpEditor, method: string, ...args: unknown[]): Promise<unknown> {
  await ensureHwpctrl(editor)
  return editor.hwpctrl.call(method, args)
}

/**
 * Formatting is applied through the hwpctrl action registry, which the studio
 * implements deterministically for **whole body paragraphs** (index 0 = first
 * body paragraph; SetPos(0, para, 0) moves the hwpctrl caret there first).
 * Text colors are the standard Hangul palette (8 presets); arbitrary RGB is not
 * supported by the engine, and current character formatting cannot be read
 * back. Undo with ⌘Z restores the paragraph.
 */
const CHAR_COLOR_PALETTE: Record<string, { action: string; hex: string }> = {
  black: { action: 'CharShapeTextColorBlack', hex: '#000000' },
  blue: { action: 'CharShapeTextColorBlue', hex: '#0000FF' },
  red: { action: 'CharShapeTextColorRed', hex: '#FF0000' },
  green: { action: 'CharShapeTextColorGreen', hex: '#008000' },
  bluish: { action: 'CharShapeTextColorBluish', hex: '#008080' },
  violet: { action: 'CharShapeTextColorViolet', hex: '#993366' },
  white: { action: 'CharShapeTextColorWhite', hex: '#FFFFFF' },
  yellow: { action: 'CharShapeTextColorYellow', hex: '#FFFF00' },
}

const CHAR_ALIGN_ACTIONS: Record<string, string> = {
  justify: 'ParagraphShapeAlignJustify',
  left: 'ParagraphShapeAlignLeft',
  right: 'ParagraphShapeAlignRight',
  center: 'ParagraphShapeAlignCenter',
  distribute: 'ParagraphShapeAlignDistribute',
  division: 'ParagraphShapeAlignDivision',
}

/** resolve a color argument to a palette action id; nearest-match for #rrggbb */
function resolveColorAction(color: unknown): string | null {
  if (typeof color !== 'string') return null
  const raw = color.trim().toLowerCase()
  if (CHAR_COLOR_PALETTE[raw]) return CHAR_COLOR_PALETTE[raw].action
  const hexMatch = /^#?([0-9a-f]{6})$/i.exec(raw)
  if (!hexMatch) return null
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hexMatch[1].slice(i, i + 2), 16))
  let best: string | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const [name, entry] of Object.entries(CHAR_COLOR_PALETTE)) {
    const h = entry.hex.slice(1)
    const [pr, pg, pb] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = name
    }
  }
  return best ? CHAR_COLOR_PALETTE[best].action : null
}

/** move the hwpctrl caret to body paragraph `paragraph`, select the whole paragraph, and verify the engine actually selected it */
async function selectParagraph(
  editor: RhwpEditor,
  paragraph: number,
): Promise<{ spara: number; epara: number; spos: number; epos: number }> {
  await hwpCall(editor, 'Run', 'Cancel')
  await hwpCall(editor, 'SetPos', 0, paragraph, 0)
  await hwpCall(editor, 'Run', 'MoveSelParaBegin')
  await hwpCall(editor, 'Run', 'MoveSelParaEnd')
  const raw = await hwpCall(editor, 'GetSelectedPos')
  const sel = (raw ?? {}) as { spara?: number; epara?: number; spos?: number; epos?: number }
  if (sel.spara !== paragraph || sel.epara !== paragraph) {
    throw new Error(
      `Body paragraph ${paragraph} does not exist in this document (the engine selected paragraph ${sel.spara ?? '?'}). Re-read the page text and pick an existing paragraph number.`,
    )
  }
  if ((sel.epos ?? 0) <= (sel.spos ?? 0)) {
    throw new Error(
      `Body paragraph ${paragraph} contains no selectable text. Pick the paragraph whose text you want to change.`,
    )
  }
  return sel as { spara: number; epara: number; spos: number; epos: number }
}

/** select the whole paragraph, run a preset formatting action, then clear the selection */
async function formatParagraph(
  editor: RhwpEditor,
  paragraph: number,
  actionId: string,
): Promise<void> {
  await selectParagraph(editor, paragraph)
  const ok = await hwpCall(editor, 'Run', actionId)
  if (ok === false) throw new Error(`engine could not run ${actionId}`)
  await hwpCall(editor, 'Run', 'Cancel')
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

function okRun(output: string, summary: string): ToolExecution {
  return { output, mutated: true, summary }
}

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: 'read_pages',
    description:
      'Read the text content of a page range of the open Hangul document (with [Page N] markers). Read the relevant pages before answering or editing; at most 10 pages per call, over-long output is truncated.',
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
    name: 'add_table',
    description:
      'Insert a 5-row x 5-column table. Only works on an EMPTY new document (it refuses when the document already has text); the engine inserts the table at the start of the document. Table cells cannot be filled by the AI — after creating the table, tell the user to type cell contents directly or format the table in the editor. Changes are unsaved until the user presses ⌘S.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_text_color',
    description:
      'Set the text color of one whole body paragraph (index 0 = first body paragraph of the main text; read_pages helps you find which paragraph). Supports only the standard Hangul palette: black, blue, red, green, bluish, violet, white, yellow (also accepts a #rrggbb hex that is matched to the nearest palette color). The change applies to the entire paragraph; character formatting cannot be read back, so mention what you changed. Undo with ⌘Z. Changes are unsaved until the user presses ⌘S.',
    inputSchema: {
      type: 'object',
      properties: {
        paragraph: { type: 'integer', description: 'Body paragraph index (0-based)' },
        color: {
          type: 'string',
          description:
            'Palette color name (black/blue/red/green/bluish/violet/white/yellow) or #rrggbb hex',
        },
      },
      required: ['paragraph', 'color'],
    },
  },
  {
    name: 'set_paragraph_alignment',
    description:
      'Set the alignment of one whole body paragraph (index 0 = first body paragraph of the main text; read_pages helps you find which paragraph). Values: left, center, right, justify, distribute, division. Undo with ⌘Z. Changes are unsaved until the user presses ⌘S.',
    inputSchema: {
      type: 'object',
      properties: {
        paragraph: { type: 'integer', description: 'Body paragraph index (0-based)' },
        align: {
          type: 'string',
          enum: ['left', 'center', 'right', 'justify', 'distribute', 'division'],
        },
      },
      required: ['paragraph', 'align'],
    },
  },
  {
    name: 'clear_character_format',
    description:
      'Reset character formatting (bold/italic/underline/strike/super/subscript and text color back to black) of one whole body paragraph (index 0 = first body paragraph of the main text). Font size is kept. Undo with ⌘Z. Changes are unsaved until the user presses ⌘S.',
    inputSchema: {
      type: 'object',
      properties: {
        paragraph: { type: 'integer', description: 'Body paragraph index (0-based)' },
      },
      required: ['paragraph'],
    },
  },
  {
    name: 'create_document',
    description:
      'Create a NEW Hangul (.hwpx) document from Markdown and open it in a new tab. Unlike write_content/add_table this supports the FULL structure: headings, paragraphs, and real GFM tables with filled cells — use it for templates and documents that mix text and tables (예: 강의 실라버스, 보고서, 계획서). Put the file name in file_name (e.g. "강의실라버스"). The current document is not modified; the new document opens as its own tab and is unsaved until ⌘S.',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description:
            'Markdown content: #/## headings, plain paragraphs, bullet lists, and GFM tables (| a | b | rows). Fill table cells with real content.',
        },
        file_name: { type: 'string', description: 'Suggested file name (default: document)' },
      },
      required: ['markdown'],
    },
  },
  {
    name: 'write_content',
    description:
      'Write plain text into an EMPTY new document (e.g. a report, letter, or note the user asked you to create). Use newlines to separate paragraphs. Only works while the document is empty — it refuses when the document already has content, so never use it on a document that already contains text. The inserted text uses default formatting; the user can then edit or format it. Changes are unsaved until the user presses ⌘S.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Full document content to write (paragraphs separated by newlines)',
        },
      },
      required: ['text'],
    },
  },
]

export async function executeHwpTool(deps: HwpAiDeps, call: AgentToolCall): Promise<ToolExecution> {
  const editor = deps.editor()
  if (!editor)
    return { output: 'The document is not open yet.', isError: true, summary: 'no document' }
  try {
    switch (call.name) {
      case 'read_pages': {
        const state = await editor.getDocumentState()
        const start = Math.max(1, intArg(call, 'start'))
        const end = Math.min(
          state.pageCount,
          start + 9,
          Math.max(start, intArg(call, 'end', start)),
        )
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
        const ok = await hwpCall(editor, 'PutFieldText', field, text)
        if (ok === false)
          throw new Error(`fill_field failed: engine could not update field "${field}"`)
        return { output: `Field "${field}" filled.`, mutated: true, summary: `filled "${field}"` }
      }
      case 'add_table': {
        // only on empty documents: inserting into an existing paragraph is
        // unreliable on the current engine (end-of-document cursor actions bug)
        const existing = await hwpCall(editor, 'GetTextFile', 'UNICODE')
        if (typeof existing === 'string' && existing.replace(/\s+/g, '').length > 0) {
          return {
            output:
              'add_table only works on an empty document. Start a new empty document (New HWP), ask for the table there, then type cell contents in the editor.',
            isError: true,
            summary: 'document not empty',
          }
        }
        const ctrl = await hwpCall(editor, 'InsertCtrl', 'tbl')
        if (ctrl === null || ctrl === undefined) {
          return {
            output: 'add_table failed: the engine could not insert a table.',
            isError: true,
            summary: 'table insert failed',
          }
        }
        return {
          output:
            'A 5x5 table was added at the start of the document. Cell contents cannot be filled by the AI — please type into the cells directly; save with ⌘S when done.',
          mutated: true,
          summary: '5x5 table added',
        }
      }
      case 'set_text_color': {
        const paragraph = intArg(call, 'paragraph')
        const action = resolveColorAction((call.input as Record<string, unknown>).color)
        if (!action) {
          return {
            output:
              'Unsupported color. The Hangul engine supports only the palette: black, blue, red, green, bluish, violet, white, yellow (or a #rrggbb hex matched to the nearest palette color).',
            isError: true,
            summary: 'unsupported color',
          }
        }
        await formatParagraph(editor, paragraph, action)
        return okRun(`Paragraph ${paragraph} text color set.`, `paragraph ${paragraph} recolored`)
      }
      case 'set_paragraph_alignment': {
        const paragraph = intArg(call, 'paragraph')
        const align = strArg(call, 'align').toLowerCase()
        const action = CHAR_ALIGN_ACTIONS[align]
        if (!action) {
          return {
            output:
              'Unsupported alignment. Use left, center, right, justify, distribute, or division.',
            isError: true,
            summary: 'unsupported alignment',
          }
        }
        await formatParagraph(editor, paragraph, action)
        return okRun(`Paragraph ${paragraph} set to ${align}.`, `paragraph ${paragraph} ${align}`)
      }
      case 'clear_character_format': {
        const paragraph = intArg(call, 'paragraph')
        await formatParagraph(editor, paragraph, 'CharShapeNormal')
        return okRun(
          `Character formatting of paragraph ${paragraph} reset.`,
          `paragraph ${paragraph} reset`,
        )
      }
      case 'create_document': {
        const markdown = strArg(call, 'markdown')
        const api = hwpApi()
        if (!api?.createDocument) {
          return {
            output: 'create_document is unavailable in this build.',
            isError: true,
            summary: 'unavailable',
          }
        }
        const fileName = (call.input as Record<string, unknown>).file_name
        const result = await api.createDocument(
          markdown,
          typeof fileName === 'string' && fileName.trim() ? fileName.trim() : undefined,
        )
        if (!result.ok || !result.path) {
          return {
            output: `create_document failed: ${result.error ?? 'unknown error'}`,
            isError: true,
            summary: 'creation failed',
          }
        }
        return {
          output: `Created "${result.path.split(/[\\/]/).pop()}" and opened it in a new tab. Tables in the Markdown became real Hangul tables with their cell text. The new document is unsaved — press ⌘S to save it.`,
          summary: 'document created and opened',
        }
      }
      case 'write_content': {
        const text = strArg(call, 'text')
        if (!text.trim()) {
          return {
            output: 'write_content needs non-empty text.',
            isError: true,
            summary: 'empty text',
          }
        }
        const existing = await hwpCall(editor, 'GetTextFile', 'UNICODE')
        if (typeof existing === 'string' && existing.replace(/\s+/g, '').length > 0) {
          return {
            output:
              'This document already contains text, so write_content refused to touch it. Start from a new empty document (New HWP) to compose content.',
            isError: true,
            summary: 'document not empty',
          }
        }
        const ok = await hwpCall(editor, 'SetTextFile', text)
        if (ok === false) {
          return {
            output: 'write_content failed: the engine could not insert the text.',
            isError: true,
            summary: 'insert failed',
          }
        }
        return okRun(
          'Written. The content is unsaved — press ⌘S to save the document.',
          'content written',
        )
      }
      default:
        return { output: `Unknown tool: ${call.name}`, isError: true, summary: 'unknown tool' }
    }
  } catch (err) {
    return errorResult(err)
  }
}
