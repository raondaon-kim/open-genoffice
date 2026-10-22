import type { Editor } from '@tiptap/core'
import type { AgentSkill, AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import type { DocxRole, DocxStyle } from '@genoffice/doc-styles'
import type { DesktopApi } from '../../shared/ipc'
import type { PmMark, PmNode } from '../editor/convert'
import { insertBlocksAfter, replaceBlockRange, type AiTrack, type NumIds } from './protocol'

/**
 * The document-style wiki as an AgentSkill for Word documents: the assistant lists the known
 * document types, reads one, and writes a whole styled document from {role, text} blocks.
 *
 * Each block becomes a paragraph, heading or list item that already carries its role's
 * formatting (size, weight, fonts, color, alignment, spacing, indents), and all blocks go into
 * the document in one transaction: one undo step, one tracked insertion per block, and no
 * HTML round trip that could drop blank lines or mangle the text.
 */

const MAX_BLOCKS = 300
const MAX_BLOCK_CHARS = 4000

type StylesApi = Pick<DesktopApi, 'listDocStyles' | 'readDocStyle'>

const STYLES_SYSTEM_PROMPT = `## Document style wiki
- A whole document built from attachments or the work wiki (report, proposal, plan) goes through write_report, which picks the style itself; the rules below are for the rest.
- Before writing a NEW document or a large new section from scratch, ALWAYS call list_document_styles first.
- When a style fits the kind of document, call read_document_style, then write_styled_document with the whole document as blocks of {role, text}. Pick roles from the role table; write only the text (with its own number or marker if the role uses one) — never choose sizes, fonts, spacing or indentation yourself, the role carries them. A style marked draft is still used.
- Long documents are written in stages, never in one call: first fix the outline (chapters and sections), then call write_styled_document for the cover and table of contents, then once per chapter (each call appends at the end of the document), finishing every chapter before the next.
- Public bid proposal (공공입찰 제안서/기술제안서) from an attached RFP (제안요청서): read the RFP first and use the docx-bid-proposal style. Follow the RFP's proposal table of contents and numbering exactly, give each chapter space in proportion to its evaluation points within the page limit, answer every requirement ID, write commitments as "~한다" with numbers and dates, and never invent facts about the bidder: leave placeholders such as [회사 실적 기재]. Write each section as a proposal, not a copy of the RFP: (1) understanding of the requirement, citing the RFP; (2) the method — step-by-step procedure, techniques, tools and equipment, schedule and who does it; (3) quality and risk control; (4) deliverables; (5) expected effect. Proposing standard professional methods is expected (they are the bidder's commitments); only facts about the bidder itself (company history, staff names, past projects, certifications, owned equipment) are placeholders. A major section is several sub-items with concrete content, not two lines; use the RFP page budget.
- Korean ODA project proposal (KOICA·EDCF 사업수행기관/컨설팅 제안서) from an attached RFP or 과업지시서: read it first and use the docx-oda-proposal style. Follow its proposal outline and page shares (KOICA: 제안사 소개 ≤10%, 기술 ≤50%, 사업관리 ≤30%, 고도화 ≤10%; EDCF: 과업 이해, 수행계획, 조직·인력, 성과·품질). Tie every activity to the PDM (Goal - Outcome - Output - Activity - Input); give each indicator a formula, baseline, target and means of verification, disaggregated by sex; cover cross-cutting issues (gender, vulnerable groups and disability, environment, human rights, child protection), local partners and recipient ownership, sustainability and exit, and a risk matrix (likelihood x impact, grade 1-5) including staff safety; ground claims in data; spell out abbreviations the first time. The same section pattern and placeholder rule as for bid proposals apply.
- When no style fits, do not ask or refuse: write the document yourself with the other document tools, choosing sensible headings, sizes and spacing for that kind of document.`

const tools: AgentToolDef[] = [
  {
    name: 'list_document_styles',
    description:
      'List the Word document types the style wiki knows (id, title, how many real documents the values come from, whether the values are still a draft). Always call it first when asked to write a document from scratch.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_document_style',
    description:
      'Read one document type: its roles (id, label, kind, heading level, size, bold, alignment, font, spacing, indents), the skeleton (order of the parts, which are required), page setup and a description. Pick roles from this table for write_styled_document.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Style id from list_document_styles' } },
      required: ['id'],
    },
  },
  {
    name: 'write_styled_document',
    description:
      'Write a document in a known document type into the open document. blocks is the whole text in order: each block is {role, text} — role from read_document_style, text ONE line without formatting (include its own numbering or marker such as "1. " when the content needs it; list roles get their bullet from the role). Sizes, fonts, alignment, spacing and indentation come from the role: never type them. Use an empty text for a blank line. The blocks replace an empty document, or go after block afterBlockIndex (default: the end). Up to 300 blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Style id' },
        blocks: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BLOCKS,
          items: {
            type: 'object',
            properties: { role: { type: 'string' }, text: { type: 'string' } },
            required: ['role', 'text'],
          },
        },
        afterBlockIndex: {
          type: 'integer',
          description: 'Insert after this top-level block (default: the end of the document)',
        },
      },
      required: ['style', 'blocks'],
    },
  },
]

