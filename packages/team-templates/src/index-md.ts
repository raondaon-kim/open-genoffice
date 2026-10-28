export interface IndexSet {
  title: string
  /** relative to the templates folder, with a trailing slash: `Word/KOICA-ODA-기술제안서/` */
  path: string
  kind: string
  purpose: string
  /** first 8 hex of the form's sha256 */
  hash8: string
}
export interface IndexLoose {
  name: string
  path: string
  /** kept so a listing does not stat every file on the NAS */
  sizeBytes?: number
  mtimeMs?: number
}
export interface TemplateIndex {
  updatedAt: string
  author: string
  sets: IndexSet[]
  loose: IndexLoose[]
}

const KIND_ORDER = ['Word', 'Hangul', 'PowerPoint', 'Excel']
const LOOSE = '정리되지 않은 파일'
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const kindRank = (k: string) => (KIND_ORDER.includes(k) ? KIND_ORDER.indexOf(k) : KIND_ORDER.length)

const escTitle = (s: string) => s.replace(/\\/g, '\\\\').replace(/[[\]]/g, (c) => `\\${c}`)
const unescTitle = (s: string) => s.replace(/\\(.)/g, '$1')
const link = (title: string, path: string) => `[${escTitle(title)}](<${path}>)`

export function sortSets(sets: IndexSet[]): IndexSet[] {
  return [...sets].sort(
    (a, b) => kindRank(a.kind) - kindRank(b.kind) || cmp(a.kind, b.kind) || cmp(a.title, b.title),
  )
}

export function renderIndexMd(index: TemplateIndex): string {
  const lines = [
    '# 팀 템플릿 목록',
    `갱신: ${index.updatedAt} · ${index.author} · 템플릿 ${index.sets.length}개`,
  ]
  let kind = ''
  for (const s of sortSets(index.sets)) {
    if (s.kind !== kind) {
      kind = s.kind
      lines.push('', `## ${kind}`)
    }
    lines.push(`- ${link(s.title, s.path)} — ${s.purpose} · 확정 · ${s.hash8}`)
  }
  if (index.loose.length) {
    lines.push('', `## ${LOOSE}`)
    for (const l of [...index.loose].sort((a, b) => cmp(a.path, b.path))) {
      const meta =
        l.sizeBytes !== undefined && l.mtimeMs !== undefined
          ? ` · ${l.sizeBytes} · ${Math.round(l.mtimeMs)}`
          : ''
      lines.push(`- ${link(l.name, l.path)}${meta}`)
    }
  }
  return `${lines.join('\n')}\n`
}

const LINK = /^- \[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^)\s]+))\)(.*)$/

/** null when the text is not an index at all; a broken line is skipped, prose is ignored */
export function parseIndexMd(text: string): TemplateIndex | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trim() !== '# 팀 템플릿 목록') return null
  const header = /^갱신: (.+?) · (.+?) · 템플릿 \d+개$/.exec(lines[1]?.trim() ?? '')
  const index: TemplateIndex = {
    updatedAt: header?.[1] ?? '',
    author: header?.[2] ?? '',
    sets: [],
    loose: [],
  }
  let section = ''
  for (const line of lines.slice(2)) {
    const h = /^## (.+)$/.exec(line)
    if (h) {
      section = h[1]!.trim()
      continue
    }
    const m = LINK.exec(line)
    if (!m) continue
    const title = unescTitle(m[1]!)
    const path = m[2] ?? m[3]!
    if (section === LOOSE) {
      const meta = /^ · (\d+) · (\d+)$/.exec(m[4]!)
      index.loose.push(
        meta
          ? { name: title, path, sizeBytes: Number(meta[1]), mtimeMs: Number(meta[2]) }
          : { name: title, path },
      )
      continue
    }
    const rest = /^ — (.*) · 확정 · ([0-9a-f]{8})$/.exec(m[4]!)
    if (!rest) continue
    index.sets.push({
      title,
      path,
      kind: path.split('/')[0] || section,
      purpose: rest[1]!,
      hash8: rest[2]!,
    })
  }
  return index
}

export function upsertSet(index: TemplateIndex, set: IndexSet): TemplateIndex {
  return { ...index, sets: [...index.sets.filter((s) => s.path !== set.path), set] }
}

export function removeSet(index: TemplateIndex, path: string): TemplateIndex {
  return { ...index, sets: index.sets.filter((s) => s.path !== path) }
}
