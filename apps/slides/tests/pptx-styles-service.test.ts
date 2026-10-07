/** @vitest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listPptxStyles, readPptxStyle } from '../src/main/pptx-styles-service'

const page = (json: unknown) =>
  `# 페이지\n\n설명 글입니다.\n\n\`\`\`json style\n${JSON.stringify(json)}\n\`\`\`\n`

const pptxPage = (id: string) =>
  page({
    format: 'pptx',
    id,
    title: `발표 ${id}`,
    version: 1,
    draft: true,
    evidence: { documents: 4, note: '합성' },
    slide: { ratio: '16:9' },
    theme: {
      fontMajor: 'Calibri',
      fontMinor: 'Calibri',
      colors: { dark: '#1F2937', light: '#FFFFFF', accent: ['#1F4FD8'] },
    },
    roles: [
      {
        id: 'slide-title',
        label: '제목',
        kind: 'title',
        size: 32,
        bold: true,
        align: 'left',
        box: { x: 0.06, y: 0.05, w: 0.88, h: 0.15 },
      },
    ],
    layouts: [{ id: 'content', label: '본문', use: '내용', elements: [{ role: 'slide-title' }] }],
    skeleton: [{ slot: 'content', layout: 'content', repeat: true }],
  })

const docxPage = page({
  format: 'docx',
  id: 'docx-report',
  title: '워드',
  version: 1,
  evidence: { documents: 1, note: '합성' },
  page: {
    paper: 'A4',
    orientation: 'portrait',
    marginMm: { left: 25, right: 25, top: 25, bottom: 25 },
    settable: true,
  },
  fonts: {},
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
  skeleton: [{ slot: 'body', role: 'body' }],
})

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pptx-wiki-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('listPptxStyles', () => {
  it('lists only the PowerPoint pages of the shared folder, with the draft flag', () => {
    writeFileSync(join(dir, 'a.md'), pptxPage('deck-pitch'))
    writeFileSync(join(dir, 'b.md'), docxPage)
    const r = listPptxStyles(dir)
    expect(r).toMatchObject({ ok: true, errors: [] })
    if (!r.ok) return
    expect(r.styles).toEqual([
      {
        id: 'deck-pitch',
        title: '발표 deck-pitch',
        draft: true,
        evidence: { documents: 4, note: '합성' },
      },
    ])
  })

  it('fails when the wiki is not available in this build', () => {
    expect(listPptxStyles(undefined)).toMatchObject({ ok: false })
  })
})

describe('readPptxStyle', () => {
  it('returns the style and the description of a PowerPoint page', () => {
    writeFileSync(join(dir, 'a.md'), pptxPage('deck-pitch'))
    const r = readPptxStyle(dir, 'deck-pitch')
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.style.layouts[0]).toMatchObject({ id: 'content' })
    expect(r.description).toContain('설명 글')
  })

  it('does not return a page of another format, or an unknown id', () => {
    writeFileSync(join(dir, 'b.md'), docxPage)
    expect(readPptxStyle(dir, 'docx-report')).toMatchObject({ ok: false })
    expect(readPptxStyle(dir, 'nope')).toMatchObject({ ok: false })
    expect(readPptxStyle(dir, 5 as never)).toMatchObject({ ok: false })
  })
})
