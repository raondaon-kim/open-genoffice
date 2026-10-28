import type { Editor } from '@tiptap/core'
import type { AgentSkill, ToolExecution } from '@genoffice/agent-core'
import type { DocxStyle } from '@genoffice/doc-styles'
import type { TemplateForRun } from '@genoffice/report-writer'
import { parseTemplateMd, templateForRun } from '@genoffice/team-templates/md'

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
  return { run: templateForRun(parsed.def, coverLabelsOf(editor)), style: parsed.def.style }
}

const LIST_PROMPT = `## Team templates (list_team_templates)
- When the user asks to write a document of a kind the team has a template for (for example a proposal or a report), you may call list_team_templates to see the team's templates. It only reads the list; suggest the matching template by name and tell the user to open it from Home › 팀 템플릿 (이 양식으로 작성). Never claim you opened it.`

/** read-only: the team templates folder's index.md */
export function createTeamTemplatesSkill(
  api: () => { teamTemplateIndex(): Promise<string | null> },
): AgentSkill {
  return {
    id: 'team-templates',
    systemPrompt: LIST_PROMPT,
    tools: [
      {
        name: 'list_team_templates',
        description:
          "List the team's document templates (index.md of the team NAS templates folder). Read-only.",
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    executeTool: async (call): Promise<ToolExecution> => {
      if (call.name !== 'list_team_templates') {
        return { output: `unknown tool: ${call.name}`, isError: true, summary: call.name }
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
      return {
        output: `${index}\n\nTo use one, the user opens it from Home › 팀 템플릿 (이 양식으로 작성).`,
        summary: 'team templates',
      }
    },
  }
}
