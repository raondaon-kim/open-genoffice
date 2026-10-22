import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EditOp } from '../shared/ai-contract'
import type { DocStyle, StyleRole } from '../shared/doc-style'
import { runEditChain } from './ai-edit-chain'
import { runRhwp } from './rhwp-cli'
import type { RunRhwpFn } from './rhwp-cli'
import { MAX_EDIT_OPS } from './rhwp-edit-ops'

/**
 * Builds a new document from a document-style wiki page (spec §4.3): rhwp scaffold makes one
 * paragraph per block, then one internal style_paragraph op per block applies the role's
 * shape. Paragraph i is block i (scaffold without a title keeps blank paragraphs too).
 */

/** a whole document (a long one is written in stages, see styled-drafts.ts) */
export const MAX_STYLED_BLOCKS = 1500
const MAX_BLOCK_CHARS = 2000

export interface StyledTextBlock {
  role: string
  text: string
}

/** a table: its paragraph is scaffolded blank, then the table is inserted there and filled */
export interface StyledTableBlock {
  role: 'table'
  /** rows[0] is the header row; every row has the same number of cells */
  rows: string[][]
}

export type StyledBlock = StyledTextBlock | StyledTableBlock

export const isTableBlock = (b: unknown): b is StyledTableBlock =>
  typeof b === 'object' &&
  b !== null &&
  (b as { role?: unknown }).role === 'table' &&
  Array.isArray((b as { rows?: unknown }).rows)

const MAX_TABLE_COLS = 256

/** why a table block cannot be built, or null when it can */
export function tableBlockError(block: StyledTableBlock): string | null {
  const rows = block.rows
  if (rows.length === 0) return 'a table needs at least one row'
  const cols = Array.isArray(rows[0]) ? rows[0].length : 0
  if (cols === 0 || cols > MAX_TABLE_COLS) return `a table row needs 1-${MAX_TABLE_COLS} cells`
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== cols)
      return 'table rows must all have the same number of cells'
    for (const cell of row) {
      if (typeof cell !== 'string' || cell.length > MAX_BLOCK_CHARS || /[\n\r\t]/.test(cell))
        return `a table cell must be one line without tabs (max ${MAX_BLOCK_CHARS} characters)`
    }
  }
  return null
}

export type StyledResult =
  | {
      ok: true
      data: Uint8Array
      paragraphs: number
      roleCounts: Record<string, number>
      warnings: string[]
    }
  | { ok: false; error: string }

export interface StyledDeps {
  run?: RunRhwpFn
  rhwpPath: string
  /** an empty directory this call may use; it is emptied before returning */
  workDir: string
}

function opFor(role: StyleRole, index: number): EditOp {
  return {
    op: 'style_paragraph',
    section: 0,
    paragraph: index,
    para: {
      alignment: role.align,
      marginLeft: role.marginLeft,
      marginRight: role.marginRight,
      indent: role.indent,
      spacingBefore: role.spacingBefore,
      spacingAfter: role.spacingAfter,
      lineSpacing: role.lineSpacing,
    },
    char: { fontSize: role.size, bold: role.bold },
  }
}

function missingParts(style: DocStyle, blocks: StyledBlock[]): string[] {
  const used = new Set(blocks.map((b) => b.role))
  const out: string[] = []
  for (const slot of style.skeleton) {
    if (!slot.required) continue
    const roles = slot.roles ?? (slot.role ? [slot.role] : [])
    if (!roles.some((r) => used.has(r)))
      out.push(`missing required part "${slot.slot}" (${roles.join(' / ')})`)
  }
  return out
}

/** spaces the model typed in front of the text are dropped: the role's lead is added instead */
function withoutLeadingSpaces(text: string): string {
  let start = 0
  while (start < text.length && [0x20, 0x3000].includes(text.charCodeAt(start))) start++
  return text.slice(start)
}

