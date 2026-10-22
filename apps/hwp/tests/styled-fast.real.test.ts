/** @vitest-environment node */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadDocStyles } from '../src/main/doc-styles'
import { dumpForShape } from '../src/main/dump-shape'
import { resolveNativeBinary } from '../src/main/native-binary-path'
import { runRhwp } from '../src/main/rhwp-cli'
import { parseDumpParagraphs } from '../src/main/rhwp-paragraphs'
import { buildStyledDocument, type StyledBlock } from '../src/main/styled-document'
import { buildStyledDocumentFast } from '../src/main/styled-fast'

/**
 * The one-pass builder (scaffold + role formats harvested from the engine itself) must give
 * every paragraph the same shape as the op-by-op builder, much faster. Real engine; skipped
 * without the binary.
 */
const BIN = resolveNativeBinary('rhwp', {
  isPackaged: false,
  resourcesPath: '',
  repoRoot: resolve(__dirname, '../../..'),
  platform: process.platform,
  arch: process.arch,
})
const HAVE_BIN = existsSync(BIN)
const pages = loadDocStyles(join(__dirname, '..', 'resources', 'doc-styles')).pages

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'styled-fast-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const shapes = async (name: string, data: Uint8Array) => {
  const file = join(dir, name)
  writeFileSync(file, Buffer.from(data))
  const dumped = await dumpForShape(runRhwp, BIN, file)
  return parseDumpParagraphs(dumped.stdout ?? '')
    .filter((p) => !p.hasTable && !p.empty)
    .map(
      ({
        text,
        fontSize,
        bold,
        lead,
        align,
        marginLeft,
        indent,
        spacingBefore,
        spacingAfter,
        lineSpacing,
      }) => ({
        text,
        fontSize,
        bold,
        lead,
        align,
        marginLeft,
        indent,
        spacingBefore,
        spacingAfter,
        lineSpacing,
      }),
    )
}

describe.skipIf(!HAVE_BIN)('one-pass styled document (real engine)', () => {
  it.each(['report', 'bid-proposal', 'seoul-gian'])(
    '%s: every paragraph has the same shape as the op-by-op build',
    async (id) => {
      const style = pages.find((p) => p.style.id === id)!.style
      const roles = style.roles.map((r) => r.id)
      const blocks: StyledBlock[] = [
        ...roles.map((role, i) => ({ role, text: `${role} 문단 ${i}` })),
        {
          role: 'table',
          rows: [
            ['단계', '내용'],
            ['1', '데이터 보호'],
          ],
        },
        ...roles.map((role, i) => ({ role, text: `${role} 두 번째 ${i}` })),
      ]
      const slow = await buildStyledDocument(style, blocks, {
        rhwpPath: BIN,
        workDir: join(dir, `${id}-slow`),
      })
      const fast = await buildStyledDocumentFast(style, blocks, {
        rhwpPath: BIN,
        workDir: join(dir, `${id}-fast`),
      })
      expect(
        slow.ok && fast.ok,
        `slow: ${slow.ok ? 'ok' : slow.error} / fast: ${fast.ok ? 'ok' : fast.error}`,
      ).toBe(true)
      if (!slow.ok || !fast.ok) return
      expect(await shapes(`${id}-fast.hwpx`, fast.data)).toEqual(
        await shapes(`${id}-slow.hwpx`, slow.data),
      )
      const text = await runRhwp(BIN, ['export-text', join(dir, `${id}-fast.hwpx`), '--json'])
      expect(JSON.stringify(text.envelope)).toContain('데이터 보호')
    },
    180_000,
  )

  it('builds a 300-block report in a few seconds', async () => {
    const style = pages.find((p) => p.style.id === 'report')!.style
    const blocks: StyledBlock[] = Array.from({ length: 300 }, (_, i) => ({
      role: ['chapter', 'section', 'body', 'body', 'bullet'][i % 5]!,
      text: `문단 ${i} ${'가나다라마바사 '.repeat(15)}`,
    }))
    const started = Date.now()
    const fast = await buildStyledDocumentFast(style, blocks, {
      rhwpPath: BIN,
      workDir: join(dir, 'big'),
    })
    expect(fast.ok).toBe(true)
    expect(Date.now() - started).toBeLessThan(15_000)
  }, 120_000)
})
