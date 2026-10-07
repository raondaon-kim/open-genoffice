import { levelStep } from '../shared/paragraph-roles'
import { dumpForShape } from './dump-shape'
import type { RunRhwpFn } from './rhwp-cli'
import { DELETE_ALL_COUNT } from './rhwp-edit-ops'
import type { CompiledStep, LikeDynamic, SetDynamic } from './rhwp-edit-ops'
import { parseDumpParagraphs } from './rhwp-paragraphs'
import type { DumpParagraph } from './rhwp-paragraphs'

/**
 * Expands an insert_paragraph_like template step (spec §4.4) from the document as it is
 * right before the step runs: the model paragraph's shape is read from `dump`, never taken
 * from the renderer.
 */

export type Expanded =
  | { ok: true; steps: CompiledStep[]; derived?: { lead: number; step: number } }
  | { ok: false; error: string }

// the dump's alignment word (lowercased) -> the word apply-para-format takes
const ALIGN_WORDS: Record<string, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
  distribute: 'distribute',
  split: 'division',
}
const n = (value: number): string => String(value)

export function expandLike(
  opIndex: number,
  dyn: LikeDynamic,
  paragraphs: DumpParagraph[],
): Expanded {
  const like = paragraphs.find(
    (p) => p.section === dyn.like.section && p.paragraph === dyn.like.paragraph,
  )
  const name = `${dyn.like.section}.${dyn.like.paragraph}`
  if (!like) return { ok: false, error: `like paragraph ${name} does not exist` }
  if (like.empty) {
    return {
      ok: false,
      error: `like paragraph ${name} is blank — pick a paragraph that holds text (see the roles in form_map)`,
    }
  }
  const step = levelStep(paragraphs)
  const lead = Math.max(0, (like.lead ?? 0) + dyn.depth * step)
  const where = ['--section', n(dyn.target.section), '--para', n(dyn.target.paragraph + 1)]

  const para: Record<string, number | string> = {}
  const alignment = like.align === undefined ? undefined : ALIGN_WORDS[like.align]
  if (alignment !== undefined) para.alignment = alignment
  if (like.marginLeft !== undefined) para.marginLeft = like.marginLeft
  if (like.marginRight !== undefined) para.marginRight = like.marginRight
  if (like.indent !== undefined) para.indent = like.indent
  if (like.spacingBefore !== undefined) para.spacingBefore = like.spacingBefore
  if (like.spacingAfter !== undefined) para.spacingAfter = like.spacingAfter
  if (like.lineSpacing !== undefined) para.lineSpacing = like.lineSpacing

  const char: Record<string, number | boolean> = {}
  if (like.fontSize !== undefined) char.fontSize = Math.round(like.fontSize * 100)
  if (like.bold !== undefined) char.bold = like.bold

  const steps: CompiledStep[] = [
    { opIndex, command: 'insert-paragraph', flags: [...where] },
    {
      opIndex,
      command: 'insert-text',
      flags: [...where, '--offset', '0', '--text', `${' '.repeat(lead)}${dyn.text}`],
    },
  ]
  if (Object.keys(para).length > 0) {
    steps.push({
      opIndex,
      command: 'apply-para-format',
      flags: ['--props', JSON.stringify(para), ...where],
    })
  }
  if (Object.keys(char).length > 0) {
    steps.push({
      opIndex,
      command: 'apply-char-format',
      flags: ['--props', JSON.stringify(char), ...where],
    })
  }
  return { ok: true, steps, ...(dyn.depth !== 0 ? { derived: { lead, step } } : {}) }
}

/** read the document as it is now and expand a template step */
export async function expandLikeStep(
  run: RunRhwpFn,
  rhwpPath: string,
  file: string,
  step: CompiledStep,
): Promise<Expanded> {
  if (!step.dynamic) return { ok: false, error: 'internal error: not a template step' }
  const paragraphs = await readParagraphs(run, rhwpPath, file)
  if ('error' in paragraphs) return { ok: false, error: paragraphs.error }
  return expandLike(step.opIndex, step.dynamic, paragraphs)
}

/**
 * Expands a set_paragraph_text step: text typed without leading spaces keeps the paragraph's
 * own indentation (the model is told never to type it); text that starts with spaces is
 * written exactly as given, and an empty text clears the paragraph completely.
 */
export function expandSetText(
  opIndex: number,
  dyn: SetDynamic,
  paragraphs: DumpParagraph[],
): Expanded {
  const target = paragraphs.find(
    (p) => p.section === dyn.target.section && p.paragraph === dyn.target.paragraph,
  )
  const typedLead = [0x20, 0x09, 0x3000].includes(dyn.text.charCodeAt(0))
  const keep = dyn.text.length > 0 && !typedLead ? (target?.leadChars ?? 0) : 0
  const where = ['--section', n(dyn.target.section), '--para', n(dyn.target.paragraph)]
  const steps: CompiledStep[] = [
    {
      opIndex,
      command: 'delete-text',
      flags: [...where, '--offset', n(keep), '--count', n(DELETE_ALL_COUNT)],
    },
  ]
  if (dyn.text.length > 0) {
    steps.push({
      opIndex,
      command: 'insert-text',
      flags: [...where, '--offset', n(keep), '--text', dyn.text],
    })
  }
  return { ok: true, steps }
}

async function readParagraphs(
  run: RunRhwpFn,
  rhwpPath: string,
  file: string,
): Promise<DumpParagraph[] | { error: string }> {
  try {
    const dumped = await dumpForShape(run, rhwpPath, file)
    if (dumped.exitCode !== 0 || dumped.stdout === undefined) {
      return { error: 'could not read the document to copy the paragraph shape' }
    }
    return parseDumpParagraphs(dumped.stdout)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/** read the document as it is now and expand a set_paragraph_text step */
export async function expandSetStep(
  run: RunRhwpFn,
  rhwpPath: string,
  file: string,
  step: CompiledStep,
): Promise<Expanded> {
  if (!step.setText) return { ok: false, error: 'internal error: not a set step' }
  const paragraphs = await readParagraphs(run, rhwpPath, file)
  if ('error' in paragraphs) return { ok: false, error: paragraphs.error }
  return expandSetText(step.opIndex, step.setText, paragraphs)
}
