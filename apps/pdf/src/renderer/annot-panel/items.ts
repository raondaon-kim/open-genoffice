// From IeumOffice (pblsketch/openoffice) apps/pdf/src/renderer/annot-panel/items.ts, 3c002a56,
// without the passage cards this app does not have.
/**
 * The annotation panel's list: one item model for saved annotations, unsaved
 * markups and notes, and whatever later features add. Pure.
 *
 * Extension points for later features:
 * - `AnnotBuildInput.extra`: more items (`AnnotItemDraft`), e.g. pending AI
 *   highlight suggestions while their preview is on. The builder fills in the
 *   page number and position like any other item.
 * - `AnnotKind` is open: a new kind is any string; give its items a
 *   `kindLabel`, and `KIND_ORDER` decides where it sits in the kind filter.
 * - `AnnotItem.category`: a label shown with the kind (an accepted AI
 *   highlight's /Subj), filtered through an `AnnotFacet` (filter.ts).
 * - `AnnotTarget` `custom`: an item's own click action.
 * - Per-item actions are rendered by the panel's `renderItemActions` prop.
 */
import type { MarkupType } from '../../shared/ipc'
import type { TFunc } from '../i18n/locale'
import { pdfToView, quadToRect, type LocalMarkup, type PageGeom } from '../annotations'
import {
  flattenThread,
  visibleNoteThreads,
  type NoteInput,
  type SavedNoteAnnot,
} from '../note-threads'
import { textUnderQuads, type TextRun } from './text-under'

export type Rgb = [number, number, number]
type Rect = [number, number, number, number]

export type CoreAnnotKind = 'highlight' | 'underline' | 'strikeout' | 'note' | 'other'
/** a core kind, or one a later feature adds (e.g. 'suggestion') */
export type AnnotKind = CoreAnnotKind | (string & {})

/** the kind filter's order; kinds not listed follow in the order they appear */
export const KIND_ORDER: readonly string[] = [
  'highlight',
  'underline',
  'strikeout',
  'note',
  'other',
]

/** what a click on the item does, after going to its place when it has one */
export type AnnotTarget =
  | { type: 'location' }
  | { type: 'note'; rootKey: string }
  | { type: 'custom'; activate: () => void }

export interface AnnotItem {
  /** unique in the list: 'S<obj>' saved markup/note, 'O<obj>' other saved, 'L<id>' unsaved markup, 'P<id>' unsaved note */
  key: string
  kind: AnnotKind
  /** the kind in the UI language */
  kindLabel: string
  /** in the file, made in this session and not saved yet, or kept in the result store */
  origin: 'saved' | 'unsaved' | 'store'
  /** original page index; null when the place is unknown */
  page: number | null
  /** 1-based page number as shown (unsaved page moves applied); null when unknown or deleted */
  pageNo: number | null
  /** PDF user space; where to scroll and what to flash */
  rect: Rect | null
  /** top-left of the item on its shown page: page-order sorting within a page */
  pos: [number, number]
  /** input order: the last tie-breaker */
  seq: number
  /** annotation color (document data); null when it has none */
  color: Rgb | null
  /** text under a markup, a note's first two lines; '' for other kinds */
  text: string
  /** an extension item's second line */
  detail?: string
  /** a note's whole text and its replies' texts (export) */
  memo?: string
  replyTexts?: readonly string[]
  /** an extension item's paragraphs after its quote (export) */
  body?: string
  replies?: number
  /** an accepted AI highlight's category (/Subj) */
  category?: string
  /** creation time (epoch ms); null when unknown */
  createdMs: number | null
  /** an extension item whose place is gone */
  notFound: boolean
  target: AnnotTarget
}

/** an item before the builder places it */
export type AnnotItemDraft = Omit<AnnotItem, 'pageNo' | 'pos' | 'seq' | 'notFound'> & {
  notFound?: boolean
}

export interface SavedMarkupRecord {
  pageIndex: number
  objNum: number
  type: MarkupType
  quads: number[][]
  rect: Rect
  color: Rgb | null
  createdMs: number | null
  /** the text under the quads */
  text: string
}

