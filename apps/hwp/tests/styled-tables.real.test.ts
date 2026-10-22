/** @vitest-environment node */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadDocStyles } from '../src/main/doc-styles'
import { resolveNativeBinary } from '../src/main/native-binary-path'
import { runRhwp } from '../src/main/rhwp-cli'
import { buildStyledDocument } from '../src/main/styled-document'

/** tables in a styled document, against the real bundled engine; skipped without the binary */
const BIN = resolveNativeBinary('rhwp', {
  isPackaged: false,
  resourcesPath: '',
  repoRoot: resolve(__dirname, '../../..'),
  platform: process.platform,
  arch: process.arch,
})
const HAVE_BIN = existsSync(BIN)

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'styled-tables-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!HAVE_BIN)('styled document tables (real engine)', () => {
  it('builds the report style with two tables whose cells hold their text', async () => {
    const page = loadDocStyles(join(__dirname, '..', 'resources', 'doc-styles')).pages.find(
      (p) => p.style.id === 'report',
    )!
    const result = await buildStyledDocument(
      page.style,
      [
        { role: 'title', text: '시험 보고서' },
        { role: 'chapter', text: '1. 규제' },
        { role: 'body', text: '첫 문장이 결론이다.' },
        {
          role: 'table',
          rows: [
            ['단계', '내용'],
            ['1', '데이터 보호'],
          ],
        },
        { role: 'bullet', text: '- 사이 문단' },
        {
          role: 'table',
          rows: [
            ['지표', '값', '기준'],
            ['국가 수', '137', '194개국 중'],
          ],
        },
      ],
      { rhwpPath: BIN, workDir: join(dir, 'work') },
    )
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    const out = join(dir, 'tables.hwpx')
    writeFileSync(out, Buffer.from(result.data))
    const text = await runRhwp(BIN, ['export-text', out, '--json'])
    expect(text.exitCode, text.stderr).toBe(0)
    const all = JSON.stringify(text.envelope ?? text.stdout ?? '')
    for (const cell of ['데이터 보호', '194개국 중', '첫 문장이 결론이다.', '사이 문단']) {
      expect(all).toContain(cell)
    }
  }, 120_000)
})
