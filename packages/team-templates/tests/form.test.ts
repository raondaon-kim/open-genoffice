import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { readDocxOutline } from '../src/docx-outline'
import { buildFormDocx, docxTexts, formHeadingTexts, setFormHeadings } from '../src/form'
import { makeDocx, ODA_BLOCKS } from './fixtures'

const part = async (bytes: Uint8Array, name: string) =>
  (await JSZip.loadAsync(bytes)).file(name)?.async('string') ?? null
const body = async (bytes: Uint8Array) => (await part(bytes, 'word/document.xml'))!

describe('buildFormDocx', () => {
  it('keeps headings, styles, sections and headers', async () => {
    const src = await makeDocx(ODA_BLOCKS, { header: '가나다컨설팅 제안서' })
    const form = await buildFormDocx(src)
    expect(await formHeadingTexts(form)).toEqual(
      (await readDocxOutline(src)).headings.map((h) => h.text),
    )
    expect(await part(form, 'word/styles.xml')).toBe(await part(src, 'word/styles.xml'))
    expect(await part(form, 'word/header1.xml')).toBe(await part(src, 'word/header1.xml'))
    expect(await body(form)).toContain('<w:pgMar w:top="1134"')
  })

  it('one empty slot paragraph per section in the body style', async () => {
    const form = await buildFormDocx(await makeDocx(ODA_BLOCKS))
    const xml = await body(form)
    const afterHeading = xml.split('1-1. 회사 일반현황')[1]!.split('1-2. 과업대상지 분석')[0]!
    const paragraphs = afterHeading.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []
    // the rest of the heading paragraph, then exactly one slot
    const slots = paragraphs.filter((p) => p.includes('ListParagraph'))
    expect(slots).toHaveLength(1)
    expect(slots[0]).not.toMatch(/<w:t[ >]/)
    const outline = await readDocxOutline(form)
    expect(outline.body).toEqual([])
  })

  it('tables keep the header row and one empty row', async () => {
    const form = await buildFormDocx(await makeDocx(ODA_BLOCKS))
    const outline = await readDocxOutline(form)
    expect(outline.tables[0]!.header).toEqual(['구분', '현황', '비고'])
    expect(outline.tables[0]!.rows).toBe(2)
    expect(outline.tableCells.every((c) => c === '')).toBe(true)
    expect(await body(form)).toContain('<w:tcW w:w="2000"')
  })

  it('cover values become [label] placeholders', async () => {
    const form = await buildFormDocx(await makeDocx(ODA_BLOCKS), {
      coverLabels: ['사업명', '발주기관'],
    })
    expect((await readDocxOutline(form)).cover).toEqual(['[사업명]', '[발주기관]'])
  })

  it('cover without labels is emptied', async () => {
    const form = await buildFormDocx(await makeDocx(ODA_BLOCKS))
    expect((await readDocxOutline(form)).cover).toEqual([])
  })

  it('removes comments, tracked changes, properties text, thumbnail, custom XML and body images', async () => {
    const src = await makeDocx(
      [
        { text: 'Ⅰ. 개요', style: 'Heading1' },
        { text: '삽입된 제목 부분', style: 'Heading2', tracked: 'ins' },
        { text: '지운 문장', tracked: 'del' },
        { text: '그림이 있는 문단', image: true },
      ],
      { comments: true, thumbnail: true, customXml: true, coreTitle: '인도네시아 보건 제안서' },
    )
    const form = await buildFormDocx(src)
    const zip = await JSZip.loadAsync(form)
    expect(zip.file('word/comments.xml')).toBeNull()
    expect(zip.file('docProps/thumbnail.jpeg')).toBeNull()
    expect(Object.keys(zip.files).some((n) => n.startsWith('customXml/'))).toBe(false)
    const xml = await body(form)
    expect(xml).not.toMatch(/<w:ins |<w:del |<w:drawing>|<w:delText/)
    expect(await part(form, 'word/_rels/document.xml.rels')).not.toContain('comments.xml')
    expect(await part(form, '_rels/.rels')).not.toContain('thumbnail')
    expect(await part(form, '[Content_Types].xml')).not.toContain('comments.xml')
    const core = (await part(form, 'docProps/core.xml'))!
    expect(core).not.toContain('인도네시아')
    expect(core).not.toContain('홍길동')
    // the heading that was a tracked insertion keeps its text
    expect(await formHeadingTexts(form)).toEqual(['Ⅰ. 개요', '삽입된 제목 부분'])
  })

  it('generalizes header and footer text when asked', async () => {
    const form = await buildFormDocx(
      await makeDocx(ODA_BLOCKS, { header: '가나다컨설팅 제안서' }),
      {
        headerFooter: { 'word/header1.xml': '[제안사] 제안서' },
      },
    )
    expect(await part(form, 'word/header1.xml')).toContain('[제안사] 제안서')
    expect(await part(form, 'word/header1.xml')).not.toContain('가나다컨설팅')
  })
})

describe('setFormHeadings', () => {
  it('replaces heading texts in order', async () => {
    const form = await buildFormDocx(await makeDocx(ODA_BLOCKS))
    const names = (await formHeadingTexts(form)).map((t, i) =>
      i === 4 ? '1-2. 사업대상지 분석' : t,
    )
    const renamed = await setFormHeadings(form, names)
    expect(await formHeadingTexts(renamed)).toEqual(names)
  })

  it('throws when the count differs', async () => {
    const form = await buildFormDocx(await makeDocx(ODA_BLOCKS))
    await expect(setFormHeadings(form, ['하나'])).rejects.toThrow('heading count differs')
  })
})

describe('docxTexts', () => {
  it('lists paragraph texts of the body and headers', async () => {
    const texts = await docxTexts(await makeDocx(ODA_BLOCKS, { header: '머리글 문구' }))
    expect(texts).toContain('자카르타 보건소 인력은 2,300명으로 집계되었다.')
    expect(texts).toContain('머리글 문구')
  })
})

describe('headerFooterTexts', () => {
  it('maps each header/footer part to its text', async () => {
    const { headerFooterTexts } = await import('../src/form')
    expect(await headerFooterTexts(await makeDocx(ODA_BLOCKS, { header: '가나다컨설팅 제안서' }))).toEqual({
      'word/header1.xml': '가나다컨설팅 제안서',
    })
  })
})
