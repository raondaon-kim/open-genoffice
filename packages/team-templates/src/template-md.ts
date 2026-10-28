import { parseAnyStylePage, type DocxStyle } from '@genoffice/doc-styles'

export interface TemplateOutlineEntry {
  level: number
  heading: string
  /** what to write under this heading ('' = none) */
  guidance: string
}

export interface TemplateDef {
  title: string
  kind: 'Word'
  purpose: string
  /** 상태 line: `확정 · <confirmedAt> · <author>` */
  confirmedAt: string
  author: string
  documents: number
  /** outline-signature hashes of the documents it was made from (never paths) */
  signatures: string[]
  formSha256: string
  materials: string[]
  wikiPages: string[]
  outline: TemplateOutlineEntry[]
  /** free prose between the header lines and the outline */
  notes: string
  style: DocxStyle
}

const KEYS = {
  purpose: '용도',
  status: '상태',
  documents: '근거 문서',
  signatures: '근거 서명',
  form: '형태 파일',
  materials: '필요한 자료',
  wikiPages: '참고할 업무 위키',
} as const

const list = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function renderTemplateMd(def: TemplateDef): string {
  const minLevel = Math.min(...def.outline.map((e) => e.level), 1)
  const outline = def.outline
    .map(
      (e) =>
        // a dash inside the heading is escaped so the first unescaped " — " starts the guidance
        `${'  '.repeat(Math.max(0, e.level - minLevel))}- ${e.heading.replace(/ — /g, ' \\— ')}${e.guidance ? ` — ${e.guidance}` : ''}`,
    )
    .join('\n')
  return [
    `# ${def.title} (${def.kind})`,
    '',
    `- ${KEYS.purpose}: ${def.purpose}`,
    `- ${KEYS.status}: 확정 · ${def.confirmedAt} · ${def.author}`,
    `- ${KEYS.documents}: ${def.documents}건`,
    `- ${KEYS.signatures}: ${def.signatures.join(', ')}`,
    `- ${KEYS.form}: form.docx · sha256 ${def.formSha256}`,
    `- ${KEYS.materials}: ${def.materials.join(', ')}`,
    `- ${KEYS.wikiPages}: ${def.wikiPages.join(', ')}`,
    '',
    ...(def.notes.trim() ? [def.notes.trim(), ''] : []),
    '## 목차',
    outline,
    '',
    '```json style',
    JSON.stringify(def.style, null, 2),
    '```',
    '',
  ].join('\n')
}

export type ParsedTemplate = { ok: true; def: TemplateDef } | { ok: false; error: string }

export function parseTemplateMd(text: string): ParsedTemplate {
  const src = text.replace(/\r\n/g, '\n')
  const titleLine = /^# (.+)$/m.exec(src)
  if (!titleLine) return { ok: false, error: 'the template has no "# title" line' }
  const titleMatch = /^(.*?)\s*\((Word)\)\s*$/.exec(titleLine[1]!.trim())
  if (!titleMatch) return { ok: false, error: 'the title line must end with "(Word)"' }
  const outlineAt = src.search(/^## 목차\s*$/m)
  if (outlineAt < 0) return { ok: false, error: 'the template has no "## 목차" section' }

  const header = src.slice(titleLine.index + titleLine[0].length, outlineAt)
  const values = new Map<string, string>()
  const notes: string[] = []
  for (const line of header.split('\n')) {
    const m = /^- ([^:]+):\s?(.*)$/.exec(line)
    if (m && Object.values(KEYS).includes(m[1]!.trim() as never))
      values.set(m[1]!.trim(), m[2]!.trim())
    else if (line.trim()) notes.push(line)
  }
  const status = /^확정 · (\S+) · (.+)$/.exec(values.get(KEYS.status) ?? '')
  if (!status) return { ok: false, error: 'the 상태 line must read "확정 · <date> · <author>"' }
  const form = /^form\.docx · sha256 ([0-9a-f]{64})$/.exec(values.get(KEYS.form) ?? '')
  if (!form) return { ok: false, error: 'the 형태 파일 line needs a sha256 of form.docx' }
  const documents = /^(\d+)건$/.exec(values.get(KEYS.documents) ?? '')
  if (!documents) return { ok: false, error: 'the 근거 문서 line must read "<N>건"' }

  const afterOutline = src.slice(outlineAt).split('\n').slice(1)
  const outline: TemplateOutlineEntry[] = []
  for (const line of afterOutline) {
    if (line.startsWith('```') || /^## /.test(line)) break
    const m = /^( *)- (.+)$/.exec(line)
    if (!m) continue
    // the first " — " that is not escaped as " \— " separates heading and guidance
    const cut = /(?<!\\) — /.exec(m[2]!)
    const heading = cut ? m[2]!.slice(0, cut.index) : m[2]!
    const guidance = cut ? m[2]!.slice(cut.index + cut[0].length) : ''
    outline.push({
      level: Math.floor(m[1]!.length / 2) + 1,
      heading: heading.replace(/ \\— /g, ' — ').trim(),
      guidance: guidance.trim(),
    })
  }
  if (outline.length === 0) return { ok: false, error: 'the "## 목차" section lists no headings' }

  const style = parseAnyStylePage(src)
  if (!style.ok) return { ok: false, error: style.error }
  if (style.style.format !== 'docx')
    return { ok: false, error: 'the style block is not a Word style' }

  return {
    ok: true,
    def: {
      title: titleMatch[1]!,
      kind: 'Word',
      purpose: values.get(KEYS.purpose) ?? '',
      confirmedAt: status[1]!,
      author: status[2]!.trim(),
      documents: Number(documents[1]),
      signatures: list(values.get(KEYS.signatures) ?? ''),
      formSha256: form[1]!,
      materials: list(values.get(KEYS.materials) ?? ''),
      wikiPages: list(values.get(KEYS.wikiPages) ?? ''),
      outline,
      notes: notes.join('\n').trim(),
      style: style.style as DocxStyle,
    },
  }
}
