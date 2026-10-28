import type { AgentSkill, AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import { writeReport } from './run'
import { writeFromTemplate } from './template-run'
import type {
  Attachment,
  Lander,
  LlmPort,
  ReportOutcome,
  ReportProgress,
  TemplateForRun,
  TemplateLander,
  WikiPort,
  WikiReadiness,
} from './types'

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
  /** the team template the open document was made from, or null */
  template?(): TemplateForRun | null | Promise<TemplateForRun | null>
  /** lands a template fill in the open form */
  templateLander?(template: TemplateForRun, runId: string): TemplateLander
  /** LLM Wiki answering (checked before a template fill); missing = ready */
  wikiReady?(): Promise<WikiReadiness>
}

/** how long the readiness check may take before the progress card says it is waiting */
const WIKI_WAIT_ROW_MS = 300

const TEMPLATE_TAG = /\n*<team-template>[\s\S]*?<\/team-template>\n*/g

export const REPORT_PROMPT = `## Whole documents from material (write_report)
- When the user asks for a whole document built from material — a report, proposal, plan or white paper from attached files and/or the work wiki — call write_report once with the request in the user's words. It reads every attachment, plans the outline from them and the wiki's index, puts the title and table of contents into the document, and writes the chapters one after another.
- Pass style only when the user named a document style; pass length when the user said how long.
- write_report adds the new document after what is already in the open document (a blank document is filled). Never delete or rewrite existing content before or after calling it unless the user asked to replace it; do not edit the written document afterwards unless asked.
- Do not read the attachments or the wiki yourself first, and do not use write_document / write_styled_document for such requests; keep those for short pieces and edits.
- After it returns, tell the user in one or two sentences what was written (chapters, any chapter that failed, the open items table).
- When the context says the document was opened from a team template, call write_report for any request to write or fill the document: the template fixes the table of contents and the formatting, and write_report fills every section from the attachments and the work wiki. If write_report says the work wiki is unavailable, ask the user exactly the question it gives, and call it again with withoutWiki: true only if they agree.`

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
      withoutWiki: {
        type: 'boolean',
        description:
          'only after the user agreed to write a team template without the unavailable work wiki',
      },
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

function templateResult(template: TemplateForRun, outcome: ReportOutcome): ToolExecution {
  if (!outcome.ok) {
    return {
      output: `write_report stopped: ${outcome.error}. Sections written: ${outcome.written}.`,
      isError: outcome.error !== 'cancelled',
      mutated: outcome.written > 0,
      summary: outcome.error === 'cancelled' ? 'template fill cancelled' : 'template fill failed',
    }
  }
  const lines = [
    `Filled ${outcome.written} of ${template.sections.length} section(s) of the team template "${template.title}".`,
    outcome.failed.length
      ? `Sections that could not be written (marked in the document): ${outcome.failed.join(', ')}.`
      : '',
    outcome.gaps
      ? `${outcome.gaps} item(s) the material could not support are listed in the "확인 필요 사항" table at the end.`
      : '',
    'The document is complete. Do not change the document further unless the user asks; reply to the user now.',
  ].filter(Boolean)
  return {
    output: lines.join('\n'),
    mutated: true,
    summary: `template: ${outcome.written} section(s)`,
  }
}

/** the write_report tool, shared by the Word and Hangul AI panels */
export function createReportSkill<St>(deps: ReportSkillDeps<St>): AgentSkill {
  return {
    id: 'report',
    systemPrompt: REPORT_PROMPT,
    tools: [TOOL],
    buildContext: async () => {
      const t = await deps.template?.()
      if (!t) return ''
      if (t.filled) {
        return `<team-template>\nThis document was made from the team template "${t.title}" and has already been filled. Edit it with the normal editing tools; do not call write_report for it.\n</team-template>`
      }
      return `<team-template>\nThis document was opened from the team template "${t.title}" (${t.purpose}). Its table of contents is fixed (${t.sections.length} sections); to write or fill the document, call write_report.\n</team-template>`
    },
    stripContext: (text) => text.replace(TEMPLATE_TAG, '').trim(),
    executeTool: async (call, signal): Promise<ToolExecution> => {
      if (call.name !== 'write_report') return fail(call.name, `unknown tool: ${call.name}`)
      const input = (call.input ?? {}) as Record<string, unknown>
      const request = typeof input.request === 'string' ? input.request.trim() : ''
      if (!request) return fail('invalid argument', 'write_report needs the request')
      const template = (await deps.template?.()) ?? null
      const withoutWiki = input.withoutWiki === true
      if (template && deps.templateLander) {
        if (template.problem) {
          return fail(
            'template does not match its form',
            `Nothing was written. Tell the user: 이 문서의 제목이 팀 템플릿 정의와 다릅니다(첫 번째로 다른 제목: 「${template.problem}」). 팀 템플릿에서 새로 열거나 템플릿을 다시 만드세요.`,
          )
        }
        if (template.filled) {
          return fail(
            'template already filled',
            'Nothing was written: this team template copy is already filled. Edit it with the normal editing tools instead of write_report.',
          )
        }
      }
      if (template && deps.templateLander && !withoutWiki && deps.wikiReady) {
        // a quick answer shows nothing; a wait (LLM Wiki still starting) gets its own row
        const waiting = setTimeout(() => deps.progress({ kind: 'wiki-waiting' }), WIKI_WAIT_ROW_MS)
        const ready = await deps.wikiReady().finally(() => clearTimeout(waiting))
        if (!ready.ok) {
          return fail(
            'work wiki unavailable',
            `Nothing was written. Ask the user exactly: "LLM Wiki를 사용할 수 없습니다 (${ready.reason}). 업무 위키 페이지와 첨부 자료만으로 쓸까요?" Only if they agree, call write_report again with the same request and withoutWiki: true.`,
          )
        }
      }
      let attachments: Attachment[]
      try {
        attachments = await deps.attachments()
      } catch (err) {
        return fail('attachment unreadable', err instanceof Error ? err.message : String(err))
      }
      if (template && deps.templateLander) {
        const runId = Math.random().toString(36).slice(2, 6)
        const outcome = await writeFromTemplate(
          { request, template, attachments },
          {
            llm: deps.llm(),
            // LLM Wiki down still leaves the work wiki's own pages (read from the folder)
            wiki: deps.wiki(),
            lander: deps.templateLander(template, runId),
            progress: deps.progress,
          },
          signal,
        )
        return templateResult(template, outcome)
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
        // the assistant reads this last: it once tidied the document afterwards and deleted an
        // earlier report the user had kept
        'The document is complete. Do not change the document further (no deleting, merging or reformatting, including content that was there before) unless the user asks; reply to the user now.',
      ].filter(Boolean)
      return {
        output: lines.join('\n'),
        mutated: true,
        summary: `report: ${outcome.written} chapter(s)`,
      }
    },
  }
}
