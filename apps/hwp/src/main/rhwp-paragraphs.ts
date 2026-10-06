import type { RhwpResult } from '../shared/ai-contract'

/**
 * `rhwp dump` (text, no --json) lists every body paragraph as
 *   --- 문단 S.P --- cc=…, text_len=N, controls=…
 *     텍스트: "…"            (or "텍스트: (빈 문단)")
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
  /** size of the first character run in points (dump prints 1/100 pt); absent when not printed */
  fontSize?: number
}

const HEADER = /^--- 문단 (\d+)\.(\d+) --- .*?text_len=(\d+)/
const TEXT = /^ {2}텍스트: (.*)$/
const TABLE = /^ {2}\[\d+\] 표:/
const RUN = /^ {2}\[CS\] pos=\d+ .*?\bbase=(\d+)/

function unquote(raw: string): string {
  if (raw === '(빈 문단)') return ''
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw
}

export function parseDumpParagraphs(stdout: string): DumpParagraph[] {
  const out: DumpParagraph[] = []
  let current: DumpParagraph | null = null
  for (const line of stdout.split(/\r?\n/)) {
    const header = HEADER.exec(line)
    if (header) {
      current = {
        section: Number(header[1]),
        paragraph: Number(header[2]),
        preview: '',
        length: Number(header[3]),
        empty: true,
        hasTable: false,
      }
      out.push(current)
      continue
    }
    if (!current) continue
    const text = TEXT.exec(line)
    if (text) {
      const value = unquote(text[1]!).trim()
      current.preview = value
      current.empty = value.length === 0
      continue
    }
    if (TABLE.test(line)) {
      current.hasTable = true
      continue
    }
    const run = RUN.exec(line)
    if (run && current.fontSize === undefined) current.fontSize = Number(run[1]) / 100
  }
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
