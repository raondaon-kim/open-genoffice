import type { Editor } from '@tiptap/core'
import type { Node as ProseNode } from '@tiptap/pm/model'
import type { ReportBlock, TemplateForRun, TemplateLander } from '@genoffice/report-writer'
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
const isHeading = (n: ProseNode) => n.type.name === 'docHeading'
const isEmptySlot = (n: ProseNode) => n.type.name === 'docParagraph' && n.textContent === ''
/** a form table: its header row kept, every other row empty */
const isEmptyFormTable = (n: ProseNode) => {
  if (!/table/i.test(n.type.name) || n.childCount < 2) return false
  let empty = true
  n.forEach((row, _o, i) => {
    if (i > 0 && row.textContent.trim()) empty = false
  })
  return empty
}

/**
 * Lands a template fill in the opened form: the form already holds every heading, an empty slot
 * paragraph after each and empty tables. A section goes into its heading's slot (headings are
 * found by ordinal, so edits above do not misplace it); its table replaces the form's empty one.
 */
export function createTemplateLander(
  deps: DocsLanderDeps & { template: TemplateForRun },
): TemplateLander {
  const editor = () => deps.editor()
  const nodes = (blocks: ReportBlock[]) =>
    withoutAiHighlight(reportBlockNodes(deps.style, blocks, deps.numIds()))

  const remove = (from: number, to: number) => {
    const e = editor()
    e.view.dispatch(e.state.tr.delete(from, to))
  }

  /** the heading's top-level index and the end (exclusive) of its section */
  const sectionRange = (ordinal: number): { heading: number; end: number } | null => {
    const all = tops(editor())
    const headings = all.filter((t) => isHeading(t.node))
    const h = headings[ordinal]
    if (!h) return null
    const next = all.find((t) => t.index > h.index && isHeading(t.node))
    return { heading: h.index, end: next ? next.index : all.length }
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
      const firstHeading = all.findIndex((t) => isHeading(t.node))
      const cover = (firstHeading < 0 ? all : all.slice(0, firstHeading)).reverse()
      for (const t of cover) {
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
      const all = tops(editor())
      for (const t of [...all].reverse()) {
        const before = all[t.index - 1]
        if (before && isHeading(before.node) && isEmptySlot(t.node)) {
          remove(t.offset, t.offset + t.node.nodeSize)
        }
      }
    },
  }
}
