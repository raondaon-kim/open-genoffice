import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { maskXlsx } from '../src/formats/xlsx'
import { readPackage, writePackage } from '../src/zip'

const PHONE = '010-1234-5678'

async function workbook(parts: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(parts)) zip.file(name, data)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function partsOf(bytes: Uint8Array): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of await readPackage(bytes)) out[e.name] = Buffer.from(e.data).toString('utf8')
  return out
}

describe('package io', () => {
  it('round-trips entry names and order', async () => {
    const bytes = await workbook({ 'b.xml': '<b/>', 'a.xml': '<a/>', 'c/d.xml': '<d/>' })
    const entries = await readPackage(bytes)
    expect(entries.map((e) => e.name)).toEqual(['b.xml', 'a.xml', 'c/d.xml'])
    const again = await readPackage(await writePackage(entries))
    expect(again.map((e) => e.name)).toEqual(['b.xml', 'a.xml', 'c/d.xml'])
  })

  it('writes mimetype first and stored', async () => {
    const out = await writePackage([
      { name: 'Contents/section0.xml', data: Buffer.from('<x/>') },
      { name: 'mimetype', data: Buffer.from('application/hwp+zip') },
    ])
    const buf = Buffer.from(out)
    // first local header: name at offset 30, compression method at offset 8
    expect(buf.readUInt32LE(0)).toBe(0x04034b50)
    expect(buf.readUInt16LE(8)).toBe(0)
    expect(buf.subarray(30, 38).toString()).toBe('mimetype')
  })
})

describe('maskXlsx', () => {
  const SHEET = (cells: string) =>
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row></sheetData>` +
    `<dataValidations count="1"><dataValidation type="list" sqref="C1"><formula1>"${PHONE}"</formula1></dataValidation></dataValidations>` +
    `<headerFooter><oddHeader>&amp;C담당 ${PHONE}</oddHeader></headerFooter></worksheet>`

  it('masks plain and rich shared strings and keeps run formatting', async () => {
    const bytes = await workbook({
      'xl/sharedStrings.xml':
        `<sst><si><t>${PHONE}</t></si><si><r><t>010-</t></r><r><rPr><b/></rPr><t>1234-5678</t></r></si>` +
        '<si><t>2026-10-28</t></si></sst>',
    })
    const parts = await partsOf((await maskXlsx(bytes)).bytes)
    const sst = parts['xl/sharedStrings.xml']
    expect(sst).not.toMatch(/1234/)
    expect(sst).toContain('<rPr><b/></rPr>')
    expect(sst).toContain('2026-10-28')
    expect(sst.match(/\[전화번호\]/g)).toHaveLength(2)
  })

  it('masks inline strings, numeric cells holding a number, formulas, validation and header text', async () => {
    const bytes = await workbook({
      'xl/worksheets/sheet1.xml': SHEET(
        '<c r="A1" t="inlineStr"><is><t>hong@x.kr</t></is></c>' +
          '<c r="B1" s="3"><v>9001011234567</v></c>' +
          '<c r="C1"><v>1250000</v></c>' +
          `<c r="D1" t="str"><f>"tel ${PHONE}"</f><v>tel ${PHONE}</v></c>`,
      ),
    })
    const { bytes: out, counts } = await maskXlsx(bytes)
    const sheet = (await partsOf(out))['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('<is><t xml:space="preserve">[이메일]</t></is>')
    expect(sheet).toContain('<c r="B1" s="3" t="inlineStr"><is><t>[주민번호]</t></is></c>')
    expect(sheet).toContain('<c r="C1"><v>1250000</v></c>')
    expect(sheet).not.toContain(PHONE)
    expect(sheet).toContain('<formula1>"[전화번호]"</formula1>')
    expect(sheet).toContain('&amp;C담당 [전화번호]')
    expect(counts.rrn).toBe(1)
  })

  it('masks comments, defined names, pivot caches and chart strings', async () => {
    const bytes = await workbook({
      'xl/comments1.xml': `<comments><commentList><comment ref="A1"><text><r><t>연락 ${PHONE}</t></r></text></comment></commentList></comments>`,
      'xl/workbook.xml': `<workbook><definedNames><definedName name="tel">"${PHONE}"</definedName></definedNames></workbook>`,
      'xl/pivotCache/pivotCacheRecords1.xml': `<pivotCacheRecords><r><s v="${PHONE}"/><n v="3"/></r></pivotCacheRecords>`,
      'xl/charts/chart1.xml': `<c:chartSpace><c:strCache><c:pt idx="0"><c:v>${PHONE}</c:v></c:pt></c:strCache></c:chartSpace>`,
    })
    const parts = await partsOf((await maskXlsx(bytes)).bytes)
    for (const [name, xml] of Object.entries(parts)) {
      expect(xml, name).not.toContain(PHONE)
    }
    expect(parts['xl/pivotCache/pivotCacheRecords1.xml']).toContain('<s v="[전화번호]"/>')
  })

  it('leaves parts without numbers byte-identical', async () => {
    const styles =
      '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts></styleSheet>'
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const bytes = await workbook({ 'xl/styles.xml': styles, 'xl/media/image1.png': png })
    const out = await readPackage((await maskXlsx(bytes)).bytes)
    const byName = Object.fromEntries(out.map((e) => [e.name, e.data]))
    expect(Buffer.from(byName['xl/styles.xml']).toString()).toBe(styles)
    expect([...byName['xl/media/image1.png']]).toEqual([...png])
  })
})
