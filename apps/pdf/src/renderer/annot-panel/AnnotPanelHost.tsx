// From IeumOffice (pblsketch/openoffice) apps/pdf/src/renderer/annot-panel/AnnotPanelHost.tsx,
// 3c002a56, without the passage cards this app does not have.
/**
 * The annotation panel as the editor mounts it: reads the open document's saved
 * annotations once per loaded document (only while the panel is shown; nothing is sent
 * anywhere) and the text under unsaved markups, and builds the list the panel shows.
 */
import { useEffect, useMemo, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { LocalMarkup, PageGeom } from '../annotations'
import type { LocalDrawing } from '../DrawLayer'
import type { LocalAnnotDelete, LocalNoteEdit } from '../edit-state'
import { AnnotPanel, type AnnotPanelProps } from './AnnotPanel'
import { buildAnnotItems, type AnnotItemDraft, type SavedAnnotScan } from './items'
import { loadPageTextRuns, scanDocumentAnnots } from './scan'
import type { TextRun } from './text-under'

/** one scan per loaded document; a save reloads the document and so scans again */
const scans = new WeakMap<PDFDocumentProxy, Promise<SavedAnnotScan>>()
const pageTexts = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextRun[]>>>()

function scanOnce(doc: PDFDocumentProxy): Promise<SavedAnnotScan> {
  let scan = scans.get(doc)
  if (!scan) {
    scan = scanDocumentAnnots(doc)
    scans.set(doc, scan)
  }
  return scan
}

function pageTextOnce(doc: PDFDocumentProxy, origIdx: number): Promise<TextRun[]> {
  let byPage = pageTexts.get(doc)
  if (!byPage) pageTexts.set(doc, (byPage = new Map()))
  let text = byPage.get(origIdx)
  if (!text) {
    text = loadPageTextRuns(doc, origIdx)
    byPage.set(origIdx, text)
  }
  return text
}

const EMPTY_SCAN: SavedAnnotScan = { markups: [], notes: [], others: [] }

export interface AnnotPanelHostProps extends Omit<AnnotPanelProps, 'items' | 'loading'> {
  doc: PDFDocumentProxy | null
  unsavedMarkups: readonly LocalMarkup[]
  /** the session's drawings; their notes are the unsaved notes */
  drawings: readonly LocalDrawing[]
  annotDeletes: readonly LocalAnnotDelete[]
  noteEdits: readonly LocalNoteEdit[]
  /** 1-based shown page of an original page; null when deleted */
  displayPage: (origIdx: number) => number | null
  geomOf?: (origIdx: number) => PageGeom
  /** items from other features (e.g. AI highlight suggestions while previewed) */
  extraItems?: readonly AnnotItemDraft[]
}

export function AnnotPanelHost(props: AnnotPanelHostProps) {
  const { doc, unsavedMarkups } = props
  const [scan, setScan] = useState<{ doc: PDFDocumentProxy; data: SavedAnnotScan } | null>(null)
  const [texts, setTexts] = useState<{ doc: PDFDocumentProxy; map: Map<number, TextRun[]> } | null>(
    null,
  )

  useEffect(() => {
    if (!doc) return
    let live = true
    void scanOnce(doc).then((data) => {
      if (live) setScan({ doc, data })
    })
    return () => {
      live = false
    }
  }, [doc])

  // the text under unsaved markups, read once per page
  const markupPages = useMemo(
    () => [...new Set(unsavedMarkups.map((m) => m.pageIndex))].sort((a, b) => a - b).join(','),
    [unsavedMarkups],
  )
  useEffect(() => {
    if (!doc || !markupPages) return
    let live = true
    const pages = markupPages.split(',').map(Number)
    void Promise.all(
      pages.map((p) => pageTextOnce(doc, p).then((runs) => [p, runs] as const)),
    ).then((entries) => {
      if (!live) return
      setTexts((prev) => {
        const map = new Map(prev && prev.doc === doc ? prev.map : [])
        for (const [p, runs] of entries) map.set(p, runs)
        return { doc, map }
      })
    })
    return () => {
      live = false
    }
  }, [doc, markupPages])

  const saved = scan && scan.doc === doc ? scan.data : null

  const items = buildAnnotItems({
    saved: saved ?? EMPTY_SCAN,
    unsavedMarkups,
    pendingNotes: props.drawings.flatMap((d) =>
      d.input.kind === 'note' ? [{ id: d.id, input: d.input }] : [],
    ),
    unsavedDrawings: props.drawings.filter((d) => d.input.kind !== 'note'),
    deletedObjNums: new Set(props.annotDeletes.map((d) => d.annot.objNum)),
    editedNotes: new Map(props.noteEdits.map((e) => [e.annot.objNum, e.contents])),
    pageTexts: texts && texts.doc === doc ? texts.map : new Map(),
    displayPage: props.displayPage,
    geomOf: props.geomOf,
    t: props.t,
    extra: props.extraItems,
  })

  const {
    doc: _doc,
    unsavedMarkups: _m,
    drawings: _d,
    annotDeletes: _a,
    noteEdits: _n,
    displayPage: _p,
    geomOf: _g,
    extraItems: _x,
    ...panel
  } = props
  return <AnnotPanel {...panel} items={items} loading={doc !== null && saved === null} />
}
