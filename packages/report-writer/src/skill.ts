import type { AgentSkill, AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import { writeReport } from './run'
import type { Attachment, Lander, LlmPort, ReportProgress, WikiPort } from './types'

/** what an editor supplies to get write_report; St is its style page type */
export interface ReportSkillDeps<St> {
  /** style used when the user names none */
  defaultStyle: string
  /** style used for a proposal request with an attachment (e.g. an RFP) */
  proposalStyle: string
  /** the lander for this run; may refuse (throw) a style it cannot map */
  lander(style: St, styleId: string, runId: string): Lander | Promise<Lander>
  llm(): LlmPort
  wiki(): WikiPort | null
  /** every attachment of the conversation, read in full; throws naming a file it cannot read */
  attachments(): Promise<Attachment[]>
  readStyle(id: string): Promise<{ style: St; description: string } | null>
  progress(e: ReportProgress): void
}

export const REPORT_PROMPT = `## Whole documents from material (write_report)
- When the user asks for a whole document built from material — a report, proposal, plan or white paper from attached files and/or the work wiki — call write_report once with the request in the user's words. It reads every attachment, plans the outline from them and the wiki's index, puts the title and table of contents into the document, and writes the chapters one after another.
- Pass style only when the user named a document style; pass length when the user said how long.
- Do not read the attachments or the wiki yourself first, and do not use write_document / write_styled_document for such requests; keep those for short pieces and edits.
- After it returns, tell the user in one or two sentences what was written (chapters, any chapter that failed, the open items table).`

const TOOL: AgentToolDef = {
  name: 'write_report',
  description:
    'Write a whole document (report, proposal, plan) from the attachments and the work wiki: plan, title and table of contents first, then the chapters one by one.',
  inputSchema: {
    type: 'object',
    properties: {
      request: { type: 'string', description: "the user's request, in their words" },
      style: { type: 'string', description: 'a document style id, only if the user named one' },
      length: { type: 'string', description: 'length the user asked for, e.g. "10쪽", "5장"' },
    },
    required: ['request'],
  },
}

const PROPOSAL = /제안서|제안 ?요청서|proposal|\bRFP\b/i

const fail = (summary: string, output: string): ToolExecution => ({
  output,
  isError: true,
  summary,
})

/** the write_report tool, shared by the Word and Hangul AI panels */
export function createReportSkill<St>(deps: ReportSkillDeps<St>): AgentSkill {
  return {
    id: 'report',
    systemPrompt: REPORT_PROMPT,
    tools: [TOOL],
    buildContext: () => '',
    executeTool: async (call, signal): Promise<ToolExecution> => {
      if (call.name !== 'write_report') return fail(call.name, `unknown tool: ${call.name}`)
      const input = (call.input ?? {}) as Record<string, unknown>
      const request = typeof input.request === 'string' ? input.request.trim() : ''
      if (!request) return fail('invalid argument', 'write_report needs the request')
      let attachments: Attachment[]
      try {
        attachments = await deps.attachments()
      } catch (err) {
        return fail('attachment unreadable', err instanceof Error ? err.message : String(err))
      }
      const styleId =
        typeof input.style === 'string' && input.style.trim()
          ? input.style.trim()
          : PROPOSAL.test(request) && attachments.length > 0
            ? deps.proposalStyle
            : deps.defaultStyle
      const read = await deps.readStyle(styleId)
      if (!read) return fail('unknown style', `no document style "${styleId}"`)
      const runId = Math.random().toString(36).slice(2, 6)
      let lander: Lander
      try {
        lander = await deps.lander(read.style, styleId, runId)
      } catch (err) {
        return fail('style unsupported', err instanceof Error ? err.message : String(err))
      }
      const outcome = await writeReport(
        {
          request,
          kind: styleId.includes('proposal') ? 'proposal' : 'report',
          styleRules: read.description.slice(0, 3000),
          lengthHint: typeof input.length === 'string' ? input.length : undefined,
          attachments,
        },
        {
          llm: deps.llm(),
          wiki: deps.wiki(),
          lander,
          progress: deps.progress,
        },
        signal,
      )
      if (!outcome.ok) {
        return {
          output: `write_report stopped: ${outcome.error}. Chapters written: ${outcome.written}.`,
          isError: outcome.error !== 'cancelled',
          mutated: outcome.written > 0,
          summary: outcome.error === 'cancelled' ? 'report cancelled' : 'report failed',
        }
      }
      const lines = [
        `Wrote ${outcome.written} chapter(s) in the "${styleId}" style into the document.`,
        outcome.failed.length
          ? `Chapters that could not be written (marked in the document): ${outcome.failed.join(', ')}.`
          : '',
        outcome.gaps
          ? `${outcome.gaps} item(s) the material could not support are listed in the "확인 필요 사항" table at the end.`
          : '',
      ].filter(Boolean)
      return {
        output: lines.join('\n'),
        mutated: true,
        summary: `report: ${outcome.written} chapter(s)`,
      }
    },
  }
}
