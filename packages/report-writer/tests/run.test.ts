import { describe, expect, it } from 'vitest'
import { writeReport } from '../src/run'
import type {
  Lander,
  LlmPort,
  LlmReply,
  ReportBlock,
  ReportProgress,
  ReportRequest,
  WikiPort,
} from '../src/types'

type Call = [string, ...unknown[]]

function recordingLander(onChapter?: (no: number) => void): Lander & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    skeleton: async (s) => void calls.push(['skeleton', s]),
    chapter: async (no: number, blocks: ReportBlock[]) => {
      calls.push(['chapter', no, blocks])
      onChapter?.(no)
    },
    chapterFailed: async (no: number) => void calls.push(['chapterFailed', no]),
    summary: async (blocks) => void calls.push(['summary', blocks]),
    gaps: async (blocks) => void calls.push(['gaps', blocks]),
    abandon: async () => void calls.push(['abandon']),
    finish: async () => void calls.push(['finish']),
  }
}

const planJson = (over: Record<string, unknown> = {}, pagesPer: string[][] = [[], [], []]) =>
  JSON.stringify({
    brief: { purpose: '결정', reader: '교육청', messages: ['m'], terms: {} },
    title: '보고서',
    tocFromAttachment: false,
    chapters: pagesPer.map((pages, i) => ({
      no: i + 1,
      title: `장${i + 1}`,
      point: 'p',
      owns: [`주제${i + 1}`],
      stances: ['s'],
      sections: [`${i + 1}.1 절`],
      attachmentParts: [],
      wikiPages: pages,
    })),
    ...over,
  })

