import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import type { DocStyle } from '../shared/doc-style'
import { runRhwp } from './rhwp-cli'
import {
  buildStyledDocument,
  isTableBlock,
  missingParts,
  prepareStyledTexts,
  type StyledBlock,
  type StyledDeps,
  type StyledResult,
} from './styled-document'

/**
 * Builds a styled document in one engine pass. The op-by-op builder runs the engine twice per
 * paragraph (paragraph shape, character shape), each run re-reading the whole file, so a
 * 300-paragraph report takes minutes. Here:
 *   1. the role formats are taken from the engine itself, once per style: a one-paragraph-per-
 *      role document is built the op-by-op way and its paraPr / charPr elements are kept;
 *   2. the document is scaffolded in one call (tables included);
 *   3. those elements are added to its header and every paragraph points at its role's.
 * The result has the same paragraph shapes as the op-by-op build (pinned by a real-engine test).
 */

interface RoleFormat {
  /** a header id that exists in every scaffold header, or the element to add */
  para: { baseId: number } | { xml: string }
  char: { baseId: number } | { xml: string }
}

const harvests = new Map<string, Map<string, RoleFormat>>()

interface TopParagraph {
  start: number
  openEnd: number
  end: number
}

/** top-level <hp:p> elements of a section (table cell paragraphs are nested and skipped) */
function topLevelParagraphs(xml: string): TopParagraph[] {
  const out: TopParagraph[] = []
  const tag = /<hp:p\b[^>]*>|<\/hp:p>/g
  let depth = 0
  let current: { start: number; openEnd: number } | null = null
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    if (m[0].startsWith('</')) {
      depth--
      if (depth === 0 && current) {
        out.push({ ...current, end: m.index + m[0].length })
        current = null
      }
    } else {
      if (depth === 0) current = { start: m.index, openEnd: m.index + m[0].length }
      depth++
    }
  }
  return out
}

const itemCount = (header: string, list: string): number => {
  const m = new RegExp(`<hh:${list}\\b[^>]*itemCnt="(\\d+)"`).exec(header)
  if (!m) throw new Error(`no ${list} in the header`)
  return Number(m[1])
}

const elementById = (header: string, tag: string, id: number): string => {
  const m = new RegExp(`<hh:${tag} id="${id}"[\\s\\S]*?</hh:${tag}>`).exec(header)
  if (!m) throw new Error(`no ${tag} ${id} in the header`)
  return m[0]
}

/** the paraPr id of a paragraph and the charPr id of its first text run */
function paragraphRefs(xml: string, p: TopParagraph): { para: number; char: number } {
  const open = xml.slice(p.start, p.openEnd)
  const para = Number(/paraPrIDRef="(\d+)"/.exec(open)?.[1] ?? NaN)
  const body = xml.slice(p.openEnd, p.end)
  // the engine may leave an empty text run in front: the format is on the run with the text
  const run = /<hp:run charPrIDRef="(\d+)">(?:(?!<\/hp:run>)[\s\S])*?<hp:t>[^<]/.exec(body)
  const char = Number(run?.[1] ?? NaN)
  if (!Number.isFinite(para) || !Number.isFinite(char)) throw new Error('a paragraph has no refs')
  return { para, char }
}

async function readParts(
  data: Uint8Array,
): Promise<{ zip: JSZip; header: string; section: string }> {
  const zip = await JSZip.loadAsync(data)
  const header = await zip.file('Contents/header.xml')?.async('string')
  const section = await zip.file('Contents/section0.xml')?.async('string')
  if (!header || !section) throw new Error('not a scaffolded hwpx')
  return { zip, header, section }
}

