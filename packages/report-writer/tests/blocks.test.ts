import { describe, expect, it } from 'vitest'
import { parseBlocks, parseChapterAnswer } from '../src/blocks'

describe('parseBlocks', () => {
  it('parses headings, paragraphs, lists and a pipe table into blocks', () => {
    const md =
      '## 2. 규제\n\n첫 문장이 결론이다.\n\n### 2.1 7단계\n\n- 데이터 보호\n- 전략\n\n1. 하나\n2. 둘\n\n#### 세부\n\n| 단계 | 내용 |\n|---|---|\n| 1 | 데이터 |\n'
    expect(parseBlocks(md)).toEqual([
      { type: 'chapter', text: '2. 규제' },
      { type: 'paragraph', text: '첫 문장이 결론이다.' },
      { type: 'section', text: '2.1 7단계' },
      { type: 'bullet', text: '데이터 보호' },
      { type: 'bullet', text: '전략' },
      { type: 'numbered', text: '하나' },
      { type: 'numbered', text: '둘' },
      { type: 'subsection', text: '세부' },
      {
        type: 'table',
        rows: [
          ['단계', '내용'],
          ['1', '데이터'],
        ],
      },
    ])
  })

  it('joins soft-wrapped paragraph lines and strips emphasis markers', () => {
    expect(parseBlocks('첫 줄\n둘째 줄 **강조**')).toEqual([
      { type: 'paragraph', text: '첫 줄 둘째 줄 강조' },
    ])
  })
})

describe('parseChapterAnswer', () => {
  it('splits the claims and gaps lists off the chapter answer', () => {
    const r = parseChapterAnswer(
      '## 1. 원칙\n\n본문.\n<<주장>>\n- 인간 중심\n- 13세 하한\n<<부족>>\n- 국내 동의 연령\n',
    )
    expect(r.blocks).toEqual([
      { type: 'chapter', text: '1. 원칙' },
      { type: 'paragraph', text: '본문.' },
    ])
    expect(r.claims).toEqual(['인간 중심', '13세 하한'])
    expect(r.gaps).toEqual(['국내 동의 연령'])
  })

  it('treats "없음" as no gaps and a missing list as empty', () => {
    expect(parseChapterAnswer('본문\n<<부족>>\n- 없음').gaps).toEqual([])
    expect(parseChapterAnswer('본문').claims).toEqual([])
  })
})
