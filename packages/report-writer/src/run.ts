import { WHOLE_ATTACHMENT_CHARS, describeParts, mapAttachment, mustSeeParts } from './attachments'
import { parseBlocks, parseChapterAnswer } from './blocks'
import { askChapter, askJson } from './budget'
import { validatePlan } from './plan'
import { chapterPrompt, gapsPrompt, planPrompt, summaryPrompt } from './prompts'
import type {
  AttachmentPart,
  PlannedChapter,
  ReportOutcome,
  ReportPorts,
  ReportRequest,
} from './types'
import { planWikiMaterial, readChapterPages } from './wiki'

/** attachment text one chapter gets when the attachments are too large to give whole */
export const CHAPTER_ATTACHMENT_CHARS = 24000

const partBlock = (p: AttachmentPart): string =>
  `### ${p.id} | ${p.label} (${p.attachment})\n${p.text}`

function chapterAttachment(
  chapter: PlannedChapter,
  parts: AttachmentPart[],
  whole: string | null,
): string {
  if (whole !== null) return whole
  let left = CHAPTER_ATTACHMENT_CHARS
  const out: string[] = []
  for (const id of chapter.attachmentParts) {
    const p = parts.find((x) => x.id === id)
    if (!p || left <= 0) continue
    const block = partBlock(p).slice(0, left)
    out.push(block)
    left -= block.length
  }
  return out.join('\n\n')
}

/**
 * Writes a whole document: reads the attachments (mandatory, first-priority material), plans
 * from them and the wiki's index, lands the title and table of contents, then fills the
 * chapters one after another, then the summary and the gaps table. Never throws.
 */
export async function writeReport(
  req: ReportRequest,
  ports: ReportPorts,
  signal?: AbortSignal,
): Promise<ReportOutcome> {
  const { llm, wiki, lander, progress } = ports
  let written = 0
  let landed = false
  const failed: number[] = []

  const cancel = async (): Promise<ReportOutcome> => {
    if (landed) await lander.abandon().catch(() => undefined)
    progress({ kind: 'cancelled', written })
    return { ok: false, error: 'cancelled', written }
  }
  const fail = async (error: string): Promise<ReportOutcome> => {
    if (landed) await lander.abandon().catch(() => undefined)
    progress({ kind: 'error', error })
    return { ok: false, error, written }
  }

  try {
    progress({ kind: 'reading' })
    const unreadable = req.attachments.find((a) => !a.text.trim())
    if (unreadable) return await fail(`첨부를 읽을 수 없습니다: ${unreadable.name}`)
    const parts = req.attachments.flatMap((a, i) => mapAttachment(a, i))
    const total = req.attachments.reduce((n, a) => n + a.text.length, 0)
    const whole =
      req.attachments.length === 0
        ? ''
        : total < WHOLE_ATTACHMENT_CHARS
          ? req.attachments.map((a) => `### 첨부: ${a.name}\n${a.text}`).join('\n\n')
          : null

    if (signal?.aborted) return await cancel()
    progress({ kind: 'planning' })
    const wikiMaterial = wiki
      ? await planWikiMaterial(wiki, req.request)
      : { text: '', pages: new Set<string>() }
    const prompt = planPrompt({
      request: req.request,
      kind: req.kind,
      styleRules: req.styleRules,
      lengthHint: req.lengthHint,
      ...(whole
        ? { attachmentsWhole: whole }
        : whole === null
          ? {
              attachmentMap: describeParts(parts),
              mustSee: mustSeeParts(parts).map(partBlock).join('\n\n'),
            }
          : {}),
      wiki: wikiMaterial.text,
    })
    const known = { pages: wikiMaterial.pages, parts: new Set(parts.map((p) => p.id)) }
    const planned = await askJson(llm, prompt, (t) => validatePlan(JSON.parse(t), known), signal)
    if (!planned.ok) {
      return planned.error === 'cancelled'
        ? await cancel()
        : await fail(`목차를 만들지 못했습니다: ${planned.error}`)
    }
    const plan = planned.value
    const withSummary = !(req.kind === 'proposal' && plan.tocFromAttachment)

    await lander.skeleton({
      title: plan.title,
      withSummary,
      chapters: plan.chapters.map((c) => ({ no: c.no, title: c.title, sections: c.sections })),
    })
    landed = true

    const ledger: string[] = []
    const gaps: Array<{ no: number; need: string }> = []
    for (const chapter of plan.chapters) {
      if (signal?.aborted) return await cancel()
      progress({ kind: 'chapter', no: chapter.no, of: plan.chapters.length, title: chapter.title })
      const wikiPages =
        wiki && chapter.wikiPages.length ? await readChapterPages(wiki, chapter.wikiPages) : []
      const answer = await askChapter(
        llm,
        chapterPrompt({
          plan,
          chapter,
          ledger,
          attachment: chapterAttachment(chapter, parts, whole),
          wikiPages,
          kind: req.kind,
          styleRules: req.styleRules,
        }),
        signal,
      )
      if (!answer.ok && answer.stopped) return await cancel()
      const parsed = answer.ok ? parseChapterAnswer(answer.text) : null
      if (!parsed || parsed.blocks.length === 0) {
        const error = answer.ok ? 'empty chapter' : answer.error
        failed.push(chapter.no)
        await lander.chapterFailed(chapter.no, chapter.title)
        progress({ kind: 'chapter-failed', no: chapter.no, title: chapter.title, error })
        continue
      }
      await lander.chapter(chapter.no, parsed.blocks)
      written++
      for (const c of parsed.claims) ledger.push(`${chapter.no}장: ${c}`)
      for (const g of parsed.gaps) gaps.push({ no: chapter.no, need: g })
    }

    if (withSummary) {
      if (signal?.aborted) return await cancel()
      progress({ kind: 'summary' })
      const summary = await askChapter(llm, summaryPrompt(plan, ledger), signal)
      if (!summary.ok && summary.stopped) return await cancel()
      await lander.summary(summary.ok ? parseChapterAnswer(summary.text).blocks : [])
      if (gaps.length > 0) {
        const table = await askChapter(llm, gapsPrompt(gaps), signal)
        if (!table.ok && table.stopped) return await cancel()
        await lander.gaps(table.ok ? parseBlocks(table.text) : [])
      } else {
        await lander.gaps([])
      }
    }
    await lander.finish()
    progress({ kind: 'done', written, failed })
    return { ok: true, written, failed, gaps: gaps.length }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}
