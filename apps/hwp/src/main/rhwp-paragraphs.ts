import type { RhwpResult } from '../shared/ai-contract'

/**
 * `rhwp dump` (text, no --json) lists every body paragraph as
 *   --- 문단 S.P --- cc=…, text_len=N, controls=…
 *     텍스트: "…"            (or "텍스트: (빈 문단)")
 *     [CS] pos=N … bold=… base=… (one per character run; base is 1/100 pt)
 *     [PS] ps_id=… align=… spacing: before=… after=… line=N/Percent
 *          margins: left=… right=… indent=… border_fill_id=…
 *     [k] 표: …              (a table anchored in this paragraph)
 * The text is cut at about 50 characters with "...", so it is a preview; N is
 * the full length. Pinned against rhwp 0.8.6 by the contract test.
 */

export interface DumpParagraph {
  section: number
  paragraph: number
  preview: string
  length: number
  empty: boolean
  hasTable: boolean
  /** size (points) of the character run that holds the first non-space character */
  fontSize?: number
  /** bold of that same run */
  bold?: boolean
  /** leading whitespace width (space 1, tab 4, ideographic space 2); absent for blank paragraphs */
  lead?: number
  /** the number of leading whitespace characters (what an offset-0 edit has to skip to keep the indentation) */
  leadChars?: number
  /** the dump's alignment word, lowercased (justify, left, right, center, distribute, split) */
  align?: string
  marginLeft?: number
  marginRight?: number
  indent?: number
  spacingBefore?: number
  spacingAfter?: number
  /** percent; absent when the paragraph uses another line spacing type */
  lineSpacing?: number
}

const HEADER = /^--- 문단 (\d+)\.(\d+) --- (?:cc=(\d+), )?.*?text_len=(\d+)(?:, controls=(\d+))?/
const TEXT = /^ {2}텍스트: (.*)$/
const TABLE = /^ {2}\[\d+\] 표:/
const RUN = /^ {2}\[CS\] pos=(\d+) .*?\bbase=(\d+)/
const RUN_BOLD = /\bbold=(true|false)\b/
const PARA =
  /^ {2}\[PS\] ps_id=\d+ align=(\w+) spacing: before=(-?\d+) after=(-?\d+) line=(-?\d+)\/(\w+)/
const MARGINS = /^\s+margins: left=(-?\d+) right=(-?\d+) indent=(-?\d+)/

interface Run {
  pos: number
  base: number
  bold: boolean | undefined
}

function unquote(raw: string): string {
  if (raw === '(빈 문단)') return ''
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, -1)
    }
  }
  // a soft line break inside the text: the closing quote is on a later line; keep the first line
  if (raw.startsWith('"') && raw.length >= 1) return raw.slice(1)
  return raw
}

/** leading whitespace: display width (space 1, tab 4, ideographic space 2) and character count */
function leadOf(text: string): { width: number; chars: number; raw: number } {
  let width = 0
  let chars = 0
  let raw = 0
  for (const ch of text) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4
    else if (ch === '　') width += 2
    else break
    chars++
    raw += ch === '	' ? 8 : 1 // the engine counts a tab as 8 units in [CS] pos
  }
  return { width, chars, raw }
}

export function parseDumpParagraphs(stdout: string): DumpParagraph[] {
  const out: DumpParagraph[] = []
  let current: DumpParagraph | null = null
  let runs: Run[] = []
  let leadRaw = 0
  /** raw units taken by controls (8 each), assumed to sit in front of the text */
  let controlUnits = 0
  let cc = 0
  let textLen = 0
  let controls: number | undefined

  /** pick the run that holds the first non-space character: the last run starting at or before it */
  const settle = (): void => {
    if (!current || runs.length === 0) return
    let pick = runs[0]!
    for (const run of runs) if (run.pos <= leadRaw + controlUnits && run.pos >= pick.pos) pick = run
    current.fontSize = pick.base / 100
    if (pick.bold !== undefined) current.bold = pick.bold
  }

  for (const line of stdout.split(/\r?\n/)) {
    const header = HEADER.exec(line)
    if (header) {
      settle()
      current = {
        section: Number(header[1]),
        paragraph: Number(header[2]),
        preview: '',
        length: Number(header[4]),
        empty: true,
        hasTable: false,
      }
      out.push(current)
      runs = []
      leadRaw = 0
      cc = header[3] === undefined ? 0 : Number(header[3])
      textLen = Number(header[4])
      controls = header[5] === undefined ? undefined : Number(header[5])
      controlUnits = 0
      continue
    }
    if (!current) continue
    const text = TEXT.exec(line)
    if (text) {
      const raw = unquote(text[1]!)
      const value = raw.trim()
      current.preview = value
      current.empty = value.length === 0
      const lead = leadOf(raw)
      if (!current.empty) {
        current.lead = lead.width
        current.leadChars = lead.chars
      }
      // the run that holds the first character is found even for a blank (space-only) line:
      // each control takes 8 raw units and the header counts them (a tab or an inline control in the
      // text is not told apart from one in front, so only the counted ones are skipped)
      leadRaw = lead.raw
      controlUnits =
        controls !== undefined
          ? controls * 8
          : cc > 0
            ? Math.max(0, cc - 1 - textLen - (lead.raw - lead.chars))
            : 0
      continue
    }
    if (TABLE.test(line)) {
      current.hasTable = true
      continue
    }
    const run = RUN.exec(line)
    if (run) {
      const bold = RUN_BOLD.exec(line)
      runs.push({
        pos: Number(run[1]),
        base: Number(run[2]),
        bold: bold ? bold[1] === 'true' : undefined,
      })
      continue
    }
    const para = PARA.exec(line)
    if (para) {
      current.align = para[1]!.toLowerCase()
      current.spacingBefore = Number(para[2])
      current.spacingAfter = Number(para[3])
      if (para[5] === 'Percent') current.lineSpacing = Number(para[4])
      continue
    }
    const margins = MARGINS.exec(line)
    if (margins) {
      current.marginLeft = Number(margins[1])
      current.marginRight = Number(margins[2])
      current.indent = Number(margins[3])
    }
  }
  settle()
  return out
}

/** the `paragraphs` query result main hands the renderer: an envelope, never the raw dump */
export function paragraphsResult(dumped: RhwpResult): RhwpResult {
  if (dumped.exitCode !== 0) {
    return { exitCode: dumped.exitCode, envelope: null, stderr: dumped.stderr }
  }
  return {
    exitCode: 0,
    stderr: '',
    envelope: {
      schemaVersion: '1.0',
      paragraphs: parseDumpParagraphs(dumped.stdout ?? ''),
      untrustedContent: true,
      untrustedFields: ['paragraphs[].preview'],
    },
  }
}
