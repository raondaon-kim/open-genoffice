/**
 * Renderer ↔ main contract for the HWP AI tools (Phase 2). Everything the
 * renderer sends is validated again in main (rhwp-queries.ts, rhwp-edit-ops.ts):
 * the renderer is sandboxed but not trusted with argv construction.
 */

/** JSON envelope every `rhwp … --json` command prints on stdout */
export interface RhwpEnvelope {
  schemaVersion: string
  source?: string
  /** true when some field values are document-derived text (see untrustedFields) */
  untrustedContent?: boolean
  /** paths such as `matches[].text` whose string values came from the document */
  untrustedFields?: string[]
  [key: string]: unknown
}

/** 0 success · 1 runtime failure · 2 usage/argument error · 3 negative result (data) */
export type RhwpExitCode = 0 | 1 | 2 | 3

export interface RhwpResult {
  exitCode: RhwpExitCode
  /** parsed stdout envelope; null when stdout was not a JSON object */
  envelope: RhwpEnvelope | null
  /** diagnostics (LAYOUT_OVERFLOW, CONVERGENCE, 오류: …); never fed to the model unwrapped */
  stderr: string
}

/** read-only rhwp commands main is willing to run on a snapshot */
export const AI_QUERY_NAMES = [
  'explain',
  'explore',
  'export_structure',
  'export_text',
  'search',
  'export_tables',
  'fields',
  'digest',
  'extract_data',
  'word_count',
  'verify',
  'inspect_injection',
] as const
export type AiQueryName = (typeof AI_QUERY_NAMES)[number]

/** character formatting accepted by `rhwp edit apply-char-format --props` */
export interface CharFormatProps {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  superscript?: boolean
  subscript?: boolean
  /** #rrggbb */
  textColor?: string
  /** points */
  fontSize?: number
}

export type ParaAlignment = 'left' | 'center' | 'right' | 'justify' | 'distribute' | 'division'

/** paragraph formatting accepted by `rhwp edit apply-para-format --props` */
export interface ParaFormatProps {
  alignment?: ParaAlignment
  /** percent, e.g. 160 */
  lineSpacing?: number
}

/**
 * One file-path edit. Coordinates are IR coordinates from rhwp output
 * (0-based section/paragraph/table/row/col, code-point charOffset).
 */
export type EditOp =
  | { op: 'replace_phrase'; find: string; replace: string; occurrence?: number }
  | { op: 'set_paragraph_text'; section: number; paragraph: number; text: string }
  | { op: 'insert_paragraph_after'; section: number; paragraph: number; text: string }
  | { op: 'delete_paragraph'; section: number; paragraph: number }
  | { op: 'set_cell'; table: number; row: number; col: number; text: string }
  | { op: 'insert_row'; table: number; row: number; below?: boolean }
  | { op: 'insert_col'; table: number; col: number; right?: boolean }
  | { op: 'delete_row'; table: number; row: number }
  | { op: 'delete_col'; table: number; col: number }
  | { op: 'merge_cells'; table: number; row: number; col: number; endRow: number; endCol: number }
  | { op: 'split_cell'; table: number; row: number; col: number }
  | { op: 'insert_table'; section: number; paragraph: number; rows: number; cols: number }
  | { op: 'insert_footnote'; section: number; paragraph: number; charOffset: number; text?: string }
  | { op: 'insert_endnote'; section: number; paragraph: number; charOffset: number }
  | { op: 'insert_page_break'; section: number; paragraph: number; charOffset: number }
  | { op: 'insert_column_break'; section: number; paragraph: number; charOffset: number }
  | { op: 'header_text'; section: number; text: string }
  | { op: 'footer_text'; section: number; text: string }
  | { op: 'add_bookmark'; section: number; paragraph: number; charOffset: number; name: string }
  | { op: 'fill_fields'; data: Record<string, string> }
  | { op: 'apply_char_format'; section: number; paragraph: number; props: CharFormatProps }
  | { op: 'apply_para_format'; section: number; paragraph: number; props: ParaFormatProps }

export type EditOpName = EditOp['op']

export interface AiSnapshotRequest {
  /** lowercase hex sha256 of `data` — must equal getDocumentState().documentSha256 */
  sha: string
  data: ArrayBuffer
}
export type AiSnapshotResult = { ok: true } | { ok: false; error: string }

export interface AiQueryRequest {
  sha: string
  tool: AiQueryName
  args: Record<string, unknown>
}
export type AiQueryResult = { ok: true; result: RhwpResult } | { ok: false; error: string }

export interface AiEditRequest {
  sha: string
  ops: EditOp[]
}

export interface EditJournalEntry {
  opIndex: number
  op: EditOpName
  /** rhwp edit subcommand that ran */
  command: string
  envelope: RhwpEnvelope | null
  /** the step failed but was tolerated (e.g. header already existed) */
  tolerated?: boolean
  /** the step produced no output file (replace-text with 0 hits) */
  noop?: boolean
}

export type AiEditResult =
  | {
      ok: true
      /** edited document bytes (HWPX) */
      data: ArrayBuffer
      outputSha: string
      /** union of the steps' changedPages (0-based) */
      changedPages: number[]
      /** ir-diff against the snapshot; null when ir-diff itself failed */
      diffCount: number | null
      journal: EditJournalEntry[]
    }
  | {
      ok: false
      /** index into `ops` of the failing op; null for pre-flight failures */
      failedOp: number | null
      error: string
      result?: RhwpResult
      journal: EditJournalEntry[]
    }