export interface OtherAnnotRecord {
  pageIndex: number
  objNum: number
  /** the PDF /Subtype, e.g. 'Ink' */
  subtype: string
  rect: Rect
  color: Rgb | null
  createdMs: number | null
}

export interface PageAnnotScan {
  markups: SavedMarkupRecord[]
  notes: SavedNoteAnnot[]
  others: OtherAnnotRecord[]
}

/** the whole document's saved annotations */
export type SavedAnnotScan = PageAnnotScan

export interface AnnotBuildInput {
  saved: SavedAnnotScan
  /** markups made in this session, not saved yet */
  unsavedMarkups: readonly LocalMarkup[]
  /** notes made in this session, not saved yet (replies included) */
  pendingNotes: readonly { id: string; input: NoteInput }[]
  /** saved annotations queued for deletion */
  deletedObjNums: ReadonlySet<number>
  /** pending rewrites of saved notes */
  editedNotes: ReadonlyMap<number, string>
  /** text content of pages with unsaved markups; a missing page means "still reading" */
  pageTexts: ReadonlyMap<number, readonly TextRun[]>
  /** 1-based shown page of an original page; null when the page is deleted */
  displayPage: (origIdx: number) => number | null
  /** page geometry, for top-to-bottom order on rotated pages */
  geomOf?: (origIdx: number) => PageGeom
  t: TFunc
  /** items from other features */
  extra?: readonly AnnotItemDraft[]
}

const SUBTYPE_KEYS = {
  Ink: 'apTypeInk',
  Square: 'apTypeSquare',
  Circle: 'apTypeCircle',
  Line: 'apTypeLine',
  Polygon: 'apTypePolygon',
  PolyLine: 'apTypePolyLine',
  Stamp: 'apTypeStamp',
  FreeText: 'apTypeFreeText',
  FileAttachment: 'apTypeFileAttachment',
  Squiggly: 'apTypeSquiggly',
  Caret: 'apTypeCaret',
  Redact: 'apTypeRedact',
  Sound: 'apTypeSound',
} as const

const MARKUP_KIND_KEYS = {
  highlight: 'apKindHighlight',
  underline: 'apKindUnderline',
  strikeout: 'apKindStrikeout',
} as const

/** the label of a kind in the kind filter */
export function kindFilterLabel(kind: string, t: TFunc, fallback: string): string {
  switch (kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return t(MARKUP_KIND_KEYS[kind])
    case 'note':
      return t('apKindNote')
    case 'other':
      return t('apKindOther')
    default:
      return fallback
  }
}

export function subtypeLabel(subtype: string, t: TFunc): string {
  const key = SUBTYPE_KEYS[subtype as keyof typeof SUBTYPE_KEYS]
  return key ? t(key) : t('apTypeUnknown', { name: subtype || '?' })
}

const firstLines = (s: string, n: number): string =>
  s
    .split(/\r\n|\r|\n/)
    .slice(0, n)
    .join('\n')

const quadsRect = (quads: readonly number[][]): Rect | null => {
  const rects = quads.filter((q) => q.length >= 8).map(quadToRect)
  if (rects.length === 0) return null
  return [
    Math.min(...rects.map((r) => r[0])),
    Math.min(...rects.map((r) => r[1])),
    Math.max(...rects.map((r) => r[2])),
    Math.max(...rects.map((r) => r[3])),
  ]
}

/** top-left on the shown page (y down); user space with y flipped when no geometry */
function positionOf(rect: Rect | null, page: number | null, geomOf?: AnnotBuildInput['geomOf']) {
  if (!rect) return [0, 0] as [number, number]
  if (page !== null && geomOf) {
    const g = geomOf(page)
    const [ax, ay] = pdfToView(g, rect[0], rect[1])
    const [bx, by] = pdfToView(g, rect[2], rect[3])
    return [Math.min(ay, by), Math.min(ax, bx)] as [number, number]
  }
  return [-rect[3], rect[0]] as [number, number]
}

