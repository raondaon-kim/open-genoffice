import JSZip from 'jszip'

export interface FxPara {
  text: string
  style?: string
  bold?: boolean
  /** half-points */
  size?: number
  /** w:outlineLvl in the paragraph's own properties (0-based) */
  outline?: number
  /** wrap the run in a tracked insertion / deletion */
  tracked?: 'ins' | 'del'
  /** an inline picture after the text */
  image?: boolean
}
export interface FxTable {
  table: string[][]
}
export type FxBlock = FxPara | FxTable

export interface FxOptions {
  styles?: string
  header?: string
  comments?: boolean
  thumbnail?: boolean
  customXml?: boolean
  coreTitle?: string
  sectPr?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

export const DEFAULT_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="바탕"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="80" w:line="384" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="360" w:after="120" w:line="312" w:lineRule="auto"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="40"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="680" w:hanging="280"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
</w:styles>`

export const DEFAULT_SECTPR =
  '<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1417" w:bottom="850" w:left="1417" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'

function para(p: FxPara): string {
  const ppr: string[] = []
  if (p.style) ppr.push(`<w:pStyle w:val="${p.style}"/>`)
  if (p.outline !== undefined) ppr.push(`<w:outlineLvl w:val="${p.outline}"/>`)
  const rpr: string[] = []
  if (p.bold) rpr.push('<w:b/>')
  if (p.size) rpr.push(`<w:sz w:val="${p.size}"/>`)
  const rPr = rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : ''
  let run = `<w:r>${rPr}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r>`
  if (p.tracked === 'ins')
    run = `<w:ins w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z">${run}</w:ins>`
  if (p.tracked === 'del')
    run = `<w:del w:id="2" w:author="a" w:date="2026-01-01T00:00:00Z"><w:r>${rPr}<w:delText>${esc(p.text)}</w:delText></w:r></w:del>`
  const image = p.image
    ? '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="p"/></wp:inline></w:drawing></w:r>'
    : ''
  return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${run}${image}</w:p>`
}

function table(t: FxTable): string {
  const rows = t.table
    .map(
      (r) =>
        `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${esc(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`,
    )
    .join('')
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid/>${rows}</w:tbl>`
}

/** a small but complete Word package built in memory */
export async function makeDocx(blocks: FxBlock[], opts: FxOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  const body = blocks.map((b) => ('table' in b ? table(b) : para(b))).join('')
  const sectPr = opts.sectPr ?? DEFAULT_SECTPR
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}${sectPr}</w:body></w:document>`,
  )
  zip.file('word/styles.xml', opts.styles ?? DEFAULT_STYLES)
  const rels = [
    '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
  ]
  zip.file(
    'word/header1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${W}><w:p><w:r><w:t>${esc(opts.header ?? '')}</w:t></w:r></w:p></w:hdr>`,
  )
  const types = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
  ]
  if (opts.comments) {
    zip.file(
      'word/comments.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${W}><w:comment w:id="0" w:author="a"><w:p><w:r><w:t>검토 의견</w:t></w:r></w:p></w:comment></w:comments>`,
    )
    rels.push(
      '<Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
    )
    types.push(
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    )
  }
  const pkgRels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
  ]
  if (opts.thumbnail) {
    zip.file('docProps/thumbnail.jpeg', new Uint8Array([255, 216, 255, 217]))
    pkgRels.push(
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>',
    )
  }
  if (opts.customXml) {
    zip.file('customXml/item1.xml', '<root><v>인도네시아 보건</v></root>')
  }
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pkgRels.join('')}</Relationships>`,
  )
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(opts.coreTitle ?? '')}</dc:title><dc:creator>홍길동</dc:creator></cp:coreProperties>`,
  )
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>${types.join('')}</Types>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

/** the ODA-like proposal used across the tests: cover, three heading levels, list, table */
export const ODA_BLOCKS: FxBlock[] = [
  { text: '인도네시아 보건인력 관리체계 개선사업 PMC 용역', style: 'Title' },
  { text: '발주기관 : 한국국제협력단(KOICA) 동남아시아2팀' },
  { text: 'Ⅰ. 제안사 소개', style: 'Heading1' },
  { text: '본 장에서는 인도네시아 보건인력 관리체계 개선사업을 수행할 역량을 제시한다.' },
  { text: '1. 일반현황 및 연혁', style: 'Heading2' },
  { text: '1-1. 회사 일반현황', style: 'Heading3' },
  { text: '회사명 : 가나다컨설팅  대표자 : 김철수', style: 'ListParagraph' },
  { text: '주소 : 서울특별시 중구 세종대로 110', style: 'ListParagraph' },
  { text: '1-2. 과업대상지 분석', style: 'Heading3' },
  { text: '자카르타 보건소 인력은 2,300명으로 집계되었다.' },
  {
    table: [
      ['구분', '현황', '비고'],
      ['보건소', '312개', '자카르타'],
      ['인력', '2,300명', '2025년'],
    ],
  },
]
