import type { AgentSkill } from '@genoffice/agent-core'
import {
  createReportSkill as createShared,
  type Lander,
  type ReportSkillDeps,
} from '@genoffice/report-writer'
import type { DocStyle } from '../../../shared/doc-style'

export type HwpReportDeps = Omit<
  ReportSkillDeps<DocStyle>,
  'defaultStyle' | 'proposalStyle' | 'lander'
> & {
  /** may refuse a style it cannot fill (throws) */
  lander(style: DocStyle, styleId: string): Lander | Promise<Lander>
}

/** write_report in the Hangul editor: the narrative report style by default, bid-proposal for an RFP */
export function createReportSkill(deps: HwpReportDeps): AgentSkill {
  return createShared<DocStyle>({
    ...deps,
    defaultStyle: 'report',
    proposalStyle: 'bid-proposal',
    lander: (style, styleId) => deps.lander(style, styleId),
  })
}
