import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { formatOf, maskDocument, maskFileName, maskText, verifyMasked } from '../src/index'

const PHONE = '010-1234-5678'
const enc = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'))
const dec = (b: Uint8Array) => Buffer.from(b).toString('utf8')

async function pack(parts: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(parts)) zip.file(name, data)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const DOCX = (body: string, extra: Record<string, string | Uint8Array> = {}) =>
  pack({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`,
    ...extra,
  })

describe('formatOf', () => {
  it.each([
    ['a.docx', 'docx'],
    ['A.HWPX', 'hwpx'],
    ['a.pptx', 'pptx'],
    ['a.xlsx', 'xlsx'],
    ['a.csv', 'csv'],
    ['a.tsv', 'tsv'],
    ['a.md', 'md'],
    ['a.markdown', 'md'],
    ['a.txt', 'txt'],
    ['a.html', 'html'],
    ['a.htm', 'html'],
    ['a.hwp', null],
    ['a.pdf', null],
    ['a.xlsm', null],
    ['a.xls', null],
    ['a.json', null],
  ])('%s → %s', (name, format) => {
    expect(formatOf(name)).toBe(format)
  })
})

describe('text formats', () => {
  it('masks csv, md and txt as whole text and keeps a UTF-8 BOM', async () => {
    const csv = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(`이름,전화\n홍길동,${PHONE}\n`)])
    const out = await maskDocument('명단.csv', csv)
    if (!out.ok) throw new Error(out.reason)
    expect([...out.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(dec(out.bytes.slice(3))).toBe('이름,전화\n홍길동,[전화번호]\n')
    for (const name of ['a.md', 'a.txt', 'a.tsv']) {
      const r = await maskDocument(name, enc(`연락 ${PHONE}`))
      expect(r.ok && dec(r.bytes)).toBe('연락 [전화번호]')
    }
  })

  it('masks html text and attribute values but not tags', async () => {
    const html = `<p class="a">전화 <a href="tel:${PHONE.replace(/-/g, '')}">${PHONE}</a> <a href="mailto:hong@x.kr">메일</a></p>`
    const out = await maskDocument('a.html', enc(html))
    if (!out.ok) throw new Error(out.reason)
    expect(dec(out.bytes)).toBe(
      '<p class="a">전화 <a href="tel:[전화번호]">[전화번호]</a> <a href="mailto:[이메일]">메일</a></p>',
    )
  })
})

describe('maskFileName', () => {
  it('masks the base name and keeps the extension', () => {
    expect(maskFileName(`홍길동 ${PHONE} 이력서.docx`)).toBe('홍길동 [전화번호] 이력서.docx')
    expect(maskFileName('보고서.hwpx')).toBe('보고서.hwpx')
  })
})

describe('verifyMasked', () => {
  it('finds a number in a part no masker knows', async () => {
    const bytes = await DOCX('x', { 'word/unknownPart.xml': `<x>${PHONE}</x>` })
    expect(await verifyMasked('docx', bytes)).toEqual({
      ok: false,
      part: 'word/unknownPart.xml',
      rule: 'phone',
    })
  })

  it('finds a number in an attribute value', async () => {
    const bytes = await DOCX('x', { 'word/odd.xml': `<x v="${PHONE}"/>` })
    expect(await verifyMasked('docx', bytes)).toMatchObject({ ok: false, part: 'word/odd.xml' })
  })

  it('finds UTF-16LE text in a binary part and skips images', async () => {
    const utf16 = new Uint8Array(Buffer.from(`ole ${PHONE}`, 'utf16le'))
    expect(
      await verifyMasked('docx', await DOCX('x', { 'word/embeddings/oleObject1.bin': utf16 })),
    ).toMatchObject({
      ok: false,
      part: 'word/embeddings/oleObject1.bin',
    })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...enc(PHONE)])
    expect(await verifyMasked('docx', await DOCX('x', { 'word/media/image1.png': png }))).toEqual({
      ok: true,
    })
  })

  it('finds a number split across runs', async () => {
    const bytes = await pack({
      'word/document.xml': '<w:p><w:r><w:t>010-</w:t></w:r><w:r><w:t>1234-5678</w:t></w:r></w:p>',
    })
    expect(await verifyMasked('docx', bytes)).toMatchObject({
      ok: false,
      part: 'word/document.xml',
    })
  })
})

describe('maskDocument', () => {
  it('never returns ok when a number survives masking', async () => {
    // a number left where the masker cannot reach (an EMF preview of an embedded object)
    const emf = new Uint8Array(Buffer.from(`x ${PHONE}`, 'utf16le'))
    const out = await maskDocument('a.docx', await DOCX(PHONE, { 'word/media/image1.emf': emf }))
    expect(out).toEqual({
      ok: false,
      reason: 'residual',
      part: 'word/media/image1.emf',
      rule: 'phone',
    })
  })

  it('reports encrypted, unparsable and unsupported files', async () => {
    const cfb = new Uint8Array(512)
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(await maskDocument('a.docx', cfb)).toEqual({ ok: false, reason: 'encrypted' })
    expect(await maskDocument('a.docx', enc('not a zip at all'))).toEqual({
      ok: false,
      reason: 'parse',
    })
    for (const name of ['a.hwp', 'a.pdf', 'a.xlsm', 'a.xls', 'a.json']) {
      expect(await maskDocument(name, enc('x'))).toEqual({ ok: false, reason: 'unsupported' })
    }
  })

  it.each([
    ['a.docx', () => DOCX(`연락 ${PHONE}`)],
    [
      'a.pptx',
      () =>
        pack({
          'ppt/slides/slide1.xml': `<p:sld><a:p><a:r><a:t>${PHONE}</a:t></a:r></a:p></p:sld>`,
        }),
    ],
    ['a.xlsx', () => pack({ 'xl/sharedStrings.xml': `<sst><si><t>${PHONE}</t></si></sst>` })],
    [
      'a.hwpx',
      () =>
        pack({
          mimetype: 'application/hwp+zip',
          'Contents/section0.xml': `<hs:sec><hp:p><hp:run><hp:t>${PHONE}</hp:t></hp:run></hp:p></hs:sec>`,
        }),
    ],
  ])('%s comes back masked and verified', async (name, make) => {
    const out = await maskDocument(name, await make())
    if (!out.ok) throw new Error(`${out.reason} ${out.part ?? ''}`)
    expect(out.counts.phone).toBe(1)
    expect(await verifyMasked(formatOf(name)!, out.bytes)).toEqual({ ok: true })
  })
})

describe('embedded content the masker cannot open never leaves (review C1)', () => {
  const opaque = new Uint8Array([0x01, 0x02, 0x03, 0xfe, 0x00, 0x7f, 0x10, 0x20])
  const oleHeader = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])

  it.each([
    [
      'an OLE object in a docx',
      'a.docx',
      () => DOCX('x', { 'word/embeddings/oleObject1.bin': oleHeader }),
    ],
    [
      'opaque bytes in a docx',
      'a.docx',
      () => DOCX('x', { 'word/embeddings/oleObject2.bin': opaque }),
    ],
    [
      'an embedded macro document in a pptx',
      'a.pptx',
      async () =>
        pack({ 'ppt/slides/slide1.xml': '<p:sld/>', 'ppt/embeddings/Doc1.docm': await DOCX('x') }),
    ],
    [
      'an embedded zip in an xlsx',
      'a.xlsx',
      async () =>
        pack({ 'xl/sharedStrings.xml': '<sst/>', 'xl/embeddings/files.zip': await DOCX('x') }),
    ],
    [
      'an OLE object in an hwpx',
      'a.hwpx',
      () =>
        pack({
          mimetype: 'application/hwp+zip',
          'Contents/section0.xml': '<hs:sec/>',
          'BinData/ole1.ole': oleHeader,
        }),
    ],
  ])('%s', async (_label, name, make) => {
    const out = await maskDocument(name, await make())
    expect(out.ok).toBe(false)
    expect(out).toMatchObject({ reason: 'embedded' })
  })

  it('printer settings and an embedded workbook are fine', async () => {
    const inner = await pack({ 'xl/sharedStrings.xml': `<sst><si><t>${PHONE}</t></si></sst>` })
    const out = await maskDocument(
      'a.pptx',
      await pack({
        'ppt/slides/slide1.xml': '<p:sld/>',
        'ppt/printerSettings/printerSettings1.bin': opaque,
        'ppt/embeddings/Microsoft_Excel_Worksheet.xlsx': inner,
      }),
    )
    expect(out.ok).toBe(true)
  })
})

describe('decimal values are not identification numbers (review C2)', () => {
  it.each(['45.0101011234567', '4679.3538869297408', '0.9001011234567', '12,9001011234567.5'])(
    '%s',
    (value) => {
      expect(maskText(value).text).toBe(value)
    },
  )

  it('a number at the end of a sentence is still masked', () => {
    expect(maskText('연락처는 010-1234-5678.').text).toBe('연락처는 [전화번호].')
  })

  it('computed doubles in a workbook stay numbers', async () => {
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1"><v>45.0101011234567</v></c>' +
      '<c r="B1"><v>4679.3538869297408</v></c></row></sheetData></worksheet>'
    const out = await maskDocument('a.xlsx', await pack({ 'xl/worksheets/sheet1.xml': sheet }))
    if (!out.ok) throw new Error(out.reason)
    const zip = await JSZip.loadAsync(out.bytes)
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toBe(sheet)
  })

  it('a number in a numeric-only slot is refused rather than turned into text', async () => {
    const out = await maskDocument(
      'a.xlsx',
      await pack({
        'xl/pivotCache/pivotCacheRecords1.xml':
          '<pivotCacheRecords><r><n v="9001011234567"/></r></pivotCacheRecords>',
      }),
    )
    expect(out).toMatchObject({ ok: false, reason: 'residual' })
  })
})
