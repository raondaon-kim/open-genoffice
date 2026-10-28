import type { Editor } from '@tiptap/core'
import type { Node as ProseNode } from '@tiptap/pm/model'
import type { ReportBlock, TemplateForRun, TemplateLander } from '@genoffice/report-writer'
import { normalizeHeading } from '@genoffice/team-templates/md'
import { insertBlocksAfter } from '../protocol'
import { reportBlockNodes, withoutAiHighlight, type DocsLanderDeps } from './docs-lander'

interface Top {
  node: ProseNode
  offset: number
  index: number
}

const tops = (editor: Editor): Top[] => {
  const out: Top[] = []
  editor.state.doc.forEach((node, offset, index) => out.push({ node, offset, index }))
  return out
}
/** a heading can be a docHeading, a numbered heading (docListItem) or a guessed bold paragraph */
const HEADING_CAPABLE = new Set(['docHeading', 'docParagraph', 'docListItem'])
const isEmptySlot = (n: ProseNode) =>
  (n.type.name === 'docParagraph' || n.type.name === 'docListItem') && n.textContent === ''
/** a form table: its header row kept, every other row empty */
const isEmptyFormTable = (n: ProseNode) => {
  if (!/table/i.test(n.type.name) || n.childCount < 1) return false
  let empty = true
  n.forEach((row, _o, i) => {
    if (i > 0 && row.textContent.trim()) empty = false
  })
  return empty
}

const key = (text: string) => normalizeHeading(text) || text.replace(/\s+/g, '')

/**
 * The top-level index of each outline heading in the open document, found in order by its text
 * (numbering ignored), whatever node type Word's import gave it. `missing` is the first outline
 * heading the document does not have.
 */
export function locateHeadings(
  editor: Editor,
  headings: string[],
): { at: number[]; missing: string | null } {
  const all = tops(editor)
  const at: number[] = []
  let cursor = 0
  for (const heading of headings) {
    const wanted = key(heading)
    const hit = all.find(
      (t) =>
        t.index >= cursor &&
        HEADING_CAPABLE.has(t.node.type.name) &&
        t.node.textContent.trim() !== '' &&
        key(t.node.textContent) === wanted,
    )
    if (!hit) return { at, missing: heading }
    at.push(hit.index)
    cursor = hit.index + 1
  }
  return { at, missing: null }
}

/** true when no section heading still has its empty slot after it (the copy was filled) */
export function isFilled(editor: Editor, template: TemplateForRun): boolean {
  const { at, missing } = locateHeadings(editor, template.headings ?? [])
  if (missing) return false
  const all = tops(editor)
  return template.sections.every((s) => {
    const next = all[(at[s.index] ?? -2) + 1]
    return !next || !isEmptySlot(next.node)
  })
}

/**
 * Lands a template fill in the opened form: the form already holds every heading, an empty slot
 * paragraph after each and empty tables. A section goes into its heading's slot (headings are
 * found by text, in order, so edits above do not misplace it); its table replaces the form's
 * empty one.
 */
export function createTemplateLander(
  deps: DocsLanderDeps & { template: TemplateForRun },
): TemplateLander {
  const editor = () => deps.editor()
  const outline = deps.template.headings ?? deps.template.sections.map((s) => s.heading)
  const nodes = (blocks: ReportBlock[]) =>
    withoutAiHighlight(reportBlockNodes(deps.style, blocks, deps.numIds()))

  const remove = (from: number, to: number) => {
    const e = editor()
    e.view.dispatch(e.state.tr.delete(from, to))
  }

  /** the heading's top-level index and the end (exclusive) of its section */
  const sectionRange = (ordinal: number): { heading: number; end: number } | null => {
    const { at } = locateHeadings(editor(), outline)
    const heading = at[ordinal]
    if (heading === undefined) return null
    return { heading, end: at[ordinal + 1] ?? tops(editor()).length }
  }

  const land = (ordinal: number, blocks: ReportBlock[]) => {
    const range = sectionRange(ordinal)
    if (!range) {
      // the heading is gone: the text still lands, at the end
      insertBlocksAfter(editor(), tops(editor()).length - 1, nodes(blocks), deps.track?.())
      return
    }
    if (blocks.some((b) => b.type === 'table')) {
      // bottom-up so earlier offsets stay valid
      for (const t of tops(editor())
        .filter((t) => t.index > range.heading && t.index < range.end && isEmptyFormTable(t.node))
        .reverse()) {
        remove(t.offset, t.offset + t.node.nodeSize)
      }
    }
    const after = tops(editor())[range.heading + 1]
    const slot = after && isEmptySlot(after.node) ? after : null
    const anchor = slot ? slot.index : range.heading
    insertBlocksAfter(editor(), anchor, nodes(blocks), deps.track?.())
    if (slot) {
      const fresh = tops(editor())[slot.index]
      if (fresh && isEmptySlot(fresh.node)) remove(fresh.offset, fresh.offset + fresh.node.nodeSize)
    }
  }

  return {
    async cover(values) {
      const all = tops(editor())
      const first = locateHeadings(editor(), outline.slice(0, 1)).at[0] ?? all.length
      for (const t of all.slice(0, first).reverse()) {
        const label = /^\[(.+)\]$/.exec(t.node.textContent.trim())?.[1]
        const value = label ? values[label] : undefined
        if (!value) continue
        const e = editor()
        e.view.dispatch(e.state.tr.insertText(value, t.offset + 1, t.offset + t.node.nodeSize - 1))
      }
    },
    async section(ordinal, blocks) {
      land(ordinal, blocks)
    },
    async sectionFailed(ordinal, heading) {
      land(ordinal, [{ type: 'paragraph', text: `이 절을 쓰지 못했습니다: ${heading}` }])
    },
    async gaps(blocks) {
      if (blocks.length === 0) return
      insertBlocksAfter(editor(), tops(editor()).length - 1, nodes(blocks), deps.track?.())
    },
    async finish() {
      // slots the run did not fill do not stay as blank lines under their headings
      const { at } = locateHeadings(editor(), outline)
      const all = tops(editor())
      for (const h of [...at].reverse()) {
        const next = all[h + 1]
        if (next && isEmptySlot(next.node)) remove(next.offset, next.offset + next.node.nodeSize)
      }
    },
  }
}
