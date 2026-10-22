import type { PlannedChapter, ReportPlan } from './types'

/** fixed copy (spec: writing rules) */
export const WRITING_RULES = `작성 원칙:
- 각 절의 첫 문장은 그 절의 결론이다. "본 절에서는 ~을 살펴본다" 같은 문장은 쓰지 않는다.
- 근거는 제공된 첨부와 위키 페이지에서만 가져온다. 근거로 쓴 문장 끝에 (출처: 첨부 이름 또는 페이지 이름)을 단다. 첨부와 위키가 다르면 첨부를 따른다.
- 위키 페이지의 "## 활용 메모 (원문 아님)" 섹션은 참고만 하고 출처로 인용하지 않는다.
- 자료에 없는 사실·수치·기준은 만들지 않는다. 작성자가 새로 제안하는 일은 "(제안)"이라고 밝히고 출처를 달지 않는다.
- 본문에 "[확인 필요]" 같은 빈칸을 쓰지 않는다. 근거가 없어 쓸 수 없는 내용은 본문에서 빼고 응답 끝의 <<부족>> 목록에 적는다.
- 한 문장은 짧게, 한 문단은 세 문장 이하. 비교·단계·항목 나열은 표나 번호 목록으로.
- 일반론, 반복, "결론적으로" 같은 군더더기를 쓰지 않는다.`

/** fixed copy; replaces the no-blank rule for proposals */
export const PROPOSAL_RULES = `제안서 원칙:
- 제안사에 관한 사실(실적, 인력, 금액 등) 중 자료에 없는 것은 본문의 그 자리에 [회사 실적 기재]처럼 대괄호 빈칸으로 남긴다.
- 제안요청서의 목차·작성 요령·평가 항목을 그대로 따르고, 요구사항마다 대응을 쓴다.`

const rulesFor = (kind: 'report' | 'proposal'): string =>
  kind === 'proposal'
    ? `${WRITING_RULES.split('\n')
        .filter((l) => !l.includes('[확인 필요]'))
        .join('\n')}\n\n${PROPOSAL_RULES}`
    : WRITING_RULES

const ANSWER_FORMAT = `답의 형식:
- 마크다운으로 쓴다. 첫 줄은 "## N. 장 제목", 절은 "### ", 그 아래는 "#### " 제목을 쓴다.
- 목록은 "- " 또는 "1. ", 표는 "| 열 | 열 |" 형식(둘째 줄 "|---|---|")으로 쓴다.
- 본문 다음에 다음 두 목록을 붙인다:
<<주장>>
- 이 장이 확정한 핵심 주장 3~5개, 각 1문장
<<부족>>
- 자료가 없어 쓰지 못한 내용 (없으면 "- 없음")`

const outlineText = (plan: ReportPlan): string =>
  plan.chapters
    .map(
      (c) =>
        `${c.no}. ${c.title}\n   결론: ${c.point}\n   맡는 주제: ${c.owns.join(', ') || '-'}\n   입장: ${c.stances.join(' / ') || '-'}\n   절: ${c.sections.join(' / ') || '-'}`,
    )
    .join('\n')

const briefText = (plan: ReportPlan): string =>
  [
    `제목: ${plan.title}`,
    `목적: ${plan.brief.purpose}`,
    `독자: ${plan.brief.reader}`,
    `핵심 메시지: ${plan.brief.messages.join(' / ')}`,
    Object.keys(plan.brief.terms).length
      ? `용어: ${Object.entries(plan.brief.terms)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

export interface PlanPromptInput {
  request: string
  kind: 'report' | 'proposal'
  styleRules: string
  lengthHint?: string | undefined
  /** all attachments, whole (small attachments) */
  attachmentsWhole?: string | undefined
  /** one line per part (large attachments) */
  attachmentMap?: string | undefined
  /** the parts the plan must see whole (large attachments) */
  mustSee?: string | undefined
  /** the wiki's catalog and index lists */
  wiki: string
}

export function planPrompt(input: PlanPromptInput): { system: string; user: string } {
  const system = `너는 보고서 기획자다. 사용자의 요청과 자료를 보고 문서의 맥락 요약과 목차를 확정한다. JSON만 출력한다.

규칙:
- 첨부가 있으면 첨부가 최우선 자료다. 목차는 첨부를 따른다(제안요청서라면 그 목차·작성 요령·평가 항목). 첨부가 목차를 정하면 tocFromAttachment를 true로 한다.
- 각 주제는 정확히 한 장이 맡는다(owns). 장마다 입장(stances) 2~4개를 확정하고, 장끼리 입장이 모순되면 안 된다.
- 장 수는 길이 요청을 따르고, 없으면 자료에 맞게 정한다(보통 4~7장).
- 장마다 쓸 첨부 부분(attachmentParts: 첨부 지도의 id)과 위키 페이지(wikiPages: 위키 목록에 적힌 이름 그대로)를 고른다. 목록에 없는 이름은 쓰지 않는다.
- 요약 장은 넣지 않는다(마지막에 따로 쓴다).${input.styleRules ? `\n\n문서 스타일의 규칙:\n${input.styleRules}` : ''}`
  const parts = [
    `## 요청\n${input.request}`,
    input.lengthHint ? `## 길이\n${input.lengthHint}` : '',
    input.attachmentsWhole ? `## 첨부 (전문)\n${input.attachmentsWhole}` : '',
    input.attachmentMap
      ? `## 첨부 지도 (id | 제목 또는 쪽 | 길이 | 앞부분)\n${input.attachmentMap}`
      : '',
    input.mustSee ? `## 첨부에서 꼭 볼 부분 (전문)\n${input.mustSee}` : '',
    input.wiki ? `## 업무 위키 목록\n${input.wiki}` : '## 업무 위키 목록\n(위키 자료 없음)',
    `## 출력 JSON
{"brief":{"purpose":"독자가 이 문서로 내릴 결정 1문장","reader":"독자와 그들이 아는 것","messages":["핵심 메시지 3~5개"],"terms":{"용어":"이 문서에서 쓸 표현"}},
 "title":"문서 제목",
 "tocFromAttachment":false,
 "chapters":[{"no":1,"title":"장 제목","point":"이 장의 결론 1문장","owns":["이 장이 맡는 주제"],"stances":["확정 입장 1문장"],"sections":["1.1 절 제목: 다룰 내용 한 줄"],"attachmentParts":["A1-2"],"wikiPages":["concepts/page-name"]}]}`,
  ]
  return { system, user: parts.filter(Boolean).join('\n\n') }
}