const fail = (summary: string, output: string): ToolExecution => ({
  output,
  isError: true,
  mutated: false,
  summary,
})

const twips = (pt: number): number => Math.round(pt * 20)

/** the run formatting of one role: weight, slant, size, Latin and East Asian fonts, color */
function runMarks(style: DocxStyle, role: DocxRole): PmMark[] {
  const latin = role.font ?? style.fonts.latin
  const eastAsian = style.fonts.eastAsian ?? role.font
  const marks: PmMark[] = []
  if (role.bold) marks.push({ type: 'bold' })
  if (role.italic) marks.push({ type: 'italic' })
  marks.push({
    type: 'docTextStyle',
    attrs: {
      sizeHalfPoints: Math.round(role.size * 2),
      ...(latin ? { font: latin } : {}),
      ...(eastAsian ? { eastAsiaFont: eastAsian } : {}),
      ...(role.color ? { color: role.color.replace(/^#/, '').toUpperCase() } : {}),
    },
  })
  return marks
}

/** one top-level block per {role, text}, carrying the role's paragraph and run formatting */
export function styledBlockNodes(
  style: DocxStyle,
  blocks: ReadonlyArray<{ role: DocxRole; text: string }>,
  numIds: NumIds,
): PmNode[] {
  return blocks.map(({ role, text }) => {
    const attrs: Record<string, unknown> = {
      docxIndex: null,
      styleId: null,
      aiChanged: true,
      align: role.align,
      lineSpacing: role.lineSpacing,
      indentLeft: twips(role.indentLeft),
      indentFirstLine: twips(role.indentFirstLine),
      // explicit zero is kept: a role with no space after must not fall back to the style's
      spaceBefore: twips(role.spacingBefore),
      spaceAfter: twips(role.spacingAfter),
    }
    let type = 'docParagraph'
    if (role.kind === 'heading') {
      type = 'docHeading'
      attrs.level = Math.min(Math.max(role.heading ?? 1, 1), 6)
    } else if (role.kind === 'list' && role.bullet !== 'none') {
      type = 'docListItem'
      const kind = role.bullet === 'number' ? 'ordered' : 'bullet'
      attrs.kind = kind
      attrs.numId = numIds[kind]
      attrs.ilvl = 0
    }
    const node: PmNode = { type, attrs }
    // a blank line is an empty paragraph (still formatted, so its height matches the role)
    if (text) node.content = [{ type: 'text', text, marks: runMarks(style, role) }]
    return node
  })
}

/** a document whose only block is an empty paragraph or heading (a new, blank document) */
function isBlankDocument(editor: Editor): boolean {
  const doc = editor.state.doc
  if (doc.childCount !== 1) return false
  const only = doc.child(0)
  return (
    (only.type.name === 'docParagraph' || only.type.name === 'docHeading') &&
    only.content.size === 0
  )
}

function missingParts(style: DocxStyle, used: Set<string>): string[] {
  const out: string[] = []
  for (const slot of style.skeleton) {
    if (!slot.required) continue
    const roles = slot.roles ?? (slot.role ? [slot.role] : [])
    if (!roles.some((r) => used.has(r)))
      out.push(`missing required part "${slot.slot}" (${roles.join(' / ')})`)
  }
  return out
}

export function createStylesSkill(
  getEditor: () => Editor,
  getNumIds: () => NumIds,
  getTrack: (() => AiTrack | undefined) | undefined,
  api: () => StylesApi,
): AgentSkill {
  return {
    id: 'doc-styles',
    systemPrompt: STYLES_SYSTEM_PROMPT,
    tools,
    buildContext: () => '',
    executeTool: async (call): Promise<ToolExecution> => {
      const input = (call.input ?? {}) as Record<string, unknown>
      if (call.name === 'list_document_styles') {
        const r = await api().listDocStyles()
        if (!r.ok) return fail('styles unavailable', r.error)
        return {
          output: JSON.stringify({ styles: r.styles }),
          mutated: false,
          summary: `${r.styles.length} document style(s)`,
        }
      }
      if (call.name === 'read_document_style') {
        const r = await api().readDocStyle(String(input.id ?? ''))
        if (!r.ok)
          return fail('unknown style', `${r.error} — call list_document_styles for the known ids`)
        const s = r.style
        return {
          output: JSON.stringify({
            id: s.id,
            title: s.title,
            draft: s.draft === true,
            evidence: s.evidence,
            page: s.page,
            fonts: s.fonts,
            roles: s.roles,
            skeleton: s.skeleton,
            description: r.description.slice(0, 3000),
          }),
          mutated: false,
          summary: `style ${s.id}: ${s.roles.length} role(s)`,
        }
      }
      if (call.name !== 'write_styled_document')
        return fail(call.name, `unknown tool: ${call.name}`)

      const blocksIn = input.blocks
      if (
        typeof input.style !== 'string' ||
        !Array.isArray(blocksIn) ||
        blocksIn.length === 0 ||
        blocksIn.length > MAX_BLOCKS
      ) {
        return fail(
          'invalid argument',
          `write_styled_document needs a style id and 1-${MAX_BLOCKS} blocks`,
        )
      }
      const read = await api().readDocStyle(input.style)
      if (!read.ok)
        return fail('unknown style', `${read.error} — call list_document_styles for the known ids`)
      const style = read.style
      const roles = new Map(style.roles.map((r) => [r.id, r]))
      const blocks: Array<{ role: DocxRole; text: string }> = []
      for (const [i, b] of blocksIn.entries()) {
        const block = b as { role?: unknown; text?: unknown }
        const role = typeof block?.role === 'string' ? roles.get(block.role) : undefined
        if (!role)
          return fail(
            'invalid argument',
            `block ${i + 1}: unknown role "${String(block?.role)}" — roles are ${[...roles.keys()].join(', ')}`,
          )
        if (
          typeof block.text !== 'string' ||
          block.text.length > MAX_BLOCK_CHARS ||
          /[\n\r]/.test(block.text)
        ) {
          return fail(
            'invalid argument',
            `block ${i + 1}: text must be one line (max ${MAX_BLOCK_CHARS} characters)`,
          )
        }
        blocks.push({ role, text: block.text })
      }

      const editor = getEditor()
      const count = editor.state.doc.childCount
      const blank = isBlankDocument(editor)
      // a model often sends null for an optional field: treat it as "not given"
      const requested = input.afterBlockIndex
      let after = count - 1
      if (!blank && requested != null) {
        const n = Number(requested)
        if (!Number.isInteger(n)) return fail('invalid argument', 'invalid afterBlockIndex')
        after = Math.min(Math.max(n, -1), count - 1)
      }
      const nodes = styledBlockNodes(style, blocks, getNumIds())
      const track = getTrack?.()
      const ok = blank
        ? replaceBlockRange(editor, 0, 0, nodes, track)
        : insertBlocksAfter(editor, after, nodes, track)
      if (!ok) return fail('insert failed', 'The blocks could not be inserted into the document.')
      const start = blank ? 0 : after + 1

      const used = new Set(blocks.map((b) => b.role.id))
      const counts = new Map<string, number>()
      for (const b of blocks) counts.set(b.role.id, (counts.get(b.role.id) ?? 0) + 1)
      const warnings = missingParts(style, used)
      const lines = [
        `Wrote ${blocks.length} block(s) in "${style.title}" (${[...counts]
          .map(([r, n]) => `${r}×${n}`)
          .join(', ')}) at blocks ${start}-${start + blocks.length - 1}.`,
        ...warnings.map((w) => `Warning: ${w}`),
        style.page.settable
          ? 'The page setup (paper, margins) in the style is a reference: set it in the Layout tab if the document needs it.'
          : 'Page margins are not set by this tool.',
      ]
      return {
        output: lines.join('\n'),
        mutated: true,
        summary: `styled document written (${blocks.length} blocks)`,
      }
    },
  }
}
