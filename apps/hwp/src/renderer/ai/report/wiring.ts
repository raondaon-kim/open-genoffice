import type { AgentSkill } from '@genoffice/agent-core'
import {
  readAllAttachments,
  wikiPortOf,
  type LlmPort,
  type ReportProgress,
  type WorkWikiLike,
} from '@genoffice/report-writer'
import type { HwpAttachment, HwpAttachmentRead } from '../../../shared/ipc'
import type { HwpAiContext } from '../context'
import { runQuery } from '../query'
import { snapshotFileName } from '../tools/edit'
import { createHwpLander } from './hwp-lander'
import { createReportSkill } from './report-skill'

export interface HwpReportWiring {
  llm(): LlmPort
  progress(e: ReportProgress): void
  readAttachment(path: string, offset: number, maxChars: number): Promise<HwpAttachmentRead>
}

/** the open document has no text on its first page (a new document): write_report may fill it live */
export async function isBlankDocument(ctx: HwpAiContext): Promise<boolean> {
  if (!ctx.editor()) return false
  try {
    const outcome = await runQuery(ctx, 'export_text', { page: 0 })
    const pages = (outcome.envelope as { pages?: Array<{ text?: unknown }> }).pages ?? []
    return pages.every((p) => typeof p.text !== 'string' || !p.text.trim())
  } catch {
    return false
  }
}

/** write_report for the Hangul panel, wired to the open document, attachments and work wiki */
export function createHwpReportSkill(
  ctx: HwpAiContext,
  getAttachments: () => HwpAttachment[],
  workWiki: () => WorkWikiLike | undefined,
  wiring: HwpReportWiring,
): AgentSkill {
  return createReportSkill({
    llm: wiring.llm,
    progress: wiring.progress,
    wiki: () => wikiPortOf(workWiki()),
    attachments: () => readAllAttachments(getAttachments(), wiring.readAttachment),
    readStyle: async (id) => {
      const r = await ctx.api().readDocStyle(id)
      return r.ok ? { style: r.style, description: r.description } : null
    },
    lander: async (style, styleId) =>
      createHwpLander({
        style,
        styleId,
        live: await isBlankDocument(ctx),
        build: (blocks) => ctx.api().buildStyledBytes({ style: styleId, blocks }),
        load: async (bytes) => {
          const editor = ctx.editor()
          if (!editor) throw new Error('the document is not open')
          await editor.loadFile(bytes, snapshotFileName(ctx.fileName(), bytes), {
            skipUnsavedGuard: true,
          })
          ctx.markAiDirty()
        },
        saveUndo: async () => {
          const editor = ctx.editor()
          if (editor) ctx.stack.push(await ctx.stack.capture(editor))
        },
        create: async (blocks) => {
          const first = blocks[0]
          const fileName = first && 'text' in first ? first.text.slice(0, 60) : undefined
          const r = await ctx.api().createStyledDocument({ style: styleId, blocks, fileName })
          return r.ok ? { ok: true } : { ok: false, error: r.error }
        },
      }),
  })
}
