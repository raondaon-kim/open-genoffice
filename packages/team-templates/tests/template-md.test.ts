import { describe, expect, it } from 'vitest'
import { measureDocxStyle } from '../src/measure'
import { parseTemplateMd, renderTemplateMd, type TemplateDef } from '../src/template-md'
import { makeDocx, ODA_BLOCKS } from './fixtures'

async function sampleDef(): Promise<TemplateDef> {
  return {
    title: 'KOICA ODA 기술제안서',
    kind: 'Word',
    purpose: 'KOICA 용역 입찰의 기술제안서 본문',
    confirmedAt: '2026-10-28',
    author: '공용',
    documents: 3,
    signatures: ['0123456789abcdef', 'fedcba9876543210'],
    formSha256: 'a'.repeat(64),
    materials: ['제안요청서', '회사소개서'],
    wikiPages: ['methods/pmc-제안서-목차-구성-방식'],
    outline: [
      { level: 1, heading: 'Ⅰ. 제안사 소개', guidance: '일반현황·연혁을 증빙 위주로' },
      { level: 2, heading: '1. 일반현황 및 연혁', guidance: '' },
      { level: 3, heading: '1-1. 회사 일반현황', guidance: '회사명·대표자·주소를 글머리로' },
    ],
    notes: '제안요청서가 첨부되면 그 평가 항목을 따른다.',
    style: await measureDocxStyle(await makeDocx(ODA_BLOCKS), {
      id: 'team-koica-oda',
      title: 'KOICA ODA 기술제안서',
      documents: 3,
    }),
  }
}

describe('template.md', () => {
  it('round trips', async () => {
    const def = await sampleDef()
    const parsed = parseTemplateMd(renderTemplateMd(def))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.def).toEqual(def)
  })

  it('renders the fixed header lines and a nested outline', async () => {
    const text = renderTemplateMd(await sampleDef())
    expect(text).toContain('# KOICA ODA 기술제안서 (Word)\n')
    expect(text).toContain('- 상태: 확정 · 2026-10-28 · 공용\n')
    expect(text).toContain('- 근거 문서: 3건\n')
    expect(text).toContain(`- 형태 파일: form.docx · sha256 ${'a'.repeat(64)}\n`)
    expect(text).toContain(
      '## 목차\n- Ⅰ. 제안사 소개 — 일반현황·연혁을 증빙 위주로\n  - 1. 일반현황 및 연혁\n    - 1-1. 회사 일반현황 — 회사명·대표자·주소를 글머리로\n',
    )
    expect(text).toContain('```json style\n')
  })

  it('keeps guidance edits made in review', async () => {
    const text = renderTemplateMd(await sampleDef()).replace(
      '회사명·대표자·주소를 글머리로',
      '회사명과 대표자를 표로',
    )
    const parsed = parseTemplateMd(text)
    expect(parsed.ok && parsed.def.outline[2]!.guidance).toBe('회사명과 대표자를 표로')
  })

  it('names what is missing', async () => {
    const text = renderTemplateMd(await sampleDef())
    expect(parseTemplateMd(text.replace('## 목차', '## 차례'))).toEqual({
      ok: false,
      error: 'the template has no "## 목차" section',
    })
    const noStyle = parseTemplateMd(text.slice(0, text.indexOf('```json style')))
    expect(noStyle.ok).toBe(false)
    const badHash = parseTemplateMd(text.replace('a'.repeat(64), 'xyz'))
    expect(badHash).toEqual({ ok: false, error: 'the 형태 파일 line needs a sha256 of form.docx' })
  })
})
