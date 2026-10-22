import type { Editor } from '@tiptap/core'
import type { DocxRole, DocxStyle } from '@genoffice/doc-styles'
import type { Lander, ReportBlock, Skeleton } from '@genoffice/report-writer'
import type { PmNode } from '../../editor/convert'
import {
  insertBlocksAfter,
  isBlankDocument,
  parseHtmlFragment,
  replaceBlockRange,
  type AiTrack,
  type NumIds,
} from '../protocol'
import { styledBlockNodes } from '../styles-skill'

export interface DocsLanderDeps {
  editor(): Editor
  style: DocxStyle
  numIds(): NumIds
  track?(): AiTrack | undefined
  /** marks this run's placeholders so they are found again after edits */
  runId: string
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** the style's roles for each kind of report block, with sensible stand-ins */
function roleSet(style: DocxStyle) {
  const byKind = (kind: DocxRole['kind']) => style.roles.find((r) => r.kind === kind)
  const body = style.roles.find((r) => r.id === 'body') ?? byKind('body') ?? style.roles[0]!
  const heading = (level: number): DocxRole => {
    const exact = style.roles.find((r) => r.kind === 'heading' && (r.heading ?? 1) === level)
    if (exact) return exact
    const base = style.roles.find((r) => r.kind === 'heading') ?? { ...body, bold: true }
    return {
      ...base,
      kind: 'heading',
      heading: level,
      size: Math.max(base.size - 2 * (level - 1), body.size),
    }
  }
  const list = byKind('list')
  const bullet: DocxRole | null = list ? { ...list, bullet: 'bullet' } : null
  const numbered: DocxRole | null = list ? { ...list, bullet: 'number' } : null
  return {
    title: byKind('title') ?? heading(1),
    body,
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    bullet,
    numbered,
  }
}

/**
 * Lands a report in the open Word document: the skeleton (title, table of contents, one
 * placeholder per chapter) first, then each chapter in place of its placeholder. Placeholders
 * carry `⟦runId·slot⟧` and are found by scanning the document before every replacement, so
 * edits above them do not misplace a chapter.
 */
export function createDocsLander(deps: DocsLanderDeps): Lander {
  const roles = roleSet(deps.style)
  const marker = (slot: string) => `⟦${deps.runId}·${slot}⟧`

  const toNodes = (blocks: ReportBlock[]): PmNode[] => {
    const out: PmNode[] = []
    let n = 0
    for (const b of blocks) {
      if (b.type === 'table') {
        const [head, ...rows] = b.rows
        const tr = (cells: string[], tag: 'th' | 'td') =>
          `<tr>${cells.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`
        const html = `<table>${head ? tr(head, 'th') : ''}${rows.map((r) => tr(r, 'td')).join('')}</table>`
        out.push(...parseHtmlFragment(html, deps.numIds()))
        continue
      }
      if (b.type !== 'numbered') n = 0
      const pick = (): { role: DocxRole; text: string } => {
        switch (b.type) {
          case 'chapter':
            return { role: roles.h1, text: b.text }
          case 'section':
            return { role: roles.h2, text: b.text }
          case 'subsection':
            return { role: roles.h3, text: b.text }
          case 'bullet':
            return roles.bullet
              ? { role: roles.bullet, text: b.text }
              : { role: roles.body, text: `• ${b.text}` }
          case 'numbered':
            n++
            return roles.numbered
              ? { role: roles.numbered, text: b.text }
              : { role: roles.body, text: `${n}. ${b.text}` }
          default:
            return { role: roles.body, text: b.text }
        }
      }
      out.push(...styledBlockNodes(deps.style, [pick()], deps.numIds()))
    }
    return out
  }
  const bodyNodes = (lines: string[]) =>
    styledBlockNodes(
      deps.style,
      lines.map((text) => ({ role: roles.body, text })),
      deps.numIds(),
    )

  const find = (slot: string): number => {
    const editor = deps.editor()
    const m = marker(slot)
    let found = -1
    editor.state.doc.forEach((node, _offset, index) => {
      if (found < 0 && node.textContent.startsWith(m)) found = index
    })
    return found
  }
  const lastIndex = () => deps.editor().state.doc.childCount - 1
  const put = (slot: string, nodes: PmNode[]) => {
    const editor = deps.editor()
    const at = find(slot)
    if (at >= 0) {
      // the chapter goes in after its placeholder (tracked when track changes is on), then the
      // run's own placeholder is removed untracked: a tracked replace would keep the marker
      // in the document as a deletion
      if (nodes.length > 0) insertBlocksAfter(editor, at, nodes, deps.track?.())
      remove(at)
    } else if (nodes.length > 0) {
      // the user deleted the placeholder: the text still lands, at the end
      insertBlocksAfter(editor, lastIndex(), nodes, deps.track?.())
    }
  }
  const remove = (index: number) => {
    const editor = deps.editor()
    if (editor.state.doc.childCount <= 1) {
      replaceBlockRange(editor, 0, 0, bodyNodes(['']), deps.track?.())
      return
    }
    let from = -1
    let to = -1
    editor.state.doc.forEach((node, offset, i) => {
      if (i === index) {
        from = offset
        to = offset + node.nodeSize
      }
    })
    if (from >= 0) editor.view.dispatch(editor.state.tr.delete(from, to))
  }
  const openSlots = new Set<string>()
  const placeholder = (slot: string, label: string) => {
    openSlots.add(slot)
    return `${marker(slot)} ${label} — 쓰는 중…`
  }
  const close = (slot: string) => openSlots.delete(slot)
  const dropOpen = () => {
    for (const slot of [...openSlots]) {
      const at = find(slot)
      if (at >= 0) remove(at)
      close(slot)
    }
  }

  return {
    async skeleton(s: Skeleton) {
      const editor = deps.editor()
      const lines: PmNode[] = []
      lines.push(
        ...styledBlockNodes(deps.style, [{ role: roles.title, text: s.title }], deps.numIds()),
      )
      if (s.withSummary) lines.push(...bodyNodes([placeholder('summary', '요약')]))
      lines.push(...styledBlockNodes(deps.style, [{ role: roles.h1, text: '목차' }], deps.numIds()))
      for (const c of s.chapters) {
        lines.push(...bodyNodes([`${c.no}. ${c.title}`, ...c.sections]))
      }
      for (const c of s.chapters)
        lines.push(...bodyNodes([placeholder(`c${c.no}`, `${c.no}. ${c.title}`)]))
      if (s.withSummary) lines.push(...bodyNodes([placeholder('gaps', '확인 필요 사항')]))
      const ok = isBlankDocument(editor)
        ? replaceBlockRange(editor, 0, 0, lines, deps.track?.())
        : insertBlocksAfter(editor, lastIndex(), lines, deps.track?.())
      if (!ok) throw new Error('the table of contents could not be inserted into the document')
    },
    async chapter(no, blocks) {
      put(`c${no}`, toNodes(blocks))
      close(`c${no}`)
    },
    async chapterFailed(no, title) {
      put(`c${no}`, bodyNodes([`이 장을 쓰지 못했습니다: ${no}. ${title}`]))
      close(`c${no}`)
    },
    async summary(blocks) {
      put('summary', toNodes(blocks))
      close('summary')
    },
    async gaps(blocks) {
      put('gaps', toNodes(blocks))
      close('gaps')
    },
    abandon: async () => dropOpen(),
    // anything still open at the end (a slot the run skipped) does not stay in the document
    finish: async () => dropOpen(),
  }
}