export async function buildStyledDocument(
  style: DocStyle,
  blocks: StyledBlock[],
  deps: StyledDeps,
): Promise<StyledResult> {
  const run = deps.run ?? runRhwp
  if (!Array.isArray(blocks) || blocks.length === 0)
    return { ok: false, error: 'blocks must be a non-empty list' }
  if (blocks.length > MAX_STYLED_BLOCKS) {
    return {
      ok: false,
      error: `at most ${MAX_STYLED_BLOCKS} blocks per document (got ${blocks.length})`,
    }
  }
  const roles = new Map(style.roles.map((r) => [r.id, r]))
  const texts: string[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as { role?: unknown; text?: unknown }
    const where = `block ${i + 1}`
    if (isTableBlock(block)) {
      const error = tableBlockError(block)
      if (error) return { ok: false, error: `${where}: ${error}` }
      texts.push(' ')
      continue
    }
    if (typeof block?.role !== 'string' || !roles.has(block.role)) {
      return {
        ok: false,
        error: `${where}: unknown role "${String(block?.role)}" — roles are ${[...roles.keys()].join(', ')}`,
      }
    }
    if (
      typeof block.text !== 'string' ||
      block.text.length > MAX_BLOCK_CHARS ||
      /[\n\r\t]/.test(block.text)
    ) {
      return {
        ok: false,
        error: `${where}: text must be one line without tabs (max ${MAX_BLOCK_CHARS} characters)`,
      }
    }
    const role = roles.get(block.role)!
    // a truly empty paragraph ignores apply-char-format (count 0), so a blank line is one space
    texts.push(`${' '.repeat(role.lead)}${withoutLeadingSpaces(block.text)}` || ' ')
  }

  await mkdir(deps.workDir, { recursive: true })
  const made: string[] = []
  const fail = async (error: string): Promise<StyledResult> => {
    await Promise.all(made.map((p) => rm(p, { force: true })))
    return { ok: false, error }
  }
  try {
    const specPath = join(deps.workDir, 'spec.json')
    made.push(specPath)
    await writeFile(
      specPath,
      JSON.stringify({ version: '1', blocks: texts.map((text) => ({ type: 'paragraph', text })) }),
    )
    let current = join(deps.workDir, 'step-0.hwpx')
    made.push(current)
    const scaffold = await run(deps.rhwpPath, ['scaffold', specPath, '-o', current, '--json'])
    if (scaffold.exitCode !== 0)
      return fail(`could not create the document: ${scaffold.stderr.trim().slice(0, 300)}`)
    const count = scaffold.envelope?.paragraphCount
    if (count !== blocks.length) {
      return fail(
        `the engine made ${String(count)} paragraph(s) for ${blocks.length} block(s) — nothing was applied`,
      )
    }

    // role styles first (paragraph i is block i), then each table into its blank paragraph
    const ops: EditOp[] = []
    blocks.forEach((b, i) => {
      if (!isTableBlock(b)) ops.push(opFor(roles.get(b.role)!, i))
    })
    let table = 0
    blocks.forEach((b, i) => {
      if (!isTableBlock(b)) return
      ops.push({
        op: 'insert_table',
        section: 0,
        paragraph: i,
        rows: b.rows.length,
        cols: b.rows[0]!.length,
      })
      b.rows.forEach((row, r) =>
        row.forEach((text, c) => ops.push({ op: 'set_cell', table, row: r, col: c, text })),
      )
      table++
    })
    for (let start = 0, k = 1; start < ops.length; start += MAX_EDIT_OPS, k++) {
      const chunk = ops.slice(start, start + MAX_EDIT_OPS)
      const result = await runEditChain({
        rhwpPath: deps.rhwpPath,
        snapshotPath: current,
        workDir: deps.workDir,
        ops: chunk,
        run,
        allowInternal: true,
      })
      if (!result.ok) {
        const at = result.failedOp === null ? start + 1 : start + result.failedOp + 1
        return fail(`block ${at}: ${result.error}`)
      }
      const next = join(deps.workDir, `step-${k}.hwpx`)
      made.push(next)
      await writeFile(next, Buffer.from(result.data))
      current = next
    }

    const data = new Uint8Array(await readFile(current))
    const roleCounts: Record<string, number> = Object.create(null)
    for (const b of blocks) roleCounts[b.role] = (roleCounts[b.role] ?? 0) + 1
    await Promise.all(made.map((p) => rm(p, { force: true })))
    return {
      ok: true,
      data,
      paragraphs: blocks.length,
      roleCounts,
      warnings: missingParts(style, blocks),
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Checks blocks sent over IPC against a style (createStyledDocument and buildStyledBytes): text
 * blocks need a role of the style and a string text; table blocks need even rows of one-line
 * cells. The error names the block.
 */
export function stageBlocks(
  style: DocStyle,
  raw: unknown[],
): { ok: true; blocks: StyledBlock[] } | { ok: false; error: string } {
  const roleIds = new Set(style.roles.map((r) => r.id))
  const blocks: StyledBlock[] = []
  for (const [i, b] of raw.entries()) {
    if (isTableBlock(b)) {
      const error = tableBlockError(b)
      if (error) return { ok: false, error: `block ${i + 1}: ${error}` }
      blocks.push({ role: 'table', rows: b.rows.map((r) => [...r]) })
      continue
    }
    const block = b as { role?: unknown; text?: unknown } | null
    if (typeof block?.role !== 'string' || !roleIds.has(block.role)) {
      return {
        ok: false,
        error: `block ${i + 1}: unknown role "${String(block?.role)}" — roles are ${[...roleIds].join(', ')}`,
      }
    }
    if (typeof block.text !== 'string')
      return { ok: false, error: `block ${i + 1}: text must be a string` }
    blocks.push({ role: block.role, text: block.text })
  }
  return { ok: true, blocks }
}
