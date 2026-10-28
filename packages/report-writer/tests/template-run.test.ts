import { describe, expect, it } from 'vitest'
import { writeFromTemplate } from '../src/template-run'
import type {
  LlmPort,
  LlmReply,
  ReportBlock,
  ReportProgress,
  TemplateForRun,
  TemplateLander,
  WikiPort,
} from '../src/types'

const TEMPLATE: TemplateForRun = {
  title: 'KOICA ODA 기술제안서',
  purpose: 'KOICA 용역 입찰의 기술제안서 본문',
  sections: [
    {
      index: 0,
      path: ['Ⅰ. 제안사 소개', '1. 일반현황'],
      heading: '1-1. 회사 일반현황',
      level: 3,
      guidance: '회사명·대표자를 글머리로',
    },
    {
      index: 1,
      path: ['Ⅰ. 제안사 소개', '1. 일반현황'],
      heading: '1-2. 사업대상지 분석',
      level: 3,
      guidance: '현황(As-is)과 방향(To-be)',
    },
    { index: 2, path: ['Ⅱ. 기술 부문'], heading: '1. 사업이해도', level: 2, guidance: '' },
  ],
  coverLabels: ['사업명', '발주기관', '제출일'],
  wikiPages: ['methods/pmc'],
  styleRules: '본문은 개조식',
}

type Call = [string, ...unknown[]]
function recordingLander(): TemplateLander & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    cover: async (v) => void calls.push(['cover', v]),
    section: async (i: number, blocks: ReportBlock[]) => void calls.push(['section', i, blocks]),
    sectionFailed: async (i: number) => void calls.push(['sectionFailed', i]),
    gaps: async (blocks) => void calls.push(['gaps', blocks]),
    finish: async () => void calls.push(['finish']),
  }
}

function fakeLlm(opts: { plan?: unknown; section?: (user: string) => LlmReply } = {}) {
  const prompts: Array<{ kind: string; user: string }> = []
  const llm: LlmPort = async (req) => {
    const kind = req.system.includes('템플릿 기획자')
      ? 'plan'
      : req.system.includes('템플릿 집필자')
        ? 'section'
        : 'gaps'
    prompts.push({ kind, user: req.user })
    if (kind === 'plan') {
      return {
        status: 'complete',
        text: JSON.stringify(
          opts.plan ?? {
            brief: { purpose: '수주', reader: 'KOICA 평가위원', messages: ['m'], terms: {} },
            cover: { 사업명: '르완다 교사 디지털 역량 강화 PMC', 발주기관: 'KOICA' },
            sections: [
              { index: 0, point: '회사 소개', attachmentParts: [], wikiPages: ['entities/nurie'] },
              { index: 1, point: '현황', attachmentParts: [], wikiPages: [] },
              { index: 2, point: '이해', attachmentParts: [], wikiPages: [] },
              { index: 7, point: '없는 절', attachmentParts: [], wikiPages: [] },
            ],
          },
        ),
      }
    }
    if (kind === 'section') {
      return (
        opts.section?.(req.user) ?? {
          status: 'complete',
          text: '#### 소제목이 와도\n- 항목 하나\n\n본문 문장.\n<<주장>>\n- 주장\n<<부족>>\n- 대표자 이름',
        }
      )
    }
    return {
      status: 'complete',
      text: '## 확인 필요 사항\n| 항목 | 이유 | 관련 |\n|---|---|---|\n| 대표자 | 표지 | 1 |',
    }
  }
  return Object.assign(llm, { prompts })
}

const wiki: WikiPort = {
  catalog: async () => '- 누리에듀랩 (entities/nurie)\n- PMC 방식 (methods/pmc)',
  index: async () => '',
  read: async (id) => `페이지 ${id} 내용`,
}

const run = (llm: LlmPort, lander: TemplateLander, progress: ReportProgress[] = []) =>
  writeFromTemplate(
    {
      request: '르완다 PMC 제안서를 써 줘',
      template: TEMPLATE,
      attachments: [{ name: '회사소개서.docx', text: '누리에듀랩(주) 회사 소개' }],
    },
    { llm, wiki, lander, progress: (e) => progress.push(e) },
  )

