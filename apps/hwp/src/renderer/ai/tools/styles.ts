import type { AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import type { ToolModule } from '../context'
import { optStrArg, record, strArg, ToolError, toExecution } from '../errors'

const MAX_BLOCKS = 200

const tools: AgentToolDef[] = [
  {
    name: 'list_document_styles',
    description:
      'List the document types the style wiki knows (each with its id, title, how many real documents the values come from, and whether the values are still a draft). Always call it first when asked to write an official letter, report, press release or any other document from scratch.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_document_style',
    description:
      'Read one document type: its roles (id, label, marker, leading spaces, size, bold, alignment, indent), the skeleton (the order of the parts and which are required), page setup and a description. Pick roles from this table for create_styled_document.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Style id from list_document_styles' } },
      required: ['id'],
    },
  },
  {
    name: 'create_styled_document',
    description:
      'Create a NEW document in a known document type and open it in a new tab. blocks are the document in order: each block is {role, text} — role from read_document_style, text one line WITHOUT leading spaces (they are added from the role) and including its own marker such as "1. " or "○ ". Alignment, indentation, sizes and spacing come from the role: never type them. Use an empty text for a blank line. Up to 200 blocks per call. A LONG document (a proposal, a report of many chapters) is written in stages: first call with the cover and table of contents and done:false, keep the returned draft_id, then one call per chapter with that draft_id and done:false, and the last chapter with draft_id and done:true — only then is the whole document (up to 1500 blocks) built and opened.',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Style id' },
        blocks: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BLOCKS,
          items: {
            type: 'object',
            properties: { role: { type: 'string' }, text: { type: 'string' } },
            required: ['role', 'text'],
          },
        },
        file_name: {
          type: 'string',
          description: 'Suggested file name (default: the style title)',
        },
        draft_id: {
          type: 'string',
          description:
            'Continue a staged document: the draft_id an earlier done:false call returned',
        },
        done: {
          type: 'boolean',
          description:
            'false = keep these blocks in the draft and build nothing yet (more stages follow); true (default) = build and open the document',
        },
      },
      required: ['style', 'blocks'],
    },
  },
  {
    name: 'export_document_styles',
    description:
      'Copy the document-style wiki pages (markdown) to a folder the user picks, for example a LLM Wiki project. Asks the user for the folder.',
    inputSchema: { type: 'object', properties: {} },
  },
]

export const stylesTools: ToolModule = {
  tools,
  async execute(ctx, call): Promise<ToolExecution> {
    const input = record(call.input ?? {}, 'input')
    const api = ctx.api()
    switch (call.name) {
      case 'list_document_styles': {
        const result = await api.listDocStyles()
        if (!result.ok) throw new ToolError(result.error, 'styles unavailable')
        return {
          output: JSON.stringify({ styles: result.styles }),
          summary: `${result.styles.length} document style(s)`,
        }
      }
      case 'read_document_style': {
        const id = strArg(input, 'id')
        const result = await api.readDocStyle(id)
        if (!result.ok) {
          throw new ToolError(
            `${result.error} — call list_document_styles for the known ids`,
            'unknown style',
          )
        }
        const s = result.style
        return {
          output: JSON.stringify({
            id: s.id,
            title: s.title,
            draft: s.draft === true,
            evidence: s.evidence,
            page: s.page,
            roles: s.roles.map((r) => ({
              id: r.id,
              label: r.label,
              marker: r.marker,
              lead: r.lead,
              size: r.size,
              bold: r.bold,
              align: r.align,
              indent: r.indent,
            })),
            skeleton: s.skeleton,
            description: result.description.slice(0, 3000),
          }),
          summary: `style ${s.id}: ${s.roles.length} role(s)`,
        }
      }
      case 'create_styled_document': {
        const style = strArg(input, 'style')
        const blocks = input.blocks
        if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > MAX_BLOCKS) {
          throw new ToolError(`blocks must be a list of 1-${MAX_BLOCKS} blocks`, 'invalid argument')
        }
        const checked = blocks.map((b, i) => {
          const block = record(b, `blocks[${i}]`)
          if (
            typeof block.role !== 'string' ||
            block.role === '' ||
            typeof block.text !== 'string'
          ) {
            throw new ToolError(
              `blocks[${i}] needs a role and a text (a string)`,
              'invalid argument',
            )
          }
          return { role: block.role, text: block.text }
        })
        const fileName = optStrArg(input, 'file_name')?.trim()
        const draftId = optStrArg(input, 'draft_id')?.trim()
        const done = input.done !== false
        const result = await api.createStyledDocument({
          style,
          blocks: checked,
          ...(fileName ? { fileName } : {}),
          ...(draftId ? { draftId } : {}),
          ...(done ? {} : { done: false }),
        })
        if (!result.ok)
          throw new ToolError(`create_styled_document failed: ${result.error}`, 'creation failed')
        if ('staged' in result) {
          return {
            output: `Stage kept in draft ${result.draftId} (${result.paragraphs} block(s) so far). Send the next chapter with draft_id "${result.draftId}" and done:false, or the last one with done:true to build and open the document.`,
            summary: `draft ${result.draftId}: ${result.paragraphs} block(s)`,
          }
        }
        const roles = Object.entries(result.roleCounts)
          .map(([r, n]) => `${r}×${n}`)
          .join(', ')
        const lines = [
          `Created "${result.path.split(/[\\/]/).pop()}" with ${result.paragraphs} paragraph(s) (${roles}) and opened it in a new tab.`,
          ...result.warnings.map((w) => `Warning: ${w}`),
          'Alignment, indentation, sizes and spacing follow the document type. The engine cannot set page margins or fonts: the user sets them in Hangul if the template needs it.',
          'The new document is unsaved — press ⌘S to save it.',
        ]
        return { output: lines.join('\n'), summary: 'styled document created' }
      }
      case 'export_document_styles': {
        const result = await api.exportDocStyles()
        if (!result.ok) {
          if (result.canceled)
            return { output: 'Export canceled — no folder was chosen.', summary: 'export canceled' }
          throw new ToolError(result.error ?? 'export failed', 'export failed')
        }
        return {
          output: `Exported ${result.count} page(s) to ${result.target}. They are plain markdown pages (a LLM Wiki project can read them).`,
          summary: `exported ${result.count} page(s)`,
        }
      }
      default:
        throw new ToolError(`Unknown style tool: ${call.name}`, 'unknown tool')
    }
  },
}

const raw = stylesTools.execute
stylesTools.execute = (ctx, call) => raw(ctx, call).catch(toExecution)
