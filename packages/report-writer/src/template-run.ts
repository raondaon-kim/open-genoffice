import { WHOLE_ATTACHMENT_CHARS, describeParts, mapAttachment, mustSeeParts } from './attachments'
import { parseChapterAnswer } from './blocks'
import { askChapter, askJson } from './budget'
import { gapsPrompt } from './prompts'
import { CHAPTER_ATTACHMENT_CHARS } from './run'
import { templatePlanPrompt, templateSectionPrompt } from './template-prompts'
import type {
  Attachment,
  AttachmentPart,
  Brief,
  LlmPort,
  ReportBlock,
  ReportOutcome,
  ReportProgress,
  TemplateForRun,
  TemplateLander,
  TemplateSection,
  WikiPort,
} from './types'
import { planWikiMaterial, readChapterPages } from './wiki'

/** sections asked at once; they land in template order */
export const SECTION_BATCH = 4

const PROPOSAL = /제안서|제안 ?요청서|proposal|\bRFP\b/i

interface SectionPlan {
  point: string
  attachmentParts: string[]
  wikiPages: string[]
}
interface TemplatePlan {
  brief: Brief
  cover: Record<string, string>
  sections: Map<number, SectionPlan>
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

/** the model's plan, kept to the template: unknown sections, parts, pages and cover keys dropped */
function validateTemplatePlan(
  raw: unknown,
  t: TemplateForRun,
  known: { pages: Set<string>; parts: Set<string> },
): TemplatePlan {
  if (!raw || typeof raw !== 'object') throw new Error('the plan is not an object')
  const r = raw as Record<string, unknown>
  const b = (r.brief && typeof r.brief === 'object' ? r.brief : {}) as Record<string, unknown>
  const cover: Record<string, string> = {}
  if (r.cover && typeof r.cover === 'object') {
    for (const [k, v] of Object.entries(r.cover)) {
      if (t.coverLabels.includes(k) && str(v)) cover[k] = str(v)
    }
  }
  const valid = new Set(t.sections.map((s) => s.index))
  const sections = new Map<number, SectionPlan>()
  for (const item of Array.isArray(r.sections) ? r.sections : []) {
    const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const index = Number(s.index)
    if (!valid.has(index) || sections.has(index)) continue
    sections.set(index, {
      point: str(s.point),
      attachmentParts: strs(s.attachmentParts).filter((p) => known.parts.has(p)),
      wikiPages: strs(s.wikiPages).filter((p) => known.pages.has(p) || p.includes('/')),
    })
  }
  return {
    brief: {
      purpose: str(b.purpose),
      reader: str(b.reader),
      messages: strs(b.messages),
      terms: {},
    },
    cover,
    sections,
  }
}

/** the form already has the heading: headings in an answer are kept as paragraphs */
const flatten = (blocks: ReportBlock[]): ReportBlock[] =>
  blocks.map((b) =>
    b.type === 'chapter' || b.type === 'section' || b.type === 'subsection'
      ? { type: 'paragraph', text: b.text }
      : b,
  )

const partBlock = (p: AttachmentPart): string =>
  `### ${p.id} | ${p.label} (${p.attachment})\n${p.text}`

/**
 * Writes a document into a team template's fixed outline: cover values first, then every leaf
 * section in order under its existing heading, then the open-items table. Never throws.
 */
export async function writeFromTemplate(
  req: { request: string; template: TemplateForRun; attachments: Attachment[] },
  ports: {
    llm: LlmPort
    wiki: WikiPort | null
    lander: TemplateLander
    progress(e: ReportProgress): void
  },
  signal?: AbortSignal,
): Promise<ReportOutcome> {
  const { llm, wiki, lander, progress } = ports
  const t = req.template
  let written = 0
  const failed: number[] = []
  const cancel = (): ReportOutcome => {
    progress({ kind: 'cancelled', written })
    return { ok: false, error: 'cancelled', written }
  }
  const fail = (error: string): ReportOutcome => {
    progress({ kind: 'error', error })
    return { ok: false, error, written }
  }
  try {
    progress({ kind: 'reading' })
    const unreadable = req.attachments.find((a) => !a.text.trim())
    if (unreadable) return fail(`첨부를 읽을 수 없습니다: ${unreadable.name}`)
    const parts = req.attachments.flatMap((a, i) => mapAttachment(a, i))
    const total = req.attachments.reduce((n, a) => n + a.text.length, 0)
    const whole =
      req.attachments.length === 0
        ? ''
        : total < WHOLE_ATTACHMENT_CHARS
          ? req.attachments.map((a) => `### 첨부: ${a.name}\n${a.text}`).join('\n\n')
          : null
    const kind = PROPOSAL.test(`${t.title} ${req.request}`) ? 'proposal' : 'report'

    if (signal?.aborted) return cancel()
    progress({ kind: 'planning' })
    const material = wiki
      ? await planWikiMaterial(wiki, req.request)
      : { text: '', pages: new Set<string>() }
    const known = {
      pages: new Set([...material.pages, ...t.wikiPages]),
      parts: new Set(parts.map((p) => p.id)),
    }
    const planned = await askJson(
      llm,
      templatePlanPrompt({
        request: req.request,
        template: t,
        kind,
        ...(whole
          ? { attachmentsWhole: whole }
          : whole === null
            ? {
                attachmentMap: describeParts(parts),
                mustSee: mustSeeParts(parts).map(partBlock).join('\n\n'),
              }
            : {}),
        wiki: material.text,
      }),
      (text) => validateTemplatePlan(JSON.parse(text), t, known),
      signal,
    )
    if (!planned.ok) {
      return planned.error === 'cancelled'
        ? cancel()
        : fail(`계획을 세우지 못했습니다: ${planned.error}`)
    }
    const plan = planned.value
    await lander.cover(plan.cover)
    const gaps: Array<{ no: number; need: string }> = t.coverLabels
      .filter((label) => !plan.cover[label])
      .map((label) => ({ no: 0, need: `표지의 ${label}` }))

    const ledger: string[] = []
    /** one section's answer: asked in parallel with its batch, landed in order */
    const ask = async (s: TemplateSection) => {
      const sp = plan.sections.get(s.index) ?? { point: '', attachmentParts: [], wikiPages: [] }
      const pageIds = [...new Set([...t.wikiPages, ...sp.wikiPages])]
      const wikiPages = wiki && pageIds.length ? await readChapterPages(wiki, pageIds) : []
      let attachment = whole ?? ''
      if (whole === null) {
        let left = CHAPTER_ATTACHMENT_CHARS
        const out: string[] = []
        for (const id of sp.attachmentParts) {
          const p = parts.find((x) => x.id === id)
          if (!p || left <= 0) continue
          const block = partBlock(p).slice(0, left)
          out.push(block)
          left -= block.length
        }
        attachment = out.join('\n\n')
      }
      return askChapter(
        llm,
        templateSectionPrompt({
          template: t,
          section: s,
          point: sp.point,
          brief: plan.brief,
          // claims of the batches already landed
          ledger: [...ledger],
          attachment,
          wikiPages,
          kind,
        }),
        signal,
      )
    }
    for (let at = 0; at < t.sections.length; at += SECTION_BATCH) {
      if (signal?.aborted) return cancel()
      const batch = t.sections.slice(at, at + SECTION_BATCH)
      batch.forEach((s, k) =>
        progress({ kind: 'chapter', no: at + k + 1, of: t.sections.length, title: s.heading }),
      )
      const answers = await Promise.all(batch.map(ask))
      for (let k = 0; k < batch.length; k++) {
        const s = batch[k]!
        const answer = answers[k]!
        const no = at + k + 1
        if (!answer.ok && answer.stopped) return cancel()
        const parsed = answer.ok ? parseChapterAnswer(answer.text) : null
        if (!parsed || parsed.blocks.length === 0) {
          failed.push(no)
          await lander.sectionFailed(s.index, s.heading)
          progress({
            kind: 'chapter-failed',
            no,
            title: s.heading,
            error: answer.ok ? 'empty section' : answer.error,
          })
          continue
        }
        await lander.section(s.index, flatten(parsed.blocks))
        written++
        for (const c of parsed.claims) ledger.push(`${s.heading}: ${c}`)
        for (const g of parsed.gaps) gaps.push({ no, need: g })
      }
    }

    if (signal?.aborted) return cancel()
    if (gaps.length > 0) {
      const table = await askChapter(llm, gapsPrompt(gaps), signal)
      if (!table.ok && table.stopped) return cancel()
      await lander.gaps(table.ok ? parseChapterAnswer(table.text).blocks : [])
    } else {
      await lander.gaps([])
    }
    await lander.finish()
    progress({ kind: 'done', written, failed })
    return { ok: true, written, failed, gaps: gaps.length }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}
