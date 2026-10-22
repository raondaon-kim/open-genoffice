import type { Lander, ReportBlock, Skeleton } from '@genoffice/report-writer'
import type { DocStyle } from '../../../shared/doc-style'
import type { StyledBlockInput } from '../../../shared/ipc'

/** the style role each kind of report block goes into */
export type HwpRoleMap = Record<
  'title' | 'chapter' | 'section' | 'subsection' | 'paragraph' | 'bullet' | 'numbered',
  string
>

/** Hangul styles write_report can fill; proposals are written as bullets (개조식) */
export const ROLE_MAPS: Record<string, HwpRoleMap> = {
  report: {
    title: 'title',
    chapter: 'chapter',
    section: 'section',
    subsection: 'subsection',
    paragraph: 'body',
    bullet: 'bullet',
    numbered: 'numbered',
  },
  'bid-proposal': {
    title: 'cover-title',
    chapter: 'chapter',
    section: 'section',
    subsection: 'item-1',
    paragraph: 'bullet',
    bullet: 'dash',
    numbered: 'item-2',
  },
  'oda-proposal': {
    title: 'cover-title',
    chapter: 'chapter',
    section: 'section',
    subsection: 'subsection',
    paragraph: 'bullet',
    bullet: 'dash',
    numbered: 'item-1',
  },
  'seoul-report': {
    title: 'cover-title',
    chapter: 'heading-1',
    section: 'item-1',
    subsection: 'item-2',
    paragraph: 'item-2',
    bullet: 'item-3',
    numbered: 'item-3',
  },
}

export interface HwpLanderDeps {
  style: DocStyle
  styleId: string
  /** the open document was blank: rebuild it and reload the tab after every step */
  live: boolean
  build(
    blocks: StyledBlockInput[],
  ): Promise<{ ok: true; data: Uint8Array } | { ok: false; error: string }>
  load(bytes: Uint8Array): Promise<void>
  /** keep the document as it was before the run for AI undo (live, once) */
  saveUndo(): Promise<void>
  /** not live: the whole document as one new file at the end */
  create(blocks: StyledBlockInput[]): Promise<{ ok: boolean; error?: string }>
}

/** the engine's one-paragraph limit, with room for a role's lead and marker */
const MAX_TEXT = 1900
const KOREAN_LETTERS = '가나다라마바사아자차카타파하'

const isSymbolMarker = (m: string): boolean =>
  m !== 'text' && m.length <= 2 && !/[N0-9]/.test(m) && !/[.)]$/.test(m)

function numberLabel(marker: string, n: number): string {
  if (marker.startsWith('가')) return `${KOREAN_LETTERS[(n - 1) % KOREAN_LETTERS.length]}.`
  if (marker.endsWith(')')) return `${n})`
  return `${n}.`
}

