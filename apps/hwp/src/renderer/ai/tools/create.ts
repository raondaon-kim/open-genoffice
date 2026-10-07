import type { AgentToolDef } from '@genoffice/agent-core'
import type { ToolModule } from '../context'
import { optStrArg, record, strArg, toExecution } from '../errors'

const tools: AgentToolDef[] = [
  {
    name: 'create_document',
    description:
      'Create a NEW Hangul (.hwpx) document from Markdown and open it in a new tab: headings, paragraphs, bullet lists and GFM tables with filled cells (예: 강의 실라버스, 보고서, 계획서). Put the file name in file_name. The current document is not modified; the new tab is unsaved until ⌘S. Call list_document_styles first: when it has the document type, use create_styled_document instead; use this tool when no style page fits.',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description:
            'Markdown content: #/## headings, paragraphs, bullet lists, GFM tables (| a | b | rows) with real cell content.',
        },
        file_name: { type: 'string', description: 'Suggested file name (default: document)' },
      },
      required: ['markdown'],
    },
  },
]

export const createTools: ToolModule = {
  tools,
  async execute(ctx, call) {
    const input = record(call.input ?? {}, 'input')
    const markdown = strArg(input, 'markdown')
    const fileName = optStrArg(input, 'file_name')?.trim()
    const result = await ctx.api().createDocument(markdown, fileName || undefined)
    if (!result.ok || !result.path) {
      return {
        output: `create_document failed: ${result.error ?? 'unknown error'}`,
        isError: true,
        summary: 'creation failed',
      }
    }
    return {
      output: `Created "${result.path.split(/[\\/]/).pop()}" and opened it in a new tab. Markdown tables became real Hangul tables with their cell text. The new document is unsaved — press ⌘S to save it.`,
      summary: 'document created and opened',
    }
  },
}

const raw = createTools.execute
createTools.execute = (ctx, call) => raw(ctx, call).catch(toExecution)
