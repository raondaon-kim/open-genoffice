import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { readDocxOutline } from '../src/docx-outline'
import { buildFormDocx, packageTexts, validateDocxXml } from '../src/form'
import { normalizeHeading } from '../src/normalize'
import { templateForRun } from '../src/run-view'
import { sourceWordsHits } from '../src/source-words'
import type { TemplateDef } from '../src/template-md'
import { makeDocx, type FxBlock } from './fixtures'

const part = async (bytes: Uint8Array, name: string) =>
  (await JSZip.loadAsync(bytes)).file(name)?.async('string') ?? null
const all = async (bytes: Uint8Array) => (await packageTexts(bytes)).join('\n')

const VML_TEXTBOX = `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent><w:p><w:r><w:t>상자 속 원본 문장 인도네시아</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r><w:r><w:t>뒤에 남은 원본 문장</w:t></w:r></w:p>`
const DML_TEXTBOX = `<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps"><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wps:txbx xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:txbxContent><w:p><w:r><w:t>도형 속 자카르타 문장</w:t></w:r></w:p></w:txbxContent></wps:txbx></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r></w:p>`
const PPR_CHANGE = `<w:p><w:pPr><w:jc w:val="both"/><w:pPrChange w:id="5" w:author="홍길동" w:date="2026-01-01T00:00:00Z"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t>서식이 바뀐 원본 문장</w:t></w:r></w:p>`

