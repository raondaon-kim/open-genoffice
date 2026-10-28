import type { Editor } from '@tiptap/core'
import type { AgentSkill, ToolExecution } from '@genoffice/agent-core'
import type { DocxStyle } from '@genoffice/doc-styles'
import type { TemplateForRun } from '@genoffice/report-writer'
import { parseTemplateMd, templateForRun } from '@genoffice/team-templates/md'
import { isFilled, locateHeadings } from './template-lander'

/** the `[label]` placeholders of the form's cover (the paragraphs before the first heading) */
export function coverLabelsOf(editor: Editor): string[] {
  const labels: string[] = []
  let done = false
  editor.state.doc.forEach((node) => {
    if (done) return
    if (node.type.name === 'docHeading') {
      done = true
      return
    }
    const label = /^\[(.+)\]$/.exec(node.textContent.trim())?.[1]
    if (label) labels.push(label)
  })
  return labels
}

/**
 * The team template the open working copy was made from, as the writer needs it, with the
 * template's measured style; null for any other document.
 */
export async function templateRunFor(
  api: { templateFor(filePath: string): Promise<string | null> },
  filePath: string | null | undefined,
  editor: Editor,
): Promise<{ run: TemplateForRun; style: DocxStyle } | null> {
  if (!filePath) return null
  const md = await api.templateFor(filePath).catch(() => null)
  if (!md) return null
  const parsed = parseTemplateMd(md)
  if (!parsed.ok) return null
  const run: TemplateForRun = templateForRun(parsed.def, coverLabelsOf(editor))
  // the form and its definition must have the same headings in the same order
  const { missing } = locateHeadings(editor, run.headings ?? [])
  if (missing) return { run: { ...run, problem: missing }, style: parsed.def.style }
  return { run: { ...run, filled: isFilled(editor, run) }, style: parsed.def.style }
}

const LIST_PROMPT = `## Team templates (list_team_templates)
- When the user asks to write a document of a kind the team has a template for (for example a proposal or a report), you may call list_team_templates to see the team's templates. It only reads the list; suggest the matching template by name and tell the user to open it from Home › 팀 템플릿 (이 양식으로 작성). Never claim you opened it.`

const ASK_PROMPT = `## Team templates (list_team_templates, use_team_template)
- When the user asks you to write a whole document (a proposal, report, plan, …), first call list_team_templates, before writing anything.
- If one team template fits the request (judge by its title and purpose), ask once, in one short sentence in the user's language, naming it — e.g. 「팀 템플릿 「<title>」으로 쓸까요?」 — and end your turn without writing. If several fit, name them and ask which one. If none fits, write as usual and do not mention templates.
- When the user agrees or names a template, call use_team_template with its path from the list and the user's whole writing request in their own words, including every value they gave anywhere in this conversation (names, dates, the client). Then end your reply with one short sentence; do not write the document yourself — the writing starts in the template by itself.
- When the user declines, write without a template and do not ask about templates again in this conversation.
- Never apply a template the user did not agree to.`

/** the app side of the team-template tools */
export interface TeamTemplatesPort<R> {
  /** index.md of the team templates folder; null when the team folders are not set up */
  teamTemplateIndex(): Promise<string | null>
  /** template.md of the working copy at `filePath`, or null */
  templateFor(filePath: string): Promise<string | null>
  /** the usual guard before this tab's document is replaced (asks about unsaved changes) */
  confirmDocumentReplace(): Promise<boolean>
  /** a new working copy of the set, read for this tab; `result` is what the tab then loads */
  useTeamTemplate(setPath: string): Promise<{ ok: true; result: R } | { ok: false; error: string }>
}

/** what the next conversation (in the working copy) starts with */
export interface TemplateHandoff {
  /** sent to the assistant */
  instruction: string
  /** shown as the user's message */
  display: string
}

export interface TemplateSwitch<R> {
  result: R
  handoff: TemplateHandoff
}

/** `Word/<set folder>/` from index.md; the folder name is the set's title as written */
const SET_PATH = /^Word\/([^/\\]+)\/?$/

export function templateHandoff(setPath: string, request: string): TemplateHandoff {
  const name = SET_PATH.exec(setPath)?.[1] ?? setPath
  return {
    display: request,
    instruction: `${request}\n\n(This document is the working copy of the team template “${name}”, opened for this request: write it with write_report, filling the template.)`,
  }
}

