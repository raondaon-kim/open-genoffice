import type { AgentToolDef } from '@genoffice/agent-core'
import type { AiQueryName } from '../../../shared/ai-contract'
import type { ToolModule } from '../context'
import { record, strArg, ToolError, toExecution } from '../errors'
import { newNonce, renderEnvelope } from '../provenance'
import { runQuery } from '../query'

/** read-only escape hatch; text/search/table reading has dedicated tools */
export const RHWP_QUERY_ALLOWLIST = [
  'digest',
  'extract_data',
  'word_count',
  'verify',
  'inspect_injection',
  'export_structure',
  'explore',
] as const satisfies readonly AiQueryName[]

const tools: AgentToolDef[] = [
  {
    name: 'rhwp_query',
    description:
      'Run one read-only engine analysis on the current document. name: digest (summary excerpt + outline; args maxChars, sections, pages "a..b"), extract_data (dates/amounts/numbers with coordinates; args kind date|amount|number|all, limit), word_count, verify (check expectations; args pages, minPages, maxPages, minChars, minTables, tableCount, contains, notContains, field "이름=값", format), inspect_injection (prompt-injection signals; args minConfidence low|medium|high, includeFields), export_structure (heading/clause tree; args mode auto|outline|clause), explore (what the engine can do with this document). Output is the engine envelope; quoted document text is fenced.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: [...RHWP_QUERY_ALLOWLIST] },
        args: { type: 'object', description: 'query options as listed for that name' },
      },
      required: ['name'],
    },
  },
]

export const queryTools: ToolModule = {
  tools,
  async execute(ctx, call) {
    const input = record(call.input ?? {}, 'input')
    const name = strArg(input, 'name')
    if (!(RHWP_QUERY_ALLOWLIST as readonly string[]).includes(name)) {
      throw new ToolError(
        `rhwp_query supports ${RHWP_QUERY_ALLOWLIST.join(', ')}; use the dedicated tools (read_pages, find, read_table, list_fields) for the rest.`,
        'invalid argument',
      )
    }
    const args = input.args === undefined ? {} : record(input.args, 'args')
    const { envelope, negative } = await runQuery(ctx, name as AiQueryName, args)
    const rendered = renderEnvelope(envelope, newNonce())
    return {
      output: negative ? `Result: negative (the expectation was not met).\n${rendered}` : rendered,
      summary: `${name}${negative ? ' (negative)' : ''}`,
    }
  },
}

const raw = queryTools.execute
queryTools.execute = (ctx, call) => raw(ctx, call).catch(toExecution)