describe('review fixes: well-formed forms', () => {
  it('text boxes in the cover and body do not break the form or leave source text', async () => {
    const blocks: FxBlock[] = [
      { raw: VML_TEXTBOX },
      { text: 'Ⅰ. 개요', style: 'Heading1' },
      { raw: DML_TEXTBOX },
      { text: '본문 문장' },
    ]
    const form = await buildFormDocx(await makeDocx(blocks))
    expect(await validateDocxXml(form)).toBeNull()
    const text = await all(form)
    expect(text).not.toMatch(/상자 속|뒤에 남은|자카르타/)
    expect((await readDocxOutline(form)).headings.map((h) => h.text)).toEqual(['Ⅰ. 개요'])
  })

  it('a tracked formatting change in a body paragraph leaves a well-formed form without it', async () => {
    const form = await buildFormDocx(
      await makeDocx([{ text: 'Ⅰ. 개요', style: 'Heading1' }, { raw: PPR_CHANGE }]),
    )
    expect(await validateDocxXml(form)).toBeNull()
    const xml = (await part(form, 'word/document.xml'))!
    expect(xml).not.toContain('pPrChange')
    expect(xml).not.toContain('홍길동')
  })

  it('validateDocxXml names a broken part', async () => {
    const zip = await JSZip.loadAsync(await makeDocx([{ text: 'x' }]))
    zip.file('word/document.xml', '<w:document><w:body><w:p></w:body></w:document>')
    expect(
      await validateDocxXml(new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))),
    ).toBe('word/document.xml')
  })

  it('a heading run with attributes that holds a picture loses the picture', async () => {
    const heading = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r w:rsidR="00A1"><w:t>Ⅰ. 개요</w:t></w:r><w:r w:rsidR="00A2"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="9" name="로고"/></wp:inline></w:drawing></w:r></w:p>`
    const form = await buildFormDocx(await makeDocx([{ raw: heading }, { text: '본문' }]))
    expect(await part(form, 'word/document.xml')).not.toContain('<w:drawing>')
  })
})

describe('review fixes: no source content in other carriers', () => {
  it('a first row that does not look like a header is emptied', async () => {
    const form = await buildFormDocx(
      await makeDocx([
        { text: 'Ⅰ. 개요', style: 'Heading1' },
        {
          table: [
            ['사업명', '인도네시아 보건인력 역량강화 사업'],
            ['기간', '2026'],
          ],
          header: 'plain',
        },
        {
          table: [
            ['구분', '내용'],
            ['a', 'b'],
          ],
          header: 'bold',
        },
        {
          table: [
            ['구분', '내용'],
            ['a', 'b'],
          ],
          header: 'tblHeader',
        },
        { table: [['한 줄 표', '인도네시아 보건 사업']], header: 'bold' },
        {
          table: [
            ['구분', '이 칸은 머리행이라기에는 너무 긴 문장이라서 데이터로 본다'],
            ['a', 'b'],
          ],
          header: 'bold',
        },
      ]),
    )
    const headers = (await readDocxOutline(form)).tables.map((t) => t.header.join('|'))
    expect(headers).toEqual(['|', '구분|내용', '구분|내용', '|', '|'])
    expect(await all(form)).not.toContain('인도네시아')
  })

  it('charts, embeddings and the glossary go; titles of parts are emptied', async () => {
    const form = await buildFormDocx(
      await makeDocx([{ text: 'Ⅰ. 개요', style: 'Heading1' }, { text: '본문' }], {
        chart: true,
        glossary: true,
        appTitles: ['인도네시아 보건 제안서'],
      }),
    )
    const zip = await JSZip.loadAsync(form)
    const names = Object.keys(zip.files)
    expect(
      names.some((n) => n.startsWith('word/charts/') || n.startsWith('word/embeddings/')),
    ).toBe(false)
    expect(names.some((n) => n.startsWith('word/glossary/'))).toBe(false)
    expect(await part(form, 'word/_rels/document.xml.rels')).not.toMatch(/chart|glossary/)
    const text = await all(form)
    expect(text).not.toMatch(/자카르타|인도네시아|상용구|가나다컨설팅/)
    expect(await validateDocxXml(form)).toBeNull()
  })

  it('packageTexts reads every XML part, charts included', async () => {
    const text = await all(await makeDocx([{ text: '본문' }], { chart: true }))
    expect(text).toContain('자카르타 보건소 인력 2300명')
  })

  it('header and footer text the AI did not generalize is emptied', async () => {
    const form = await buildFormDocx(
      await makeDocx([{ text: 'Ⅰ. 개요', style: 'Heading1' }], {
        header: '가나다컨설팅 인도네시아 제안서',
      }),
    )
    expect(await part(form, 'word/header1.xml')).not.toContain('가나다컨설팅')
  })
})

describe('review fixes: the gate exempts form text only where it is not content', () => {
  it('grams that also occur in cover values or table values are never exempt', () => {
    const source = ['인도네시아 보건인력 역량강화 사업']
    const allowed = ['1-2. 인도네시아 보건인력 현황']
    const candidates = [
      '- 1-2. 사업대상지 현황 — 인도네시아 보건인력 현황을 표로 정리',
      '- 용도: 인도네시아 보건인력 사업 제안',
    ]
    expect(sourceWordsHits(source, candidates, 8, allowed)).toEqual([])
    expect(sourceWordsHits(source, candidates, 8, allowed, source)).toEqual(candidates)
  })
})

describe('review fixes: the writer sees every heading', () => {
  it('normalizeHeading lives in a module without Node imports', () => {
    expect(normalizeHeading('Ⅱ-1. 사업이해도 (10점)')).toBe('사업이해도')
  })

  it('templateForRun lists every outline heading in order', () => {
    const def = {
      title: 't',
      purpose: '',
      notes: '',
      materials: [],
      wikiPages: [],
      outline: [
        { level: 1, heading: 'Ⅰ. 소개', guidance: '' },
        { level: 2, heading: '1. 개요', guidance: '' },
      ],
    } as unknown as TemplateDef
    expect(templateForRun(def, []).headings).toEqual(['Ⅰ. 소개', '1. 개요'])
  })
})

describe('review fixes: body-level content controls', () => {
  it('a cover page in a w:sdt keeps its shape but not its text', async () => {
    const sdt =
      '<w:sdt><w:sdtPr><w:alias w:val="표지"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>인도네시아 보건인력 사업 표지</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    const form = await buildFormDocx(
      await makeDocx([{ raw: sdt }, { text: 'Ⅰ. 개요', style: 'Heading1' }]),
    )
    const xml = (await part(form, 'word/document.xml'))!
    expect(xml).toContain('<w:sdt>')
    expect(xml).not.toContain('인도네시아')
    expect(await validateDocxXml(form)).toBeNull()
  })
})

describe('review fixes: strict texts', () => {
  it('cover and table values, minus lines that repeat a heading', async () => {
    const { strictContentTexts } = await import('../src/source-words')
    expect(
      strictContentTexts({
        headings: [{ level: 2, text: '2. 과업 세부실행방안', styled: true, index: 3 }],
        tables: [],
        body: ['본문'],
        cover: ['경기도 광역 도시생태현황지도 제작 용역', '2. 과업 세부실행방안'],
        tableCells: ['과업 세부실행방안', '25'],
        certain: true,
      }),
    ).toEqual(['경기도 광역 도시생태현황지도 제작 용역', '25'])
  })
})