interface FakeOpts {
  plan?: string | (() => LlmReply)
  chapter?: (no: number) => LlmReply
}
function fakeLlm(
  opts: FakeOpts = {},
): LlmPort & { prompts: Array<{ kind: string; user: string }> } {
  const prompts: Array<{ kind: string; user: string }> = []
  const llm = (async (req) => {
    const kind = req.system.includes('보고서 기획자')
      ? 'plan'
      : req.system.includes('지금은 한 장만')
        ? 'chapter'
        : req.system.includes('요약 장')
          ? 'summary'
          : 'gaps'
    prompts.push({ kind, user: req.user })
    if (kind === 'plan') {
      if (typeof opts.plan === 'function') return opts.plan()
      return { status: 'complete', text: opts.plan ?? planJson() }
    }
    if (kind === 'chapter') {
      const no = Number(/## 지금 쓸 장\n(\d+)\./.exec(req.user)?.[1])
      if (opts.chapter) return opts.chapter(no)
      return {
        status: 'complete',
        text: `## ${no}. 장${no}\n본문 ${no}.\n<<주장>>\n- 주장${no}\n<<부족>>\n- 부족${no}`,
      }
    }
    if (kind === 'summary') return { status: 'complete', text: '## 요약\n결정할 내용.' }
    return {
      status: 'complete',
      text: '## 확인 필요 사항\n| 항목 | 이유 | 장 |\n|---|---|---|\n| a | b | 1 |',
    }
  }) as LlmPort & { prompts: Array<{ kind: string; user: string }> }
  llm.prompts = prompts
  return llm
}

const req = (over: Partial<ReportRequest> = {}): ReportRequest => ({
  request: '유네스코 지침 보고서',
  kind: 'report',
  styleRules: '',
  attachments: [],
  ...over,
})
const run = async (
  over: {
    req?: Partial<ReportRequest>
    llm?: LlmPort
    wiki?: WikiPort | null
    lander?: Lander
    signal?: AbortSignal
  } = {},
) => {
  const lander = (over.lander ?? recordingLander()) as Lander & { calls: Call[] }
  const events: ReportProgress[] = []
  const outcome = await writeReport(
    req(over.req),
    {
      llm: over.llm ?? fakeLlm(),
      wiki: over.wiki ?? null,
      lander,
      progress: (e) => events.push(e),
    },
    over.signal,
  )
  return { outcome, lander, events }
}

describe('writeReport', () => {
  it('lands the skeleton before any chapter and the chapters in order', async () => {
    const { lander, outcome } = await run()
    expect(lander.calls.map((c) => c[0])).toEqual([
      'skeleton',
      'chapter',
      'chapter',
      'chapter',
      'summary',
      'gaps',
      'finish',
    ])
    expect(lander.calls.filter((c) => c[0] === 'chapter').map((c) => c[1])).toEqual([1, 2, 3])
    expect(outcome).toEqual({ ok: true, written: 3, failed: [], gaps: 3 })
  })

  it("passes earlier chapters' claims to later chapters", async () => {
    const llm = fakeLlm()
    await run({ llm })
    const third = llm.prompts.filter((p) => p.kind === 'chapter')[2]!
    expect(third.user).toContain('1장: 주장1')
    expect(third.user).toContain('2장: 주장2')
  })

  it("a chapter call never contains another chapter's pages or the whole wiki", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `concepts/p${i}`)
    const wiki: WikiPort = {
      catalog: async () => ids.map((id) => `- [개념] ${id} — s (${id})`).join('\n'),
      index: async () => '',
      read: async (id) => `${id} 본문 ${'가'.repeat(3000)}`,
    }
    const llm = fakeLlm({ plan: planJson({}, [['concepts/p1'], ['concepts/p2'], ['concepts/p3']]) })
    await run({ llm, wiki })
    const chapters = llm.prompts.filter((p) => p.kind === 'chapter')
    chapters.forEach((p, i) => {
      for (const id of ids) {
        const mine = id === `concepts/p${i + 1}`
        // pages arrive fenced: "⟦자료 <nonce> 시작: 위키 페이지: <id>⟧"
        expect(p.user.includes(`위키 페이지: ${id}⟧`)).toBe(mine)
      }
      expect(p.user.length).toBeLessThan(60000)
    })
  })

  it('runs without the wiki when the wiki port fails', async () => {
    const wiki: WikiPort = {
      catalog: async () => Promise.reject(new Error('off')),
      index: async () => Promise.reject(new Error('off')),
      read: async () => Promise.reject(new Error('off')),
    }
    const llm = fakeLlm()
    const { lander } = await run({ llm, wiki })
    expect(lander.calls.filter((c) => c[0] === 'chapter')).toHaveLength(3)
    expect(llm.prompts.find((p) => p.kind === 'chapter')!.user).toMatch(/위키 자료 없음/)
  })

  it('a plan that never parses lands nothing', async () => {
    const { lander, outcome, events } = await run({ llm: fakeLlm({ plan: 'not json' }) })
    expect(lander.calls).toEqual([])
    expect(outcome.ok).toBe(false)
    expect(events.at(-1)!.kind).toBe('error')
  })

  it('a failed chapter is marked and the run goes on', async () => {
    const llm = fakeLlm({
      chapter: (no) =>
        no === 2
          ? { status: 'error', text: '', error: 'HTTP 500' }
          : { status: 'complete', text: `## ${no}. 장\n본문\n<<주장>>\n- c` },
    })
    const { lander, outcome } = await run({ llm })
    expect(lander.calls.map((c) => c[0])).toEqual([
      'skeleton',
      'chapter',
      'chapterFailed',
      'chapter',
      'summary',
      'gaps',
      'finish',
    ])
    expect(outcome).toMatchObject({ ok: true, written: 2, failed: [2] })
  })

  it('cancel keeps landed chapters and removes open placeholders', async () => {
    const ac = new AbortController()
    const lander = recordingLander((no) => {
      if (no === 2) ac.abort()
    })
    const { outcome, events } = await run({ lander, signal: ac.signal })
    expect(lander.calls.map((c) => c[0])).toEqual(['skeleton', 'chapter', 'chapter', 'abandon'])
    expect(outcome).toEqual({ ok: false, error: 'cancelled', written: 2 })
    expect(events.at(-1)).toEqual({ kind: 'cancelled', written: 2 })
  })

  it('a proposal whose attachment fixes the TOC gets no summary and no gaps table', async () => {
    const llm = fakeLlm({ plan: planJson({ tocFromAttachment: true }) })
    const { lander } = await run({
      llm,
      req: { kind: 'proposal', attachments: [{ name: 'rfp.docx', text: '# 목차\n1. 개요' }] },
    })
    expect(lander.calls.map((c) => c[0])).toEqual([
      'skeleton',
      'chapter',
      'chapter',
      'chapter',
      'finish',
    ])
    expect((lander.calls[0]![1] as { withSummary: boolean }).withSummary).toBe(false)
  })

  it('stops before planning when an attachment is empty', async () => {
    const llm = fakeLlm()
    const { outcome, lander } = await run({
      llm,
      req: { attachments: [{ name: 'a.pdf', text: '  ' }] },
    })
    expect(outcome).toMatchObject({ ok: false })
    expect(outcome.ok === false && outcome.error).toContain('a.pdf')
    expect(llm.prompts).toEqual([])
    expect(lander.calls).toEqual([])
  })

  it('gives small attachments whole and large ones by their assigned parts', async () => {
    const small = fakeLlm()
    await run({ llm: small, req: { attachments: [{ name: 's.docx', text: '# 개요\n작은 첨부' }] } })
    expect(small.prompts.find((p) => p.kind === 'plan')!.user).toContain('작은 첨부')
    expect(small.prompts.find((p) => p.kind === 'chapter')!.user).toContain('작은 첨부')

    const text = [
      '# 표지\n표지',
      ...Array.from({ length: 10 }, (_, i) => `## 장${i}\n${'나'.repeat(3900)}`),
    ].join('\n')
    const plan = JSON.parse(planJson())
    plan.chapters[0].attachmentParts = ['A1-3']
    const big = fakeLlm({ plan: JSON.stringify(plan) })
    await run({ llm: big, req: { attachments: [{ name: 'b.docx', text }] } })
    const planUser = big.prompts.find((p) => p.kind === 'plan')!.user
    expect(planUser).toContain('A1-3 | 장1')
    const ch1 = big.prompts.filter((p) => p.kind === 'chapter')[0]!.user
    const ch2 = big.prompts.filter((p) => p.kind === 'chapter')[1]!.user
    expect(ch1).toContain('A1-3 | 장1')
    expect(ch2).not.toContain('나'.repeat(100))
  })
})

describe('writeReport with a huge attachment', () => {
  it('keeps the plan prompt bounded', async () => {
    const text = Array.from({ length: 3000 }, (_, i) => `문단 ${i} ${'가'.repeat(990)}`).join(
      '\n\n',
    )
    const llm = fakeLlm()
    await run({ llm, req: { attachments: [{ name: 'huge.txt', text }] } })
    const plan = llm.prompts.find((p) => p.kind === 'plan')!
    expect(plan.user.length).toBeLessThan(60000)
  })
})