/** the panel's items, unsorted (see sortAnnotItems) */
export function buildAnnotItems(o: AnnotBuildInput): AnnotItem[] {
  const { t } = o
  const drafts: AnnotItemDraft[] = []

  for (const m of o.saved.markups) {
    if (o.deletedObjNums.has(m.objNum)) continue
    drafts.push({
      key: `S${m.objNum}`,
      kind: m.type,
      kindLabel: t(MARKUP_KIND_KEYS[m.type]),
      origin: 'saved',
      page: m.pageIndex,
      rect: m.rect,
      color: m.color,
      text: m.text,
      createdMs: m.createdMs,
      target: { type: 'location' },
    })
  }

  for (const m of o.unsavedMarkups) {
    const runs = o.pageTexts.get(m.pageIndex)
    drafts.push({
      key: `L${m.id}`,
      kind: m.type,
      kindLabel: t(MARKUP_KIND_KEYS[m.type]),
      origin: 'unsaved',
      page: m.pageIndex,
      rect: quadsRect(m.quads),
      color: m.color,
      text: runs ? textUnderQuads(runs, m.quads) : '',
      createdMs: null,
      target: { type: 'location' },
    })
  }

  // note threads per page: roots only, with their reply counts
  const notePages = new Set<number>([
    ...o.saved.notes.map((n) => n.pageIndex),
    ...o.pendingNotes.map((n) => n.input.pageIndex),
  ])
  for (const page of [...notePages].sort((a, b) => a - b)) {
    const roots = visibleNoteThreads(
      o.saved.notes.filter((n) => n.pageIndex === page),
      o.pendingNotes.filter((n) => n.input.pageIndex === page),
      o.deletedObjNums,
      o.editedNotes,
    )
    for (const root of roots) {
      const all = flattenThread(root)
      const replies = all.slice(1).map(({ item }) => item.contents)
      const rect: Rect = root.saved
        ? root.saved.rect
        : [root.at[0], root.at[1], root.at[0], root.at[1]]
      drafts.push({
        key: root.key,
        kind: 'note',
        kindLabel: t('apKindNote'),
        origin: root.saved ? 'saved' : 'unsaved',
        page,
        rect,
        color: root.color,
        text: firstLines(root.contents, 2),
        memo: root.contents,
        replyTexts: replies,
        replies: replies.length,
        createdMs: root.timeMs,
        target: { type: 'note', rootKey: root.key },
      })
    }
  }

  for (const a of o.saved.others) {
    if (o.deletedObjNums.has(a.objNum)) continue
    drafts.push({
      key: `O${a.objNum}`,
      kind: 'other',
      kindLabel: subtypeLabel(a.subtype, t),
      origin: 'saved',
      page: a.pageIndex,
      rect: a.rect,
      color: a.color,
      text: '',
      createdMs: a.createdMs,
      target: { type: 'location' },
    })
  }

  drafts.push(...(o.extra ?? []))

  const items: AnnotItem[] = []
  drafts.forEach((d, seq) => {
    const shown = d.page === null ? null : o.displayPage(d.page)
    if (d.page !== null && shown === null) {
      // the page is deleted in this session: its items go with it
      return
    }
    items.push({
      ...d,
      pageNo: shown,
      pos: positionOf(d.rect, d.page, o.geomOf),
      seq,
      notFound: d.notFound ?? false,
    })
  })
  return items
}

/** what the screen does for a click: go to the place, then open what the item is */
export interface AnnotActivationHandlers {
  /** scroll to the rectangle on the page and flash it briefly */
  reveal(origIdx: number, rect: Rect): void
  /** open the note's thread in the margin */
  openNote(origIdx: number, rootKey: string): void
}

export function activateAnnotItem(item: AnnotItem, h: AnnotActivationHandlers): void {
  if (item.page !== null && item.rect) h.reveal(item.page, item.rect)
  const target = item.target
  switch (target.type) {
    case 'note':
      if (item.page !== null) h.openNote(item.page, target.rootKey)
      return
    case 'custom':
      target.activate()
      return
    default:
      return
  }
}
