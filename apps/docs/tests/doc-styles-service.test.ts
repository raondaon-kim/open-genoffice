/** @vitest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listDocxStyles, readDocxStyle } from '../src/main/doc-styles-service'

const page = (json: unknown) =>
  `# 페이지\n\n설명 글입니다.\n\n\`\`\`json style\n${JSON.stringify(json)}\n\`\`\`\n`

const docxPage = (id: string, extra: Record<string, unknown> = {}) =>
  page({
    format: 'docx',
    id,
    title: `제목 ${id}`,
    version: 1,
    draft: true,
    evidence: { documents: 3, note: '합성' },
    page: {
      paper: 'A4',
      orientation: 'portrait',
      marginMm: { left: 25, right: 25, top: 25, bottom: 25 },
      settable: true,
    },
    fonts: { latin: 'Calibri' },
    roles: [
      {
        id: 'body',
        label: '본문',
        kind: 'body',
        size: 11,
        bold: false,
        align: 'left',
        spacingBefore: 0,
        spacingAfter: 8,
        lineSpacing: 1.15,
        indentLeft: 0,
        indentFirstLine: 0,
      },
    ],
    skeleton: [{ slot: 'body', role: 'body', repeat: true }],
    ...extra,
  })

const hwpPage = page({
  id: 'hwp-page',
  title: '한글',
  version: 1,
  evidence: { documents: 1, note: '합성' },
  page: { paper: 'A4', marginMm: { left: 20, right: 15, top: 20, bottom: 15 }, settable: false },
  roles: [
    {
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
    },
  ],
  skeleton: [{ slot: 'body', role: 'item-1' }],
})

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'docx-wiki-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('listDocxStyles', () => {
  it('lists only the Word pages of the shared folder, with the draft flag', () => {
    writeFileSync(join(dir, 'a.md'), docxPage('docx-report'))
    writeFileSync(join(dir, 'b.md'), hwpPage)
    const r = listDocxStyles(dir)
    expect(r).toMatchObject({ ok: true, errors: [] })
    if (!r.ok) return
    expect(r.styles).toEqual([
      {
        id: 'docx-report',
        title: '제목 docx-report',
        draft: true,
        evidence: { documents: 3, note: '합성' },
      },
    ])
  })

  it('reports invalid pages without hiding the valid ones', () => {
    writeFileSync(join(dir, 'a.md'), docxPage('docx-report'))
    writeFileSync(join(dir, 'broken.md'), '# nothing here')
    const r = listDocxStyles(dir)
    expect(r.ok && r.styles).toHaveLength(1)
    expect(r.ok && r.errors).toEqual([expect.stringMatching(/broken\.md/)])
  })

  it('fails when the wiki is not available in this build', () => {
    expect(listDocxStyles(undefined)).toMatchObject({ ok: false })
  })
})

describe('readDocxStyle', () => {
  it('returns the style and the description of a Word page', () => {
    writeFileSync(join(dir, 'a.md'), docxPage('docx-report'))
    const r = readDocxStyle(dir, 'docx-report')
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.style.roles[0]).toMatchObject({ id: 'body', size: 11 })
    expect(r.description).toContain('설명 글')
  })

  it('does not return a page of another format, or an unknown id', () => {
    writeFileSync(join(dir, 'b.md'), hwpPage)
    expect(readDocxStyle(dir, 'hwp-page')).toMatchObject({ ok: false })
    expect(readDocxStyle(dir, 'nope')).toMatchObject({ ok: false })
    expect(readDocxStyle(dir, 5 as never)).toMatchObject({ ok: false })
  })
})