/** a long paragraph cut at sentence ends into pieces the engine accepts */
function splitText(text: string): string[] {
  const out: string[] = []
  let rest = text.replace(/\t/g, ' ')
  while (rest.length > MAX_TEXT) {
    const window = rest.slice(0, MAX_TEXT)
    const cut = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('다. '),
      window.lastIndexOf('? '),
    )
    const at = cut > MAX_TEXT / 2 ? cut + 1 : MAX_TEXT
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Lands a report in the Hangul editor. The document is kept as slots (title, summary, table of
 * contents, one per chapter, gaps); a placeholder slot shows "쓰는 중…". When the open document
 * was blank, every step rebuilds the whole document and reloads the tab so the user watches it
 * fill; otherwise one new document is created at the end.
 */
export function createHwpLander(deps: HwpLanderDeps): Lander {
  const map = ROLE_MAPS[deps.styleId]
  if (!map) {
    throw new Error(
      `write_report cannot fill the Hangul style "${deps.styleId}"; use ${Object.keys(ROLE_MAPS).join(', ')}`,
    )
  }
  const roles = new Map(deps.style.roles.map((r) => [r.id, r]))
  for (const id of Object.values(map)) {
    if (!roles.has(id)) throw new Error(`the style "${deps.styleId}" has no role "${id}"`)
  }
  const markerOf = (role: string) => roles.get(role)?.marker ?? 'text'
  const tocTitle = roles.has('toc-title') ? 'toc-title' : map.chapter
  const tocLine = roles.has('toc-line') ? 'toc-line' : map.paragraph

  const order: string[] = []
  const slots = new Map<string, StyledBlockInput[]>()
  const open = new Set<string>()
  let undoSaved = false
  /** chapters with text (not placeholders, not failures) */
  let written = 0

  const plain = (role: string, text: string): StyledBlockInput[] =>
    splitText(text).map((t) => ({ role, text: t }))
  const withMarker = (role: string, text: string): StyledBlockInput[] => {
    const m = markerOf(role)
    const lead = isSymbolMarker(m) && !text.startsWith(m) ? `${m} ` : ''
    return plain(role, `${lead}${text}`)
  }
  const toBlocks = (blocks: ReportBlock[]): StyledBlockInput[] => {
    const out: StyledBlockInput[] = []
    let n = 0
    for (const b of blocks) {
      if (b.type === 'table') {
        out.push({
          role: 'table',
          rows: b.rows.map((r) => r.map((c) => c.replace(/[\t\n\r]/g, ' '))),
        })
        continue
      }
      if (b.type !== 'numbered') n = 0
      if (b.type === 'numbered') {
        n++
        const m = markerOf(map.numbered)
        const label = isSymbolMarker(m) ? m : numberLabel(m, n)
        out.push(...plain(map.numbered, `${label} ${b.text}`))
        continue
      }
      const role = b.type === 'paragraph' ? map.paragraph : map[b.type]
      out.push(...withMarker(role, b.text))
    }
    return out
  }
  const all = (): StyledBlockInput[] => order.flatMap((slot) => slots.get(slot) ?? [])
  const refresh = async () => {
    if (!deps.live) return
    if (!undoSaved) {
      await deps.saveUndo()
      undoSaved = true
    }
    const built = await deps.build(all())
    if (!built.ok) throw new Error(`the document could not be rebuilt: ${built.error}`)
    await deps.load(built.data)
  }
  const placeholder = (slot: string, label: string) => {
    open.add(slot)
    slots.set(slot, plain(map.paragraph, `${label} — 쓰는 중…`))
  }
  const fill = async (slot: string, blocks: StyledBlockInput[]) => {
    open.delete(slot)
    if (blocks.length) slots.set(slot, blocks)
    else slots.delete(slot)
    await refresh()
  }
  const dropOpen = () => {
    for (const slot of open) slots.delete(slot)
    open.clear()
  }

  return {
    async skeleton(s: Skeleton) {
      order.push('title')
      slots.set('title', plain(map.title, s.title))
      if (s.withSummary) {
        order.push('summary')
        placeholder('summary', '요약')
      }
      order.push('toc')
      slots.set('toc', [
        ...plain(tocTitle, '목차'),
        ...s.chapters.flatMap((c) => [
          ...plain(tocLine, `${c.no}. ${c.title}`),
          ...c.sections.flatMap((x) => plain(tocLine, `  ${x}`)),
        ]),
      ])
      for (const c of s.chapters) {
        order.push(`c${c.no}`)
        placeholder(`c${c.no}`, `${c.no}. ${c.title}`)
      }
      if (s.withSummary) {
        order.push('gaps')
        placeholder('gaps', '확인 필요 사항')
      }
      await refresh()
    },
    chapter: (no, blocks) => {
      written++
      return fill(`c${no}`, toBlocks(blocks))
    },
    chapterFailed: (no, title) =>
      fill(`c${no}`, plain(map.paragraph, `이 장을 쓰지 못했습니다: ${no}. ${title}`)),
    summary: (blocks) => fill('summary', toBlocks(blocks)),
    gaps: (blocks) => fill('gaps', toBlocks(blocks)),
    async abandon() {
      dropOpen()
      if (deps.live) {
        await refresh()
        return
      }
      // nothing is in a document yet: keep the chapters already written in a new one
      if (written > 0) await deps.create(all())
    },
    async finish() {
      dropOpen()
      if (deps.live) {
        await refresh()
        return
      }
      const made = await deps.create(all())
      if (!made.ok)
        throw new Error(`the document could not be created: ${made.error ?? 'unknown error'}`)
    },
  }
}
