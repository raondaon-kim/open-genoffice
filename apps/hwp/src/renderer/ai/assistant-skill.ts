import { composeSkills } from '@genoffice/agent-core'
import type { AgentSkill } from '@genoffice/agent-core'
import { createWorkWikiSkill } from '@genoffice/work-wiki'
import type { WorkWikiApi } from '@genoffice/work-wiki'
import type { HwpAttachment } from '../../shared/ipc'
import type { HwpAiContext } from './context'
import { createFilesSkill } from './files-skill'
import { createHwpSkill } from './hwp-skill'
import { createHwpReportSkill, type HwpReportWiring } from './report/wiring'

/** everything the Hangul assistant can do: the document, whole reports, attachments and the work wiki */
export function createHwpAssistantSkill(
  ctx: HwpAiContext,
  getAttachments: () => HwpAttachment[],
  filesApi: Parameters<typeof createFilesSkill>[1],
  workWiki: () => WorkWikiApi | undefined,
  report?: HwpReportWiring,
): AgentSkill {
  return composeSkills('hwp+files', '', [
    createHwpSkill(ctx),
    // a whole document from attachments and the work wiki: outline first, then chapter by chapter
    ...(report ? [createHwpReportSkill(ctx, getAttachments, workWiki, report)] : []),
    createFilesSkill(getAttachments, filesApi),
    createWorkWikiSkill(workWiki),
  ])
}
