import { describe, expect, it } from 'vitest'
import { maskPieces } from '../src/pieces'
import { maskXmlParagraphs, XML_FAMILIES, xmlParagraphTexts } from '../src/xml-text'

describe('maskPieces', () => {
  it('puts the placeholder in the first touched piece, empties the middle and keeps the tail in its own piece', () => {
    expect(maskPieces(['연락처 010-', '1234-', '5678 끝']).pieces).toEqual([
      '연락처 [전화번호]',
      '',
      ' 끝',
    ])
  })

  it('masks two numbers across pieces and leaves untouched pieces identical', () => {
    const out = maskPieces(['머리 ', 'a 010-1234-', '5678 b ', '중간', ' hong@', 'x.kr', ' 끝'])
    expect(out.pieces.join('')).toBe('머리 a [전화번호] b 중간 [이메일] 끝')
    expect(out.pieces[0]).toBe('머리 ')
    expect(out.pieces[3]).toBe('중간')
    expect(out.counts).toEqual({ phone: 1, email: 1 })
  })

  it('returns the same pieces when nothing matches', () => {
    const pieces = ['2026-10-28', ' 1,250,000원']
    expect(maskPieces(pieces).pieces).toEqual(pieces)
  })
})

describe('maskXmlParagraphs (docx)', () => {
  it('keeps run formatting and joins split runs', () => {
    const xml =
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>010-</w:t></w:r><w:r><w:t>1234-5678</w:t></w:r></w:p>'
    const out = maskXmlParagraphs(xml, XML_FAMILIES.docx)
    expect(out.xml).toContain('<w:rPr><w:b/></w:rPr>')
    expect(xmlParagraphTexts(out.xml, XML_FAMILIES.docx)).toEqual(['[전화번호]'])
    expect(out.xml).toContain('<w:t xml:space="preserve">[전화번호]</w:t>')
    expect(out.counts).toEqual({ phone: 1 })
  })

  it('decodes and re-escapes entities', () => {
    const xml = '<w:p><w:r><w:t>a&amp;b 010-1234-5678</w:t></w:r></w:p>'
    expect(maskXmlParagraphs(xml, XML_FAMILIES.docx).xml).toContain('a&amp;b [전화번호]')
  })

  it('masks tracked deletions and field instructions', () => {
    const xml =
      '<w:p><w:del><w:r><w:delText>010-1234-5678</w:delText></w:r></w:del>' +
      '<w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:hong@x.kr" </w:instrText></w:r></w:p>'
    const out = maskXmlParagraphs(xml, XML_FAMILIES.docx).xml
    expect(out).not.toContain('010-1234-5678')
    expect(out).not.toContain('hong@x.kr')
    expect(out).toContain('<w:delText')
    expect(out).toContain('mailto:[이메일]')
  })

  it('does not join digits across a tab run', () => {
    const xml =
      '<w:p><w:r><w:t>010-1234</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>-5678</w:t></w:r></w:p>'
    expect(maskXmlParagraphs(xml, XML_FAMILIES.docx).xml).toBe(xml)
  })

  it('returns the input string unchanged when nothing matches', () => {
    const xml = '<w:p><w:r><w:t>2026-10-28 회의</w:t></w:r></w:p>'
    expect(maskXmlParagraphs(xml, XML_FAMILIES.docx).xml).toBe(xml)
  })

  it('does not treat <w:tab/> or <w:tbl> as text elements', () => {
    const xml = '<w:p><w:r><w:tab/><w:t>010-1234-5678</w:t></w:r></w:p>'
    expect(maskXmlParagraphs(xml, XML_FAMILIES.docx).xml).toBe(
      '<w:p><w:r><w:tab/><w:t xml:space="preserve">[전화번호]</w:t></w:r></w:p>',
    )
  })
})

describe('maskXmlParagraphs (hwpx)', () => {
  it('keeps child elements inside hp:t, which split the text into pieces', () => {
    const broken = '<hp:p><hp:run><hp:t>010-1234<hp:tab/>-5678</hp:t></hp:run></hp:p>'
    // a tab between the parts means this is not one number
    expect(maskXmlParagraphs(broken, XML_FAMILIES.hwpx).xml).toBe(broken)

    const kept = '<hp:p><hp:run><hp:t>tel 010-1234-5678<hp:lineBreak/>x</hp:t></hp:run></hp:p>'
    const out = maskXmlParagraphs(kept, XML_FAMILIES.hwpx).xml
    expect(out).toContain('<hp:lineBreak/>')
    expect(out).toContain('tel [전화번호]')
    expect(out).not.toContain('010-1234-5678')
  })

  it('masks a table cell paragraph nested inside an outer paragraph without shifting the outer text', () => {
    const xml =
      '<hp:p id="1"><hp:run><hp:t>제목</hp:t><hp:tbl><hp:tr><hp:tc><hp:subList>' +
      '<hp:p id="2"><hp:run><hp:t>010-1234-</hp:t></hp:run><hp:run><hp:t>5678</hp:t></hp:run></hp:p>' +
      '</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run><hp:run><hp:t> 뒤</hp:t></hp:run></hp:p>'
    const out = maskXmlParagraphs(xml, XML_FAMILIES.hwpx)
    expect(xmlParagraphTexts(out.xml, XML_FAMILIES.hwpx)).toEqual(['제목 뒤', '[전화번호]'])
    expect(out.xml).toContain('<hp:t>제목</hp:t>')
    expect(out.xml).toContain('<hp:t> 뒤</hp:t>')
  })

  it('does not join numbers across a nested paragraph boundary', () => {
    // outer "010-1234-" and outer "5678" are separated by a whole nested table
    const xml =
      '<hp:p><hp:run><hp:t>010-1234-</hp:t><hp:tbl><hp:p><hp:run><hp:t>x</hp:t></hp:run></hp:p></hp:tbl>' +
      '<hp:t>5678</hp:t></hp:run></hp:p>'
    // the outer paragraph's own text is "010-1234-5678": it is masked as a whole
    const out = maskXmlParagraphs(xml, XML_FAMILIES.hwpx)
    expect(xmlParagraphTexts(out.xml, XML_FAMILIES.hwpx)).toEqual(['[전화번호]', 'x'])
  })
})

describe('maskXmlParagraphs (drawing, sheet)', () => {
  it('masks a:t in a:p', () => {
    const xml = '<a:p><a:r><a:rPr lang="ko-KR"/><a:t>hong@x.kr</a:t></a:r></a:p>'
    expect(maskXmlParagraphs(xml, XML_FAMILIES.drawing).xml).toContain('[이메일]')
  })

  it('masks rich shared strings', () => {
    const xml = '<si><r><t>010-</t></r><r><rPr><b/></rPr><t>1234-5678</t></r></si>'
    const out = maskXmlParagraphs(xml, XML_FAMILIES.sheet).xml
    expect(out).toContain('<rPr><b/></rPr>')
    expect(xmlParagraphTexts(out, XML_FAMILIES.sheet)).toEqual(['[전화번호]'])
  })

  it('does not confuse <t> with <tab> or with longer names', () => {
    const xml = '<si><t>a</t><tx>010-1234-5678</tx></si>'
    expect(maskXmlParagraphs(xml, XML_FAMILIES.sheet).xml).toBe(xml)
  })
})