/** each role's paragraph and character format as the engine writes them */
async function harvest(
  style: DocStyle,
  roles: string[],
  deps: StyledDeps,
): Promise<Map<string, RoleFormat>> {
  const key = `${style.id}@${style.version}:${JSON.stringify(style.roles)}`
  const cached = harvests.get(key)
  if (cached && roles.every((r) => cached.has(r))) return cached
  const all = style.roles.map((r) => r.id)
  const built = await buildStyledDocument(
    style,
    all.map((role) => ({ role, text: 'x' })),
    { ...deps, workDir: join(deps.workDir, 'formats') },
  )
  if (!built.ok) throw new Error(`role formats: ${built.error}`)
  const { header, section } = await readParts(built.data)
  // ids below the scaffold's own counts exist in every scaffold header
  const base = await scaffoldBase(deps)
  const paras = topLevelParagraphs(section)
  if (paras.length !== all.length) throw new Error('role formats: paragraph count mismatch')
  const out = new Map<string, RoleFormat>()
  all.forEach((role, i) => {
    const refs = paragraphRefs(section, paras[i]!)
    out.set(role, {
      para:
        refs.para < base.para
          ? { baseId: refs.para }
          : { xml: elementById(header, 'paraPr', refs.para) },
      char:
        refs.char < base.char
          ? { baseId: refs.char }
          : { xml: elementById(header, 'charPr', refs.char) },
    })
  })
  harvests.set(key, out)
  return out
}

let baseCounts: { para: number; char: number } | null = null
async function scaffoldBase(deps: StyledDeps): Promise<{ para: number; char: number }> {
  if (baseCounts) return baseCounts
  const data = await scaffold([{ type: 'paragraph', text: 'x' }], deps, 'base')
  const { header } = await readParts(data)
  baseCounts = {
    para: itemCount(header, 'paraProperties'),
    char: itemCount(header, 'charProperties'),
  }
  return baseCounts
}

type SpecBlock = { type: 'paragraph'; text: string } | { type: 'table'; rows: string[][] }

async function scaffold(blocks: SpecBlock[], deps: StyledDeps, name: string): Promise<Uint8Array> {
  const run = deps.run ?? runRhwp
  await mkdir(deps.workDir, { recursive: true })
  const spec = join(deps.workDir, `${name}.json`)
  const out = join(deps.workDir, `${name}.hwpx`)
  try {
    await writeFile(spec, JSON.stringify({ version: '1', blocks }))
    const r = await run(deps.rhwpPath, ['scaffold', spec, '-o', out, '--json'])
    if (r.exitCode !== 0)
      throw new Error(`could not create the document: ${r.stderr.trim().slice(0, 300)}`)
    return new Uint8Array(await readFile(out))
  } finally {
    await Promise.all([rm(spec, { force: true }), rm(out, { force: true })])
  }
}

/** add the role elements to the header list, giving them ids after the existing ones */
function addElements(
  header: string,
  list: 'paraProperties' | 'charProperties',
  tag: 'paraPr' | 'charPr',
  xmls: string[],
): { header: string; ids: Map<string, number> } {
  const ids = new Map<string, number>()
  const start = itemCount(header, list)
  const added: string[] = []
  for (const xml of xmls) {
    if (ids.has(xml)) continue
    const id = start + ids.size
    ids.set(xml, id)
    added.push(xml.replace(new RegExp(`^<hh:${tag} id="\\d+"`), `<hh:${tag} id="${id}"`))
  }
  if (added.length === 0) return { header, ids }
  const close = `</hh:${list}>`
  const at = header.indexOf(close)
  if (at < 0) throw new Error(`no ${list} list end in the header`)
  const withItems = header.slice(0, at) + added.join('') + header.slice(at)
  return {
    header: withItems.replace(
      new RegExp(`(<hh:${list}\\b[^>]*itemCnt=")\\d+(")`),
      `$1${start + added.length}$2`,
    ),
    ids,
  }
}

