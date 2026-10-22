import type { AgentSkill } from '@genoffice/agent-core'
import type { DocxStyle } from '@genoffice/doc-styles'
import { createReportSkill as createShared, type ReportSkillDeps } from '@genoffice/report-writer'

export type DocsReportDeps = Omit<
  ReportSkillDeps<DocxStyle>,
  'defaultStyle' | 'proposalStyle' | 'lander'
> & {
  lander(style: DocxStyle, runId: string): ReturnType<ReportSkillDeps<DocxStyle>['lander']>
}

/** write_report in the Word editor: docx-report by default, docx-bid-proposal for an RFP */
export function createReportSkill(deps: DocsReportDeps): AgentSkill {
  return createShared<DocxStyle>({
    ...deps,
    defaultStyle: 'docx-report',
    proposalStyle: 'docx-bid-proposal',
    lander: (style, _id, runId) => deps.lander(style, runId),
  })
}
