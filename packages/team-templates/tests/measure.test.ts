import { validateDocx } from '@genoffice/doc-styles'
import { describe, expect, it } from 'vitest'
import { measureDocxStyle } from '../src/measure'
import { makeDocx, ODA_BLOCKS } from './fixtures'

const META = { id: 'team-koica-oda', title: 'KOICA ODA 기술제안서', documents: 2 }

describe('measureDocxStyle', () => {
  it('reads roles and page setup from styles and the section', async () => {
    const style = await measureDocxStyle(await makeDocx(ODA_BLOCKS), META)
    const role = (id: string) => style.roles.find((r) => r.id === id)!
    expect(role('heading-1')).toMatchObject({ kind: 'heading', heading: 1, size: 16, bold: true })
    expect(role('heading-1').lineSpacing).toBeCloseTo(1.3)
    expect(role('heading-1').spacingBefore).toBe(18)
    expect(role('body')).toMatchObject({ kind: 'body', size: 13, bold: false, align: 'justify' })
    expect(role('body').lineSpacing).toBeCloseTo(1.6)
    expect(role('bullet')).toMatchObject({
      kind: 'list',
      bullet: 'bullet',
      indentLeft: 34,
      indentFirstLine: -14,
    })
    expect(role('title')).toMatchObject({ kind: 'title', size: 22, align: 'center' })
    expect(style.page.paper).toBe('A4')
    expect(style.page.orientation).toBe('portrait')
    expect(style.page.marginMm.left).toBeCloseTo(25, 0)
    expect(style.page.marginMm.top).toBeCloseTo(20, 0)
    expect(style.page.marginMm.bottom).toBeCloseTo(15, 0)
    expect(style.fonts).toEqual({ latin: 'Times New Roman', eastAsian: '바탕' })
    expect(style.skeleton).toEqual([
      { slot: 'body', roles: style.roles.map((r) => r.id), required: true, repeat: true },
    ])
    expect(style).toMatchObject({ format: 'docx', id: META.id, title: META.title, version: 1 })
    expect(style.evidence.documents).toBe(2)
    expect(() => validateDocx(style as unknown as Record<string, unknown>)).not.toThrow()
  })

  it('derives heading roles from the body when there are no heading styles', async () => {
    const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:sz w:val="22"/></w:rPr></w:style></w:styles>`
    const style = await measureDocxStyle(await makeDocx([{ text: '본문' }], { styles }), META)
    const h = (n: number) => style.roles.find((r) => r.id === `heading-${n}`)!
    expect([h(1).size, h(2).size, h(3).size]).toEqual([17, 15, 13])
    expect(h(1).bold).toBe(true)
    expect(() => validateDocx(style as unknown as Record<string, unknown>)).not.toThrow()
  })
})
