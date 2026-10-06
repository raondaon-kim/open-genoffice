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
      },
      {
        section: 0,
        paragraph: 2,
        preview: '1. 우리 관리부 보고서 작성시 부서별 ...',
        length: 85,
        empty: false,
        hasTable: false,
      },
      { section: 1, paragraph: 0, preview: '"인용"', length: 1, empty: false, hasTable: false },
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