export interface ChapterPromptInput {
  plan: ReportPlan
  chapter: PlannedChapter
  /** key claims of the chapters already written, `N장: …` */
  ledger: string[]
  /** the attachment text this chapter uses ('' = none) */
  attachment: string
  wikiPages: Array<{ id: string; text: string }>
  kind: 'report' | 'proposal'
  styleRules: string
}

export function chapterPrompt(input: ChapterPromptInput): { system: string; user: string } {
  const { plan, chapter } = input
  const system = `너는 문서 집필자다. 지금은 한 장만 쓴다. 요청과 같은 언어로 쓴다.

${rulesFor(input.kind)}${input.styleRules ? `\n\n문서 스타일의 규칙:\n${input.styleRules}` : ''}

${ANSWER_FORMAT}`
  const wiki = input.wikiPages.length
    ? input.wikiPages.map((p) => `### 위키 페이지: ${p.id}\n${p.text}`).join('\n\n')
    : '(위키 자료 없음 — 이 장은 위키 없이 쓴다)'
  const user = [
    `## 문서의 맥락\n${briefText(plan)}`,
    `## 전체 목차와 확정 입장 (모든 장이 따른다)\n${outlineText(plan)}`,
    `## 앞 장에서 확정한 주장 (반복하지 말고 모순되지 마라)\n${input.ledger.join('\n') || '(첫 장)'}`,
    `## 지금 쓸 장\n${chapter.no}. ${chapter.title}\n결론: ${chapter.point}\n입장: ${chapter.stances.join(' / ')}\n절:\n${chapter.sections.join('\n')}\n다른 장이 맡은 주제가 필요하면 한 문장만 쓰고 "(→ N장)"으로 넘긴다.`,
    `## 첨부 (최우선 자료)\n${input.attachment || '(이 장에 배정된 첨부 없음)'}`,
    `## 업무 위키\n${wiki}`,
    `"## ${chapter.no}. ${chapter.title}"로 시작해 이 장을 써라.`,
  ]
  return { system, user: user.join('\n\n') }
}

/** ask the model to go on right after what it already wrote */
export function continuePrompt(
  base: { system: string; user: string },
  soFar: string,
): { system: string; user: string } {
  return {
    system: base.system,
    user: `${base.user}\n\n## 지금까지 쓴 내용 (출력 한도에서 끊겼다)\n${soFar}\n\n끊긴 문장 바로 다음부터 이어서 써라. 앞 내용을 반복하지 마라.`,
  }
}

export function summaryPrompt(
  plan: ReportPlan,
  ledger: string[],
): { system: string; user: string } {
  return {
    system: `너는 문서 집필자다. 요약 장을 쓴다. 확정 주장에 없는 내용은 쓰지 않는다. 요청과 같은 언어로 쓴다.\n\n${WRITING_RULES}`,
    user: `## 문서의 맥락\n${briefText(plan)}\n\n## 장별 결론\n${plan.chapters.map((c) => `${c.no}. ${c.title}: ${c.point}`).join('\n')}\n\n## 확정 주장\n${ledger.join('\n')}\n\n"## 요약"으로 시작하는 요약 장을 마크다운으로 써라. 첫 문단은 독자가 결정할 내용, 그다음 핵심 권고를 번호 목록 5~7개로 쓰고 각 권고 끝에 "(→ N장)"을 붙인다. <<주장>>과 <<부족>> 목록은 붙이지 않는다.`,
  }
}

export function gapsPrompt(gaps: Array<{ no: number; need: string }>): {
  system: string
  user: string
} {
  return {
    system: '너는 문서 편집자다. 요청과 같은 언어로 쓴다.',
    user: `아래는 문서를 쓰며 자료가 없어 채우지 못한 항목이다. 중복을 합쳐 "## 확인 필요 사항"으로 시작하는 장을 마크다운 표 하나로 써라. 열: 항목 | 왜 필요한가(결정과의 관계) | 관련 장. 10행 이내, 중요한 순서.\n\n${gaps.map((g) => `${g.no}장: ${g.need}`).join('\n')}`,
  }
}