describe('writeFromTemplate', () => {
  it('writes every section in template order, never adding or dropping one', async () => {
    const lander = recordingLander()
    const outcome = await run(fakeLlm(), lander)
    expect(outcome).toMatchObject({ ok: true, written: 3, failed: [] })
    expect(lander.calls.filter((c) => c[0] === 'section').map((c) => c[1])).toEqual([0, 1, 2])
    expect(lander.calls.at(-1)).toEqual(['finish'])
  })

  it('headings in an answer become paragraphs (the form already has the heading)', async () => {
    const lander = recordingLander()
    await run(fakeLlm(), lander)
    const blocks = lander.calls.find((c) => c[0] === 'section')![2] as ReportBlock[]
    expect(
      blocks.every((b) => b.type !== 'chapter' && b.type !== 'section' && b.type !== 'subsection'),
    ).toBe(true)
    expect(blocks[0]).toEqual({ type: 'paragraph', text: '소제목이 와도' })
  })

  it('fills the cover first; a missing cover value goes to the gaps', async () => {
    const llm = fakeLlm()
    const lander = recordingLander()
    await run(llm, lander)
    expect(lander.calls[0]).toEqual([
      'cover',
      { 사업명: '르완다 교사 디지털 역량 강화 PMC', 발주기관: 'KOICA' },
    ])
    const gapsPrompt = llm.prompts.find((p) => p.kind === 'gaps')!
    expect(gapsPrompt.user).toContain('제출일')
    expect(gapsPrompt.user).toContain('대표자 이름')
  })

  it('each section prompt carries its guidance, its path and the template wiki pages first', async () => {
    const llm = fakeLlm()
    await run(llm, recordingLander())
    const first = llm.prompts.find(
      (p) =>
        p.kind === 'section' &&
        p.user.includes('## 지금 쓸 절\nⅠ. 제안사 소개 > 1. 일반현황 > 1-1.'),
    )!.user
    expect(first).toContain('회사명·대표자를 글머리로')
    expect(first).toContain('Ⅰ. 제안사 소개 > 1. 일반현황 > 1-1. 회사 일반현황')
    expect(first.indexOf('methods/pmc')).toBeLessThan(first.indexOf('entities/nurie'))
    const plan = llm.prompts.find((p) => p.kind === 'plan')!.user
    expect(plan).toContain('[0] 1-1. 회사 일반현황')
  })

  it('a failed section is marked and the run goes on', async () => {
    const lander = recordingLander()
    const outcome = await run(
      fakeLlm({
        section: (user) =>
          user.includes('## 지금 쓸 절\nⅠ. 제안사 소개 > 1. 일반현황 > 1-2. 사업대상지 분석')
            ? { status: 'error', text: '', error: 'boom' }
            : { status: 'complete', text: '본문.\n<<주장>>\n- a\n<<부족>>\n- 없음' },
      }),
      lander,
    )
    expect(outcome).toMatchObject({ ok: true, written: 2, failed: [2] })
    expect(lander.calls.some((c) => c[0] === 'sectionFailed' && c[1] === 1)).toBe(true)
    expect(lander.calls.filter((c) => c[0] === 'section').map((c) => c[1])).toEqual([0, 2])
  })
})

describe('writeFromTemplate concurrency', () => {
  it('asks up to 4 sections at once but lands them in order', async () => {
    const many: TemplateForRun = {
      ...TEMPLATE,
      coverLabels: [],
      sections: Array.from({ length: 9 }, (_, i) => ({
        index: i * 2,
        path: ['Ⅰ'],
        heading: `${i + 1}. 절`,
        level: 2,
        guidance: '',
      })),
    }
    let live = 0
    let peak = 0
    const llm: LlmPort = async (req) => {
      if (req.system.includes('템플릿 기획자')) {
        return { status: 'complete', text: '{"brief":{},"cover":{},"sections":[]}' }
      }
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 10))
      live--
      return { status: 'complete', text: '본문.\n<<주장>>\n- a\n<<부족>>\n- 없음' }
    }
    const lander = recordingLander()
    const progress: ReportProgress[] = []
    const outcome = await writeFromTemplate(
      { request: 'r', template: many, attachments: [] },
      { llm, wiki: null, lander, progress: (e) => progress.push(e) },
    )
    expect(outcome).toMatchObject({ ok: true, written: 9 })
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
    expect(lander.calls.filter((c) => c[0] === 'section').map((c) => c[1])).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16,
    ])
    const chapters = progress.filter((e) => e.kind === 'chapter') as Array<{
      no: number
      of: number
    }>
    expect(chapters.map((e) => e.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(chapters.every((e) => e.of === 9)).toBe(true)
  })
})

describe('template section prompt rules (live findings)', () => {
  it('forbids restating the guidance and citing writing-method pages as sources', async () => {
    const { templateSectionPrompt } = await import('../src/template-prompts')
    const { system } = templateSectionPrompt({
      template: TEMPLATE,
      section: TEMPLATE.sections[0]!,
      point: '',
      brief: { purpose: '', reader: '', messages: [], terms: {} },
      ledger: [],
      attachment: '',
      wikiPages: [],
      kind: 'proposal',
    })
    expect(system).toContain('안내를 본문에 옮기거나 설명하지 않는다')
    expect(system).toContain('methods/')
    expect(system).toContain('출처로 인용하지 않는다')
  })
})
