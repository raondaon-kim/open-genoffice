import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { maskDocx } from '../src/formats/docx'
import { maskPptx } from '../src/formats/pptx'
import { readPackage } from '../src/zip'

const PHONE = '010-1234-5678'

async function pack(parts: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(parts)) zip.file(name, data)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function partsOf(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return Object.fromEntries((await readPackage(bytes)).map((e) => [e.name, e.data]))
}

const text = (d: Uint8Array | undefined) => (d ? Buffer.from(d).toString('utf8') : '')

const CONTENT_TYPES =
  '<Types><Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/docProps/thumbnail.jpeg" ContentType="image/jpeg"/></Types>'
const ROOT_RELS =
  '<Relationships><Relationship Id="rId1" Type="officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>'

const para = (s: string) => `<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`

describe('maskDocx', () => {
  it('masks every Word part that holds text', async () => {
    const parts: Record<string, string> = {
      '[Content_Types].xml': CONTENT_TYPES,
      '_rels/.rels': ROOT_RELS,
      'word/document.xml': `<w:document><w:body>${para(PHONE)}</w:body></w:document>`,
      'word/header1.xml': `<w:hdr>${para(PHONE)}</w:hdr>`,
      'word/footer1.xml': `<w:ftr>${para(PHONE)}</w:ftr>`,
      'word/footnotes.xml': `<w:footnotes><w:footnote>${para(PHONE)}</w:footnote></w:footnotes>`,
      'word/endnotes.xml': `<w:endnotes><w:endnote>${para(PHONE)}</w:endnote></w:endnotes>`,
      'word/comments.xml': `<w:comments><w:comment>${para(PHONE)}</w:comment></w:comments>`,
      'word/glossary/document.xml': `<w:glossaryDocument>${para(PHONE)}</w:glossaryDocument>`,
      'customXml/item1.xml': `<root><phone>${PHONE}</phone></root>`,
      'docProps/core.xml': `<cp:coreProperties><dc:title>연락처 ${PHONE}</dc:title></cp:coreProperties>`,
      'docProps/app.xml': `<Properties><Company>${PHONE}</Company></Properties>`,
      'docProps/custom.xml': `<Properties><property><vt:lpwstr>${PHONE}</vt:lpwstr></property></Properties>`,
    }
    const out = await maskDocx(
      await pack({ ...parts, 'docProps/thumbnail.jpeg': new Uint8Array([0xff, 0xd8]) }),
    )
    if ('encrypted' in out) throw new Error('unexpected')
    const masked = await partsOf(out.bytes)
    for (const name of Object.keys(parts)) expect(text(masked[name]), name).not.toContain(PHONE)
    expect(text(masked['word/document.xml'])).toContain('[전화번호]')
  })

  it('masks a number split across runs inside a hyperlink, and the mailto target', async () => {
    const doc =
      '<w:document><w:body><w:p><w:hyperlink r:id="rId9"><w:r><w:t>010-</w:t></w:r>' +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>1234-5678</w:t></w:r></w:hyperlink></w:p></w:body></w:document>'
    const rels =
      '<Relationships><Relationship Id="rId9" Type="hyperlink" Target="mailto:hong@x.kr" TargetMode="External"/></Relationships>'
    const out = await maskDocx(
      await pack({ 'word/document.xml': doc, 'word/_rels/document.xml.rels': rels }),
    )
    if ('encrypted' in out) throw new Error('unexpected')
    const masked = await partsOf(out.bytes)
    expect(text(masked['word/document.xml'])).toContain('[전화번호]')
    expect(text(masked['word/document.xml'])).toContain('<w:rPr><w:i/></w:rPr>')
    expect(text(masked['word/_rels/document.xml.rels'])).toContain('Target="mailto:[이메일]"')
  })

  it('masks chart caches and an embedded workbook', async () => {
    const inner = await pack({ 'xl/sharedStrings.xml': `<sst><si><t>${PHONE}</t></si></sst>` })
    const out = await maskDocx(
      await pack({
        'word/document.xml': `<w:document><w:body>${para('표')}</w:body></w:document>`,
        'word/charts/chart1.xml': `<c:chartSpace><c:strCache><c:pt><c:v>${PHONE}</c:v></c:pt></c:strCache></c:chartSpace>`,
        'word/embeddings/Microsoft_Excel_Worksheet.xlsx': inner,
      }),
    )
    if ('encrypted' in out) throw new Error('unexpected')
    const masked = await partsOf(out.bytes)
    expect(text(masked['word/charts/chart1.xml'])).not.toContain(PHONE)
    const embedded = await partsOf(masked['word/embeddings/Microsoft_Excel_Worksheet.xlsx'])
    expect(text(embedded['xl/sharedStrings.xml'])).toContain('[전화번호]')
  })

  it('removes the preview thumbnail with its relationship and content-type override', async () => {
    const out = await maskDocx(
      await pack({
        '[Content_Types].xml': CONTENT_TYPES,
        '_rels/.rels': ROOT_RELS,
        'word/document.xml': `<w:document><w:body>${para('x')}</w:body></w:document>`,
        'docProps/thumbnail.jpeg': new Uint8Array([0xff, 0xd8, 0xff]),
      }),
    )
    if ('encrypted' in out) throw new Error('unexpected')
    const masked = await partsOf(out.bytes)
    expect(masked['docProps/thumbnail.jpeg']).toBeUndefined()
    expect(text(masked['_rels/.rels'])).not.toContain('thumbnail')
    expect(text(masked['_rels/.rels'])).toContain('word/document.xml')
    expect(text(masked['[Content_Types].xml'])).not.toContain('thumbnail')
  })

  it('reports a password-protected (OLE) file as encrypted', async () => {
    const cfb = new Uint8Array(512)
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(await maskDocx(cfb)).toEqual({ encrypted: true })
  })
})

