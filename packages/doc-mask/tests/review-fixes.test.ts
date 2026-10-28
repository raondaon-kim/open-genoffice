/** Inputs the whole-branch review proved, one describe per finding (Important 1–5, 8). */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { maskNumericCells } from '../src/formats/xlsx'
import { detectSensitive, maskDocument, maskText, verifyMasked } from '../src/index'
import { maskXmlParagraphs, XML_FAMILIES, xmlParagraphTexts } from '../src/xml-text'

const PHONE = '010-1234-5678'
const enc = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'))

async function pack(parts: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(parts)) zip.file(name, data)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
const partOf = async (bytes: Uint8Array, name: string) =>
  (await JSZip.loadAsync(bytes)).file(name)!.async('string')

describe('I1: a numeric cell never swallows the next cell', () => {
  it('a formula cell without a cached value keeps its formula', () => {
    const xml =
      '<row r="1"><c r="A1"><f>SUM(B1:B2)</f></c><c r="B1"><f>C1</f><v>9001011234567</v></c></row>'
    const out = maskNumericCells(xml).xml
    expect(out).toContain('<c r="A1"><f>SUM(B1:B2)</f></c>')
    expect(out).toContain('<c r="B1" t="inlineStr"><is><t>[주민번호]</t></is></c>')
  })

  it('is linear in the number of cells', () => {
    const xml = '<c r="A1"><f>SUM(B1:B2)</f></c>'.repeat(20000)
    const started = Date.now()
    maskNumericCells(xml)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('I2: a phone number right after its label is masked', () => {
  it.each([
    ['Tel010-1234-5678', 'Tel[전화번호]'],
    ['HP010-1234-5678', 'HP[전화번호]'],
    ['TEL02-123-4567', 'TEL[전화번호]'],
    ['Fax031-123-4567', 'Fax[전화번호]'],
    ['M.010-1234-5678', 'M.[전화번호]'],
  ])('%s', (input, expected) => {
    expect(maskText(input).text).toBe(expected)
  })

  it('identifiers glued to other letters stay', () => {
    expect(maskText('ID A1234-5678-9012-3456B').text).toBe('ID A1234-5678-9012-3456B')
    expect(maskText('{41C04592-2E84-4A1B-9C3D-123456789012}').text).toBe(
      '{41C04592-2E84-4A1B-9C3D-123456789012}',
    )
  })
})

describe('I3: comments and CDATA', () => {
  it('are masked', async () => {
    const out = await maskDocument(
      'a.docx',
      await pack({
        'word/document.xml': `<w:document><!-- ${PHONE} --><w:body/></w:document>`,
        'customXml/item1.xml': `<root><![CDATA[${PHONE}]]></root>`,
      }),
    )
    if (!out.ok) throw new Error(`${out.reason} ${out.part}`)
    expect(await partOf(out.bytes, 'word/document.xml')).toContain('<!-- [전화번호] -->')
    expect(await partOf(out.bytes, 'customXml/item1.xml')).toContain('<![CDATA[[전화번호]]]>')
  })

  it('are checked', async () => {
    const bytes = await pack({ 'customXml/item1.xml': `<root><![CDATA[${PHONE}]]></root>` })
    expect(await verifyMasked('docx', bytes)).toMatchObject({ ok: false, rule: 'phone' })
  })
})

describe('I4: Word characters inside a number', () => {
  it('a number written with non-breaking hyphens is masked and the hyphens go with it', () => {
    const run = (inner: string) => `<w:r>${inner}</w:r>`
    const xml =
      '<w:p>' +
      run('<w:t>220</w:t>') +
      run('<w:noBreakHyphen/>') +
      run('<w:t>81</w:t>') +
      run('<w:noBreakHyphen/>') +
      run('<w:t>62517</w:t>') +
      '</w:p>'
    const out = maskXmlParagraphs(xml, XML_FAMILIES.docx).xml
    expect(out).not.toContain('noBreakHyphen')
    expect(xmlParagraphTexts(out, XML_FAMILIES.docx)).toEqual(['[사업자번호]'])
  })

  it('a non-breaking hyphen elsewhere stays', () => {
    const xml =
      '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:t>B</w:t></w:r></w:p>'
    expect(maskXmlParagraphs(xml, XML_FAMILIES.docx).xml).toBe(xml)
  })

  it('a number in an equation is masked', () => {
    const xml =
      '<w:p><m:oMath><m:r><m:t>010-1234-</m:t></m:r><m:r><m:t>5678</m:t></m:r></m:oMath></w:p>'
    const out = maskXmlParagraphs(xml, XML_FAMILIES.docx).xml
    expect(xmlParagraphTexts(out, XML_FAMILIES.docx)).toEqual(['[전화번호]'])
  })
})

describe('I5: html and markdown numbers split by markup never pass', () => {
  it.each([
    ['a.html', '<p><b>010-</b>1234-5678</p>'],
    ['a.html', '<p>010&nbsp;1234&nbsp;5678</p>'],
    ['a.md', '**010**-1234-5678'],
    ['a.md', '연락처 _010_-1234-5678'],
  ])('%s %s', async (name, text) => {
    const out = await maskDocument(name, enc(text))
    expect(out.ok).toBe(false)
    expect(out).toMatchObject({ reason: 'residual' })
  })

  it('ordinary markup is untouched and passes', async () => {
    const out = await maskDocument('a.html', enc('<p><b>회의</b> 2026-10-28&nbsp;10:30</p>'))
    expect(out.ok).toBe(true)
  })
})

describe('I8: long inputs stay fast', () => {
  it('a long token without @ is not quadratic', () => {
    const text = 'a.b-c'.repeat(20000)
    const started = Date.now()
    maskText(text)
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('a large contact list is linear', () => {
    const rows = Array.from(
      { length: 40000 },
      (_, i) => `홍길동${i},010-${String(1000 + (i % 9000)).padStart(4, '0')}-5678`,
    )
    const started = Date.now()
    const found = detectSensitive(rows.join('\n'))
    expect(found).toHaveLength(40000)
    expect(Date.now() - started).toBeLessThan(2500)
  })
})
