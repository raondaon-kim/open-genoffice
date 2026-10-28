import { FENCE_RULE, fence, newNonce, rulesFor } from './prompts'
import type { Brief, TemplateForRun, TemplateSection } from './types'

const pathOf = (s: TemplateSection): string => [...s.path, s.heading].join(' > ')

export const outlineLines = (t: TemplateForRun): string =>
  t.sections
    .map((s) => `[${s.index}] ${s.heading}  (${pathOf(s)})${s.guidance ? ` — ${s.guidance}` : ''}`)
    .join('\n')

export interface TemplatePlanInput {
  request: string
  template: TemplateForRun
  kind: 'report' | 'proposal'
  attachmentsWhole?: string | undefined
  attachmentMap?: string | undefined
  mustSee?: string | undefined
  wiki: string
}

/** the plan of a template fill: the outline is given; the plan only assigns material and points */
export function templatePlanPrompt(input: TemplatePlanInput): { system: string; user: string } {
  const t = input.template
  const system = `너는 템플릿 기획자다. 팀 템플릿의 목차는 이미 정해져 있다. 목차를 바꾸지 말고, 절마다 쓸 결론과 자료를 정하고 표지 값을 채운다. JSON만 출력한다.

규칙:
- 절을 더하거나 빼거나 순서를 바꾸지 않는다. sections에는 아래 목차의 index를 그대로 쓴다.
- 첨부가 최우선 자료다. 절마다 쓸 첨부 부분(attachmentParts: 첨부 지도의 id)과 위키 페이지(wikiPages: 위키 목록에 적힌 이름 그대로)를 고른다.
- cover에는 표지 자리(${t.coverLabels.join(', ') || '없음'})마다 요청과 첨부에서 확인되는 값만 넣는다. 모르면 넣지 않는다.
- ${FENCE_RULE}`
  const nonce = newNonce()
  const user = [
    `## 요청\n${input.request}`,
    `## 템플릿\n${t.title} — ${t.purpose}${t.styleRules ? `\n${t.styleRules}` : ''}`,
    `## 고정 목차 (index | 제목 | 위치 | 쓸 내용)\n${outlineLines(t)}`,
    input.attachmentsWhole ? `## 첨부 (전문)\n${fence(nonce, '첨부', input.attachmentsWhole)}` : '',
    input.attachmentMap ? `## 첨부 지도\n${fence(nonce, '첨부 지도', input.attachmentMap)}` : '',
    input.mustSee ? `## 첨부에서 꼭 볼 부분\n${fence(nonce, '첨부 일부', input.mustSee)}` : '',
    input.wiki
      ? `## 업무 위키 목록\n${fence(nonce, '위키 목록', input.wiki)}`
      : '## 업무 위키 목록\n(위키 자료 없음)',
    `## 출력 JSON
{"brief":{"purpose":"독자가 이 문서로 내릴 결정 1문장","reader":"독자","messages":["핵심 메시지 3~5개"],"terms":{"용어":"표현"}},
 "cover":{"표지 자리 이름":"값"},
 "sections":[{"index":0,"point":"이 절의 결론 1문장","attachmentParts":["A1-2"],"wikiPages":["concepts/page"]}]}`,
  ]
  return { system, user: user.filter(Boolean).join('\n\n') }
}

export interface TemplateSectionInput {
  template: TemplateForRun
  section: TemplateSection
  point: string
  brief: Brief
  ledger: string[]
  attachment: string
  wikiPages: Array<{ id: string; text: string }>
  kind: 'report' | 'proposal'
}

const SECTION_ANSWER = `답의 형식:
- 마크다운으로 쓴다. 제목 줄(#)은 쓰지 않는다 — 이 절의 제목은 이미 문서에 있다.
- 목록은 "- " 또는 "1. ", 표는 "| 열 | 열 |" 형식(둘째 줄 "|---|---|")으로 쓴다.
- 본문 다음에 다음 두 목록을 붙인다:
<<주장>>
- 이 절이 확정한 핵심 주장 1~3개, 각 1문장
<<부족>>
- 자료가 없어 쓰지 못한 내용 (없으면 "- 없음")`

/** one leaf section of the template */
export function templateSectionPrompt(input: TemplateSectionInput): {
  system: string
  user: string
} {
  const { template: t, section: s } = input
  const system = `너는 템플릿 집필자다. 팀 템플릿의 한 절만 쓴다. 요청과 같은 언어로 쓴다.

${rulesFor(input.kind)}
- 템플릿 안내는 이 절에 무엇을 어떤 형태로 쓸지에 대한 지시다. 안내를 본문에 옮기거나 설명하지 않는다("이 표는 ~를 보여 준다", "~는 확정 후 기입한다" 같은 문장 금지). 지시대로 실제 내용만 쓴다.
- 작성 방식 위키 페이지(methods/…)는 쓰는 방법의 지침이다. 따르기만 하고 내용의 출처로 인용하지 않는다.
- ${FENCE_RULE}${t.styleRules ? `\n\n템플릿의 규칙:\n${t.styleRules}` : ''}

${SECTION_ANSWER}`
  const nonce = newNonce()
  const wiki = input.wikiPages.length
    ? input.wikiPages.map((p) => fence(nonce, `위키 페이지: ${p.id}`, p.text)).join('\n\n')
    : '(위키 자료 없음 — 이 절은 위키 없이 쓴다)'
  const user = [
    `## 문서의 맥락\n템플릿: ${t.title}\n목적: ${input.brief.purpose}\n독자: ${input.brief.reader}\n핵심 메시지: ${input.brief.messages.join(' / ')}`,
    `## 전체 목차 (바꾸지 않는다)\n${outlineLines(t)}`,
    `## 앞 절에서 확정한 주장 (반복하지 말고 모순되지 마라)\n${input.ledger.join('\n') || '(첫 절)'}`,
    `## 지금 쓸 절\n${pathOf(s)}\n쓸 내용(템플릿 안내): ${s.guidance || '(안내 없음 — 제목에 맞게)'}\n결론: ${input.point || '-'}`,
    `## 첨부 (최우선 자료)\n${input.attachment ? fence(nonce, '첨부', input.attachment) : '(이 절에 배정된 첨부 없음)'}`,
    `## 업무 위키\n${wiki}`,
    '이 절의 본문을 써라.',
  ]
  return { system, user: user.join('\n\n') }
}
