import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { maskHwpx } from '../src/formats/hwpx'
import { readPackage } from '../src/zip'
import { XML_FAMILIES, xmlParagraphTexts } from '../src/xml-text'

const PHONE = '010-1234-5678'
const run = (s: string) => `<hp:run charPrIDRef="0"><hp:t>${s}</hp:t></hp:run>`
const p = (inner: string) => `<hp:p id="0" paraPrIDRef="0" styleIDRef="0">${inner}</hp:p>`

function section(body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
    `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`
  )
}

async function hwpx(extra: Record<string, string | Uint8Array> = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' })
  zip.file('version.xml', '<hv:HCFVersion/>')
  zip.file(
    'Contents/content.hpf',
    `<opf:package><opf:metadata><opf:title>담당 ${PHONE}</opf:title><opf:meta name="creator">hong@x.kr</opf:meta></opf:metadata></opf:package>`,
  )
  zip.file('Contents/header.xml', '<hh:head/>')
  zip.file(
    'Contents/section0.xml',
    section(
      // body text split across runs
      p(run('연락처 010-') + run('1234-5678')) +
        // header/footer and footnote live inside the section as controls of a paragraph
        p(
          `<hp:run><hp:ctrl><hp:header><hp:subList>${p(run(`대표 02-123-4567`))}</hp:subList></hp:header></hp:ctrl></hp:run>`,
        ) +
        p(
          `<hp:run><hp:ctrl><hp:footNote><hp:subList>${p(run('hong@x.kr'))}</hp:subList></hp:footNote></hp:ctrl></hp:run>`,
        ) +
        // a table whose cell paragraph is nested inside the outer paragraph
        p(
          `<hp:run><hp:t>표 제목</hp:t><hp:tbl><hp:tr><hp:tc><hp:subList>${p(run('010-9876-') + run('5432'))}</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run>` +
            run(' 아래'),
        ) +
        p(run('2026-10-28 회의, 1,250,000원, 홍길동, 서울시 강남구 테헤란로 123')),
    ),
  )
  zip.file('Contents/section1.xml', section(p(run(`계좌 국민 123456-01-234567`))))
  zip.file('Preview/PrvText.txt', `연락처 ${PHONE}\r\n표 제목\r\n`)
  zip.file('Preview/PrvImage.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]))
  zip.file('META-INF/container.xml', '<ocf:container/>')
  for (const [k, v] of Object.entries(extra)) zip.file(k, v)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function partsOf(bytes: Uint8Array): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await readPackage(bytes)).map((e) => [e.name, Buffer.from(e.data).toString('utf8')]),
  )
}

describe('maskHwpx', () => {
  it('masks body, header, footnote, table cells and every section', async () => {
    const { bytes, counts } = await maskHwpx(await hwpx())
    const parts = await partsOf(bytes)
    const sec0 = parts['Contents/section0.xml']
    expect(sec0).not.toMatch(/010-|02-123|hong@/)
    expect(xmlParagraphTexts(sec0, XML_FAMILIES.hwpx)).toEqual([
      '연락처 [전화번호]',
      '',
      '대표 [전화번호]',
      '',
      '[이메일]',
      '표 제목 아래',
      '[전화번호]',
      '2026-10-28 회의, 1,250,000원, 홍길동, 서울시 강남구 테헤란로 123',
    ])
    expect(parts['Contents/section1.xml']).toContain('[계좌번호]')
    // section0: body, header, table cell; plus the metadata title and the text preview
    expect(counts.phone).toBe(5)
  })

  it('masks metadata and the plain-text preview, and blanks the preview image', async () => {
    const parts = await partsOf((await maskHwpx(await hwpx())).bytes)
    expect(parts['Contents/content.hpf']).not.toMatch(/010-|hong@/)
    expect(parts['Preview/PrvText.txt']).toBe('연락처 [전화번호]\r\n표 제목\r\n')
    const raw = (await readPackage((await maskHwpx(await hwpx())).bytes)).find(
      (e) => e.name === 'Preview/PrvImage.png',
    )
    expect(raw).toBeDefined()
    expect([...raw!.data.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(raw!.data.length).not.toBe(7)
  })

  it('keeps mimetype first and stored', async () => {
    const buf = Buffer.from((await maskHwpx(await hwpx())).bytes)
    expect(buf.subarray(30, 38).toString()).toBe('mimetype')
    expect(buf.readUInt16LE(8)).toBe(0)
  })

  it('leaves a section without numbers byte-identical', async () => {
    const clean = section(p(run('안내문')))
    const out = await partsOf(
      (await maskHwpx(await hwpx({ 'Contents/section2.xml': clean }))).bytes,
    )
    expect(out['Contents/section2.xml']).toBe(clean)
  })
})