async function isWorkingCopy<R>(api: TeamTemplatesPort<R>, filePath: string | null | undefined) {
  if (!filePath) return false
  return (await api.templateFor(filePath).catch(() => null)) !== null
}

const IN_COPY =
  'This document is already the working copy of a team template: write it with write_report, which fills that template. Do not ask about other templates.'

/**
 * The team templates folder's index.md, read-only; with `opts` (a Word tab's AI panel) also
 * use_team_template, which opens the agreed template's working copy in this tab once the reply
 * ends (`onSwitch`) and carries the request over to the new conversation.
 */
export function createTeamTemplatesSkill<R>(
  api: () => TeamTemplatesPort<R>,
  opts?: {
    filePath: () => string | null | undefined
    onSwitch: (s: TemplateSwitch<R>) => void
  },
): AgentSkill {
  const tools: AgentSkill['tools'] = [
    {
      name: 'list_team_templates',
      description:
        "List the team's document templates (index.md of the team NAS templates folder). Read-only.",
      inputSchema: { type: 'object', properties: {} },
    },
  ]
  if (opts) {
    tools.push({
      name: 'use_team_template',
      description:
        'Open the team template the user agreed to as a new working copy in this tab; the writing then starts there by itself with `request`. Only after the user said yes.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'the set path from list_team_templates, e.g. Word/<name>/',
          },
          request: {
            type: 'string',
            description:
              "the user's whole writing request in their own words, with every value they gave in this conversation",
          },
        },
        required: ['path', 'request'],
      },
    })
  }
  return {
    id: 'team-templates',
    systemPrompt: opts ? ASK_PROMPT : LIST_PROMPT,
    tools,
    executeTool: async (call): Promise<ToolExecution> => {
      if (call.name === 'list_team_templates') {
        if (opts && (await isWorkingCopy(api(), opts.filePath()))) {
          return { output: IN_COPY, summary: 'team template copy' }
        }
        const index = await api()
          .teamTemplateIndex()
          .catch(() => null)
        if (!index) {
          return {
            output: 'Team templates are not set up on this PC (Home › 팀 템플릿 › NAS 연결 설정).',
            summary: 'no team templates',
          }
        }
        const how = opts
          ? 'If one fits the request, ask the user once whether to use it; on yes call use_team_template.'
          : 'To use one, the user opens it from Home › 팀 템플릿 (이 양식으로 작성).'
        return { output: `${index}\n\n${how}`, summary: 'team templates' }
      }
      if (call.name === 'use_team_template' && opts) {
        const path = typeof call.input.path === 'string' ? call.input.path.trim() : ''
        const request = typeof call.input.request === 'string' ? call.input.request.trim() : ''
        const m = SET_PATH.exec(path)
        if (!m || m[1] === '.' || m[1] === '..') {
          return {
            output: `not a Word template path from list_team_templates: ${path || '(empty)'}`,
            isError: true,
            summary: 'bad template path',
          }
        }
        if (!request) {
          return { output: 'request is empty', isError: true, summary: 'no request' }
        }
        const port = api()
        if (await isWorkingCopy(port, opts.filePath())) {
          return { output: IN_COPY, isError: true, summary: 'team template copy' }
        }
        if (!(await port.confirmDocumentReplace().catch(() => false))) {
          return {
            output:
              'The user kept the current document; nothing was opened. Tell them in one sentence; use a template only if they ask again.',
            summary: 'kept the document',
          }
        }
        const opened = await port
          .useTeamTemplate(path)
          .catch((error: unknown) => ({ ok: false as const, error: String(error) }))
        if (!opened.ok) {
          return {
            output: `The template could not be opened (${opened.error}). Tell the user; they can open it from Home › 팀 템플릿.`,
            isError: true,
            summary: 'template not opened',
          }
        }
        opts.onSwitch({ result: opened.result, handoff: templateHandoff(path, request) })
        return {
          output:
            'The working copy opens in this tab when your reply ends, and the writing starts there by itself. End your reply now with one short sentence saying so; do not write the document here.',
          summary: `team template ${m[1]}`,
        }
      }
      return { output: `unknown tool: ${call.name}`, isError: true, summary: call.name }
    },
  }
}
