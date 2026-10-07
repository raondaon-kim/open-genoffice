import { describe, expect, it } from 'vitest'
import { paragraphsResult, parseDumpParagraphs } from '../src/main/rhwp-paragraphs'

const DUMP = [
  '=== 구역 0 ===',
  '--- 문단 0.0 --- cc=25, text_len=0, controls=3 [구역나누기]',
  '  텍스트: (빈 문단)',
  '  [2] 표: 1행×2열, 셀=2, 쪽나눔=RowBreak',
  '--- 문단 0.1 --- cc=38, text_len=21, controls=2 ',
  '  텍스트: "보고서 제목 (HY헤드라인M+굵게28)"',
  '  [CS] pos=0 id=13',
  '--- 문단 0.2 --- cc=86, text_len=85, controls=0 ',
  '  텍스트: "          1. 우리 관리부 보고서 작성시 부서별 ..."',
  '--- 문단 1.0 --- cc=2, text_len=1, controls=0 ',
  '  텍스트: "\\"인용\\""',
].join('\n')

describe('parseDumpParagraphs', () => {
  it('reads coordinates, preview, length, emptiness and tables per body paragraph', () => {
    expect(parseDumpParagraphs(DUMP)).toEqual([
      { section: 0, paragraph: 0, preview: '', length: 0, empty: true, hasTable: true },
      {
        section: 0,
        paragraph: 1,
        preview: '보고서 제목 (HY헤드라인M+굵게28)',
        length: 21,
        empty: false,
        hasTable: false,
        lead: 0,
        leadChars: 0,
      },
      {
        section: 0,
        paragraph: 2,
        preview: '1. 우리 관리부 보고서 작성시 부서별 ...',
        length: 85,
        empty: false,
        hasTable: false,
        lead: 10,
        leadChars: 10,
      },
      {
        section: 1,
        paragraph: 0,
        preview: '"인용"',
        length: 1,
        empty: false,
        hasTable: false,
        lead: 0,
        leadChars: 0,
      },
    ])
  })

  it('treats a whitespace-only paragraph as empty and returns [] for no paragraphs', () => {
    expect(
      parseDumpParagraphs('--- 문단 0.0 --- cc=4, text_len=3, controls=0\n  텍스트: "   "'),
    ).toEqual([{ section: 0, paragraph: 0, preview: '', length: 3, empty: true, hasTable: false }])
    expect(parseDumpParagraphs('nothing here')).toEqual([])
  })

  it('reads Windows line endings', () => {
    expect(parseDumpParagraphs(DUMP.replace(/\n/g, '\r\n'))).toHaveLength(4)
  })
})

describe('paragraphsResult', () => {
  it('turns dump stdout into a fenced-field envelope and drops the raw text', () => {
    const result = paragraphsResult({ exitCode: 0, envelope: null, stderr: '', stdout: DUMP })
    expect(result).not.toHaveProperty('stdout')
    expect(result.exitCode).toBe(0)
    expect(result.envelope).toMatchObject({
      schemaVersion: '1.0',
      untrustedContent: true,
      untrustedFields: ['paragraphs[].preview'],
    })
    expect((result.envelope!.paragraphs as unknown[]).length).toBe(4)
  })

  it('passes an engine failure through without an envelope', () => {
    expect(paragraphsResult({ exitCode: 1, envelope: null, stderr: 'boom', stdout: 'x' })).toEqual({
      exitCode: 1,
      envelope: null,
      stderr: 'boom',
    })
  })
})

describe('parseDumpParagraphs font size', () => {
  const SIZED = [
    '--- 문단 0.0 --- cc=1, text_len=0, controls=0 ',
    '  텍스트: (빈 문단)',
    '  [CS] pos=0 id=30 bold=false spacing=0% ratio=100% base=600 attr=0x00000000 text=#000000',
    '--- 문단 0.1 --- cc=9, text_len=8, controls=0 ',
    '  텍스트: "본문 문장입니다."',
    '  [CS] pos=0 id=26 bold=false spacing=0% ratio=100% base=1300 attr=0x00000000 text=#000000',
    '  [CS] pos=4 id=27 bold=true spacing=0% ratio=100% base=1500 attr=0x00000000 text=#000000',
    '--- 문단 0.2 --- cc=3, text_len=2, controls=0 ',
    '  텍스트: "끝"',
  ].join('\n')

  it('reads the size of the first character run in points (the dump prints 1/100 pt)', () => {
    const [spacer, body, bare] = parseDumpParagraphs(SIZED)
    expect(spacer).toMatchObject({ empty: true, fontSize: 6 })
    expect(body).toMatchObject({ preview: '본문 문장입니다.', fontSize: 13 })
    expect(bare).not.toHaveProperty('fontSize')
  })
})

