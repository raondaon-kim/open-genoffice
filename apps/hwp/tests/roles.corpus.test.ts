/** @vitest-environment node */
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runEditChain } from '../src/main/ai-edit-chain'
import { dumpForShape } from '../src/main/dump-shape'
import { resolveNativeBinary } from '../src/main/native-binary-path'
import { runRhwp } from '../src/main/rhwp-cli'
import { parseDumpParagraphs } from '../src/main/rhwp-paragraphs'
import type { DumpParagraph } from '../src/main/rhwp-paragraphs'
import { markerOf } from '../src/shared/paragraph-roles'

/**
 * Local-only: a folder of real documents (never in the repo). For outline paragraphs of
 * several marker kinds in each document, add a paragraph with like = that paragraph and
 * check every copied attribute matches. GENOFFICE_CORPUS_DIR=D:\tmp\survey\govpress
 */
const CORPUS = process.env.GENOFFICE_CORPUS_DIR
const REPO_ROOT = resolve(__dirname, '../../..')
const BIN = resolveNativeBinary('rhwp', {
  isPackaged: false,
  resourcesPath: '',
  repoRoot: REPO_ROOT,
  platform: process.platform,
  arch: process.arch,
})
const RUN = Boolean(CORPUS) && existsSync(CORPUS ?? '') && existsSync(BIN)

const COPIED = [
  'lead',
  'align',
  'marginLeft',
  'marginRight',
  'indent',
  'spacingBefore',
  'spacingAfter',
  'lineSpacing',
  'fontSize',
  'bold',
] as const
const OUTLINE = ['□', '○', '-', '※', 'N.', '가.', 'N)', '가)', '(N)']

const work = RUN ? mkdtempSync(join(tmpdir(), 'roles-corpus-')) : ''
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!RUN)('template roles on a local corpus', () => {
  it('a paragraph added with like = X matches X on every copied attribute', async () => {
    const files = readdirSync(CORPUS!)
      .filter((f) => /\.hwpx?$/i.test(f))
      .slice(0, Number(process.env.GENOFFICE_CORPUS_LIMIT ?? 12))
    const mismatches: string[] = []
    let checked = 0
    for (const file of files) {
      const src = join(CORPUS!, file)
      const dumped = await dumpForShape(runRhwp, BIN, src)
      if (dumped.exitCode !== 0) continue
      const paras = parseDumpParagraphs(dumped.stdout ?? '')
      // one paragraph per outline marker kind present in the document
      const picks: DumpParagraph[] = []
      for (const marker of OUTLINE) {
        const hit = paras.find(
          (p) => !p.empty && markerOf(p.preview) === marker && p.fontSize !== undefined,
        )
        if (hit) picks.push(hit)
        if (picks.length === 3) break
      }
      for (const pick of picks) {
        const copy = join(work, `src-${checked}${/\.hwpx$/i.test(file) ? '.hwpx' : '.hwp'}`)
        copyFileSync(src, copy)
        const result = await runEditChain({
          rhwpPath: BIN,
          snapshotPath: copy,
          workDir: work,
          ops: [
            {
              op: 'insert_paragraph_like',
              section: pick.section,
              paragraph: pick.paragraph,
              like: { section: pick.section, paragraph: pick.paragraph },
              text: `${pick.preview.slice(0, 2)}검증 문단`,
            },
          ],
        })
        if (!result.ok) {
          mismatches.push(
            `${file} ${pick.section}.${pick.paragraph}: refused — ${result.error.slice(0, 80)}`,
          )
          continue
        }
        const out = join(work, `out-${checked}.hwpx`)
        writeFileSync(out, Buffer.from(result.data))
        const after = await dumpForShape(runRhwp, BIN, out)
        const added = parseDumpParagraphs(after.stdout ?? '').find(
          (p) => p.section === pick.section && p.paragraph === pick.paragraph + 1,
        )
        checked++
        if (!added) {
          mismatches.push(`${file} ${pick.section}.${pick.paragraph}: new paragraph not found`)
          continue
        }
        for (const key of COPIED) {
          if (pick[key] !== undefined && added[key] !== pick[key]) {
            mismatches.push(
              `${file} ${pick.section}.${pick.paragraph}: ${key} ${String(pick[key])} -> ${String(added[key])}`,
            )
          }
        }
      }
    }
    console.info(`[corpus] checked ${checked} added paragraphs, ${mismatches.length} mismatch(es)`)
    for (const line of mismatches.slice(0, 20)) console.info(`[corpus] ${line}`)
    expect(checked).toBeGreaterThan(0)
    expect(mismatches).toEqual([])
  }, 600_000)
})
