/** @vitest-environment node */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportDocStyles, loadDocStyles } from '../src/main/doc-styles'

const role = {
  id: 'item-1',
  label: '항목',
  marker: 'N.',
  lead: 0,
  size: 13,
  bold: false,
  align: 'justify',
  marginLeft: 0,
  marginRight: 0,
  indent: 0,
  spacingBefore: 0,
  spacingAfter: 0,
  lineSpacing: 160,
}
const page = (id: string, extra: Record<string, unknown> = {}) =>
  `# ${id}\n\n설명\n\n\`\`\`json style\n${JSON.stringify({
    id,
    title: id,
    version: 1,
    evidence: { documents: 1, note: '합성' },
    page: { paper: 'A4', marginMm: { left: 20, right: 15, top: 20, bottom: 15 }, settable: false },
    roles: [role],
    skeleton: [{ slot: 'body', role: 'item-1' }],
    ...extra,
  })}\n\`\`\`\n`

let dir = ''
let out = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doc-styles-'))
  out = mkdtempSync(join(tmpdir(), 'doc-styles-out-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
})

describe('loadDocStyles', () => {
  it('reads every valid page, sorted by id, and reports the invalid ones without throwing', () => {
    writeFileSync(join(dir, 'b.md'), page('b-style'))
    writeFileSync(join(dir, 'a.md'), page('a-style'))
    writeFileSync(join(dir, 'broken.md'), '# no style block')
    writeFileSync(join(dir, 'notes.txt'), 'ignored')
    const { pages, errors } = loadDocStyles(dir)
    expect(pages.map((p) => p.style.id)).toEqual(['a-style', 'b-style'])
    expect(pages[0]!.description).toContain('설명')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/broken\.md/)
  })

  it('skips a page whose id repeats an earlier page', () => {
    writeFileSync(join(dir, 'a.md'), page('same'))
    writeFileSync(join(dir, 'b.md'), page('same'))
    const { pages, errors } = loadDocStyles(dir)
    expect(pages).toHaveLength(1)
    expect(errors[0]).toMatch(/duplicate/)
  })

  it('reports an entry it cannot read and keeps the other pages', () => {
    writeFileSync(join(dir, 'a.md'), page('a-style'))
    mkdirSync(join(dir, 'folder.md'))
    const { pages, errors } = loadDocStyles(dir)
    expect(pages.map((p) => p.style.id)).toEqual(['a-style'])
    expect(errors).toEqual([expect.stringMatching(/folder\.md/)])
  })

  it('returns nothing for a missing folder', () => {
    expect(loadDocStyles(join(dir, 'missing'))).toEqual({
      pages: [],
      errors: [expect.stringMatching(/not found/)],
    })
  })
})

describe('exportDocStyles', () => {
  it('copies the markdown pages into <target>/genoffice-doc-styles', () => {
    writeFileSync(join(dir, 'a.md'), page('a-style'))
    writeFileSync(join(dir, 'notes.txt'), 'ignored')
    const result = exportDocStyles(dir, out, { overwrite: false })
    expect(result).toEqual({ ok: true, target: join(out, 'genoffice-doc-styles'), count: 1 })
    expect(readdirSync(join(out, 'genoffice-doc-styles'))).toEqual(['a.md'])
    expect(readFileSync(join(out, 'genoffice-doc-styles', 'a.md'), 'utf8')).toBe(page('a-style'))
  })

  it('does not overwrite an existing page unless told to, and names the conflicts', () => {
    writeFileSync(join(dir, 'a.md'), page('a-style'))
    exportDocStyles(dir, out, { overwrite: false })
    writeFileSync(join(out, 'genoffice-doc-styles', 'a.md'), 'EDITED BY A PERSON')
    expect(exportDocStyles(dir, out, { overwrite: false })).toEqual({
      ok: false,
      conflicts: ['a.md'],
    })
    expect(readFileSync(join(out, 'genoffice-doc-styles', 'a.md'), 'utf8')).toBe(
      'EDITED BY A PERSON',
    )
    expect(exportDocStyles(dir, out, { overwrite: true })).toMatchObject({ ok: true, count: 1 })
    expect(readFileSync(join(out, 'genoffice-doc-styles', 'a.md'), 'utf8')).toBe(page('a-style'))
  })

  it('reports a failure instead of throwing when the target folder name is taken by a file', () => {
    writeFileSync(join(dir, 'a.md'), page('a-style'))
    writeFileSync(join(out, 'genoffice-doc-styles'), 'I am a file')
    const result = exportDocStyles(dir, out, { overwrite: true })
    expect(result).toMatchObject({ ok: false, error: expect.any(String) })
  })

  it('exports nothing when there are no pages', () => {
    expect(exportDocStyles(join(dir, 'missing'), out, { overwrite: false })).toEqual({
      ok: true,
      target: join(out, 'genoffice-doc-styles'),
      count: 0,
    })
    expect(existsSync(join(out, 'genoffice-doc-styles'))).toBe(false)
  })
})