describe('maskPptx', () => {
  const sp = (s: string) =>
    `<p:sp><p:txBody><a:p><a:r><a:t>${s}</a:t></a:r></a:p></p:txBody></p:sp>`

  it('masks slides, notes, layouts, masters, comments, diagrams, charts and embedded workbooks', async () => {
    const inner = await pack({ 'xl/sharedStrings.xml': `<sst><si><t>${PHONE}</t></si></sst>` })
    const parts: Record<string, string> = {
      '[Content_Types].xml': CONTENT_TYPES,
      '_rels/.rels': ROOT_RELS.replace('word/document.xml', 'ppt/presentation.xml'),
      'ppt/slides/slide1.xml': `<p:sld>${sp('010-')}${sp('x')}<p:sp><p:txBody><a:p><a:r><a:t>010-1234-</a:t></a:r><a:r><a:t>5678</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`,
      'ppt/notesSlides/notesSlide1.xml': `<p:notes>${sp(PHONE)}</p:notes>`,
      'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout>${sp(PHONE)}</p:sldLayout>`,
      'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster>${sp(PHONE)}</p:sldMaster>`,
      'ppt/notesMasters/notesMaster1.xml': `<p:notesMaster>${sp(PHONE)}</p:notesMaster>`,
      'ppt/comments/comment1.xml': `<p:cmLst><p:cm><p:text>${PHONE}</p:text></p:cm></p:cmLst>`,
      'ppt/diagrams/data1.xml': `<dgm:dataModel><dgm:t><a:p><a:r><a:t>${PHONE}</a:t></a:r></a:p></dgm:t></dgm:dataModel>`,
      'ppt/charts/chart1.xml': `<c:chartSpace><c:v>${PHONE}</c:v></c:chartSpace>`,
    }
    const out = await maskPptx(
      await pack({
        ...parts,
        'ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx': inner,
        'docProps/thumbnail.jpeg': new Uint8Array([0xff, 0xd8]),
      }),
    )
    const masked = await partsOf(out.bytes)
    for (const name of Object.keys(parts)) expect(text(masked[name]), name).not.toContain(PHONE)
    expect(text(masked['ppt/slides/slide1.xml'])).toContain('[전화번호]')
    expect(text(masked['ppt/slides/slide1.xml'])).toContain('<a:t>010-</a:t>')
    const embedded = await partsOf(masked['ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'])
    expect(text(embedded['xl/sharedStrings.xml'])).toContain('[전화번호]')
    expect(masked['docProps/thumbnail.jpeg']).toBeUndefined()
  })
})
