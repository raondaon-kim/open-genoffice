import { composeSkills } from '@genoffice/agent-core'
import type { AgentSkill } from '@genoffice/agent-core'
import { createWorkWikiSkill } from '@genoffice/work-wiki'
import type { WorkWikiApi } from '@genoffice/work-wiki'
import type { HwpAttachment } from '../../shared/ipc'
import type { HwpAiContext } from './context'
import { createFilesSkill } from './files-skill'
import { createHwpSkill } from './hwp-skill'

/** everything the Hangul assistant can do: the document, attachments and the work wiki */
export function createHwpAssistantSkill(
  ctx: HwpAiContext,
  getAttachments: () => HwpAttachment[],
  filesApi: Parameters<typeof createFilesSkill>[1],
  workWiki: () => WorkWikiApi | undefined,
): AgentSkill {
  return composeSkills('hwp+files', '', [
    createHwpSkill(ctx),
    createFilesSkill(getAttachments, filesApi),
    createWorkWikiSkill(workWiki),
  ])
}