export async function buildStyledDocumentFast(
  style: DocStyle,
  blocks: StyledBlock[],
  deps: StyledDeps,
): Promise<StyledResult> {
  const prepared = prepareStyledTexts(style, blocks)
  if (!prepared.ok) return prepared
  // its own sub-directory: the caller's directory may hold other files
  const work: StyledDeps = { ...deps, workDir: join(deps.workDir, 'fast') }
  try {
    const textRoles = [...new Set(blocks.filter((b) => !isTableBlock(b)).map((b) => b.role))]
    const formats = await harvest(style, textRoles, work)
    const spec: SpecBlock[] = blocks.map((b, i) =>
      isTableBlock(b)
        ? { type: 'table', rows: b.rows }
        : { type: 'paragraph', text: prepared.texts[i]! },
    )
    const parts = await readParts(await scaffold(spec, work, 'document'))
    const all = topLevelParagraphs(parts.section)
    // a table is one paragraph holding it, followed by an empty paragraph the engine adds
    const paras: TopParagraph[] = []
    let next = 0
    for (const b of blocks) {
      const at = all[next]
      if (!at) break
      paras.push(at)
      next++
      if (isTableBlock(b)) {
        if (!parts.section.slice(at.openEnd, at.end).includes('<hp:tbl')) {
          throw new Error('a table block did not become a table')
        }
        const after = all[next]
        if (after && !parts.section.slice(after.openEnd, after.end).includes('<hp:t')) next++
      }
    }
    if (paras.length !== blocks.length || next !== all.length) {
      throw new Error(`the engine made ${all.length} paragraph(s) for ${blocks.length} block(s)`)
    }
    const fmt = (b: StyledBlock) => formats.get(b.role)!
    const paraXml = blocks.flatMap((b) =>
      isTableBlock(b) || !('xml' in fmt(b).para) ? [] : [(fmt(b).para as { xml: string }).xml],
    )
    const charXml = blocks.flatMap((b) =>
      isTableBlock(b) || !('xml' in fmt(b).char) ? [] : [(fmt(b).char as { xml: string }).xml],
    )
    const p = addElements(parts.header, 'paraProperties', 'paraPr', paraXml)
    const c = addElements(p.header, 'charProperties', 'charPr', charXml)
    const idOf = (f: RoleFormat['para'], ids: Map<string, number>) =>
      'baseId' in f ? f.baseId : ids.get(f.xml)!
    // rewrite from the last paragraph so earlier offsets stay valid
    let section = parts.section
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]!
      if (isTableBlock(b)) continue
      const at = paras[i]!
      const paraId = idOf(fmt(b).para, p.ids)
      const charId = idOf(fmt(b).char, c.ids)
      const open = section
        .slice(at.start, at.openEnd)
        .replace(/paraPrIDRef="\d+"/, `paraPrIDRef="${paraId}"`)
      const body = section
        .slice(at.openEnd, at.end)
        .replace(
          /<hp:run charPrIDRef="\d+">((?:(?!<\/hp:run>)[\s\S])*?<hp:t\b)/g,
          `<hp:run charPrIDRef="${charId}">$1`,
        )
      section = section.slice(0, at.start) + open + body + section.slice(at.end)
    }
    parts.zip.file('Contents/header.xml', c.header)
    parts.zip.file('Contents/section0.xml', section)
    const mimetype = await parts.zip.file('mimetype')?.async('string')
    if (mimetype !== undefined) parts.zip.file('mimetype', mimetype, { compression: 'STORE' })
    const data = await parts.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const roleCounts: Record<string, number> = Object.create(null)
    for (const b of blocks) roleCounts[b.role] = (roleCounts[b.role] ?? 0) + 1
    return {
      ok: true,
      data,
      paragraphs: blocks.length,
      roleCounts,
      warnings: missingParts(style, blocks),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await rm(work.workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * The document in one engine pass, or op by op when that fails (an engine whose output the
 * one-pass build cannot read): same shapes either way, the one-pass build is only faster.
 */
export async function buildStyled(
  style: DocStyle,
  blocks: StyledBlock[],
  deps: StyledDeps,
): Promise<StyledResult> {
  const fast = await buildStyledDocumentFast(style, blocks, deps)
  if (fast.ok) return fast
  console.warn(`[hwp] one-pass styled build failed, building op by op: ${fast.error}`)
  return buildStyledDocument(style, blocks, deps)
}