describe('parseDumpParagraphs shape', () => {
  const SHAPED = [
    '--- 문단 0.0 --- cc=24, text_len=23, controls=0 ',
    '  텍스트: "  가. 서울특별시 인재개발 기본계획"',
    '  [CS] pos=0 id=26 bold=false spacing=0% ratio=100% base=1200 attr=0x00000000 text=#000000',
    '  [CS] pos=2 id=27 bold=true spacing=0% ratio=100% base=1500 attr=0x00000000 text=#000000',
    '  [PS] ps_id=32 align=Justify spacing: before=1000 after=200 line=180/Percent',
    '       margins: left=2000 right=300 indent=-660 border_fill_id=2',
    '--- 문단 0.1 --- cc=9, text_len=8, controls=0 ',
    '  텍스트: "\t○ 항목"',
    '  [CS] pos=0 id=26 bold=false spacing=0% ratio=100% base=1300 attr=0x00000000 text=#000000',
    '  [PS] ps_id=33 align=Left spacing: before=0 after=0 line=1600/Fixed',
    '       margins: left=0 right=0 indent=0 border_fill_id=2',
    '--- 문단 0.2 --- cc=1, text_len=0, controls=0 ',
    '  텍스트: (빈 문단)',
  ].join('\n')

  it('reads paragraph shape, bold and leading whitespace', () => {
    const [first, second, blank] = parseDumpParagraphs(SHAPED)
    expect(first).toMatchObject({
      lead: 2,
      align: 'justify',
      spacingBefore: 1000,
      spacingAfter: 200,
      lineSpacing: 180,
      marginLeft: 2000,
      marginRight: 300,
      indent: -660,
    })
    expect(second).toMatchObject({ lead: 4, align: 'left', marginLeft: 0, indent: 0 })
    expect(blank).not.toHaveProperty('lead')
  })

  it('takes size and bold from the run that holds the first non-space character', () => {
    const [first, second] = parseDumpParagraphs(SHAPED)
    // the two leading spaces are a 12 pt run; the text from pos 2 is 15 pt bold
    expect(first).toMatchObject({ fontSize: 15, bold: true })
    expect(second).toMatchObject({ fontSize: 13, bold: false })
  })

  it('leaves out a line spacing that is not a percentage', () => {
    const [, second] = parseDumpParagraphs(SHAPED)
    expect(second).not.toHaveProperty('lineSpacing')
  })
})

describe('parseDumpParagraphs — values the dump does not print as one quoted line', () => {
  it('reads a paragraph whose text holds a soft line break (no closing quote on the first line)', () => {
    const dump = [
      '--- 문단 0.0 --- cc=20, text_len=14, controls=0 ',
      '  텍스트: "    가. 첫줄',
      '둘째줄"',
      '  [CS] pos=0 id=1 bold=true spacing=0% ratio=100% base=1400 attr=0x0 text=#000000',
      '  [PS] ps_id=3 align=Justify spacing: before=0 after=0 line=160/Percent',
      '       margins: left=0 right=0 indent=660 border_fill_id=2',
      '--- 문단 0.1 --- cc=3, text_len=2, controls=0 ',
      '  텍스트: "다음"',
    ].join('\n')
    const [first, second] = parseDumpParagraphs(dump)
    expect(first).toMatchObject({
      preview: '가. 첫줄',
      lead: 4,
      leadChars: 4,
      fontSize: 14,
      bold: true,
      indent: 660,
    })
    expect(second).toMatchObject({ paragraph: 1, preview: '다음' })
  })

  it('takes the size and weight of the run that holds the first character after a tab', () => {
    const dump = [
      '--- 문단 0.0 --- cc=12, text_len=5, controls=0 ',
      '  텍스트: "\t○ 항목"',
      '  [CS] pos=0 id=1 bold=false spacing=0% ratio=100% base=1000 attr=0x0 text=#000000',
      '  [CS] pos=8 id=2 bold=true spacing=0% ratio=100% base=1500 attr=0x0 text=#000000',
    ].join('\n')
    expect(parseDumpParagraphs(dump)[0]).toMatchObject({ leadChars: 1, fontSize: 15, bold: true })
  })
})

describe('parseDumpParagraphs — controls in front of the text', () => {
  it('skips the run that covers a section-definition control (cc counts 8 units per control)', () => {
    // real scaffold output: two controls (16 units) precede the 3-character text
    const dump = [
      '--- 문단 0.0 --- cc=20, text_len=3, controls=2 [구역나누기]',
      '  텍스트: "기관명"',
      '  [CS] pos=0 id=0 bold=false spacing=0% ratio=100% base=1000 attr=0x0 text=#000000',
      '  [CS] pos=16 id=3 bold=true spacing=0% ratio=100% base=2000 attr=0x0 text=#000000',
    ].join('\n')
    expect(parseDumpParagraphs(dump)[0]).toMatchObject({ fontSize: 20, bold: true })
  })

  it('does not shift the choice for a leading tab (the tab itself takes 8 units)', () => {
    const dump = [
      '--- 문단 0.0 --- cc=13, text_len=5, controls=0 ',
      '  텍스트: "\t○ 항목"',
      '  [CS] pos=0 id=1 bold=false spacing=0% ratio=100% base=1000 attr=0x0 text=#000000',
      '  [CS] pos=8 id=2 bold=true spacing=0% ratio=100% base=1500 attr=0x0 text=#000000',
    ].join('\n')
    expect(parseDumpParagraphs(dump)[0]).toMatchObject({ fontSize: 15, bold: true })
  })
})

describe('parseDumpParagraphs — tabs and controls inside the text', () => {
  it('does not treat a tab in the middle of the text as a control in front of it', () => {
    // scaffold "가나<tab>다라마바사", then a 20 pt bold run from offset 2: cc=32 holds the tab (8 units)
    const dump = [
      '--- 문단 0.0 --- cc=32, text_len=8, controls=0 ',
      '  텍스트: "가나\\t다라마바사"',
      '  [CS] pos=0 id=1 bold=false spacing=0% ratio=100% base=1000 attr=0x0 text=#000000',
      '  [CS] pos=18 id=2 bold=true spacing=0% ratio=100% base=2000 attr=0x0 text=#000000',
    ].join('\n')
    expect(parseDumpParagraphs(dump)[0]).toMatchObject({ fontSize: 10, bold: false })
  })
})
