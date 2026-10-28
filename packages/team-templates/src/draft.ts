import type { DocxOutline } from './docx-outline'

export interface DraftInput {
  /** the group's documents; outlines[0] is the representative */
  outlines: DocxOutline[]
  /** the representative's cover paragraphs (to name a placeholder per paragraph) */
  cover: string[]
  /** the representative's header/footer part → its text */
  headerFooter: Record<string, string>
  /** the work wiki's catalog: one `id | title` per line */
  wikiCatalog: string
}

export interface TemplateDraft {
  title: string
  purpose: string
  materials: string[]
  wikiPages: string[]
  /** generalized heading texts, same count and order as the representative's headings */
  headings: string[]
  guidance: string[]
  coverLabels: string[]
  headerFooter: Record<string, string>
}

const outlineText = (o: DocxOutline): string =>
  [
    ...o.headings.map((h) => `${'  '.repeat(h.level - 1)}- (${h.level}) ${h.text}`),
    ...o.tables.map((t, i) => `표 ${i + 1}: ${t.header.join(' | ')} (${t.rows}행)`),
  ].join('\n')

export function draftPrompt(input: DraftInput): { system: string; user: string } {
  const system = `너는 팀 문서 서식 담당자다. 팀이 쓴 문서의 형태(목차와 서식)를 다음 사업에도 쓸 수 있는 템플릿 정의로 만든다. JSON 객체 하나만 답한다.

규칙:
- 템플릿은 형태만 담는다. 원본 문서의 사업명, 기관명, 국가, 사람 이름, 숫자, 문장을 옮기지 않는다.
- 제목(headings)은 원본과 같은 개수·순서로 준다. 제목에 특정 사업·국가·기관이 들어 있으면 일반적인 말로 바꾼다(예: "1-2. 인도네시아 보건 현황" → "1-2. 사업대상지 현황"). 그렇지 않으면 원본 제목을 그대로 둔다.
- guidance는 제목마다 한 줄: 그 자리에 무엇을 어떤 형태(문단·글머리·표의 열 구성)와 분량으로 쓰는지. 원본 내용이 아니라 형태를 적는다.
- coverLabels는 표지 문단마다 그 자리에 들어갈 항목 이름(예: "사업명", "발주기관", "제출일"). 쓸 이름이 없으면 "".
- headerFooter는 머리글·바닥글 문구를 일반화한 것(예: "가나다컨설팅 제안서" → "[제안사] 제안서").
- wikiPages는 아래 업무 위키 목록에 있는 id만, 이 템플릿으로 쓸 때 참고할 작성 방식 위주로 고른다.`
  const docs = input.outlines
    .map((o, i) => `### 문서 ${i + 1}${i === 0 ? ' (대표)' : ''}\n${outlineText(o)}`)
    .join('\n\n')
  const user = [
    `## 같은 형태로 묶인 문서들의 목차\n여러 문서에 공통인 것이 형태이고, 문서마다 다른 것은 내용이다.\n\n${docs}`,
    `## 대표 문서의 표지 문단 (순서대로)\n${input.cover.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(없음)'}`,
    `## 대표 문서의 머리글·바닥글\n${
      Object.entries(input.headerFooter)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n') || '(없음)'
    }`,
    `## 업무 위키 목록\n${input.wikiCatalog.trim() || '(없음)'}`,
    `## 출력 JSON
{"title":"템플릿 이름(문서 종류)","purpose":"언제 쓰는 템플릿인지 1문장","materials":["채울 때 필요한 자료"],"wikiPages":["위키 id"],"headings":["대표 문서 제목 순서대로"],"guidance":["제목마다 한 줄"],"coverLabels":["표지 문단마다"],"headerFooter":{"word/header1.xml":"일반화한 문구"}}`,
  ].join('\n\n')
  return { system, user }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
const at = (v: unknown, i: number): string => (Array.isArray(v) ? str(v[i]) : '')

/** the model's draft made safe: one heading/guidance per outline heading, one label per cover paragraph */
export function parseDraft(
  json: unknown,
  outline: DocxOutline,
  knownWikiPages: Set<string>,
): TemplateDraft {
  const r = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const headings = outline.headings.map((h, i) => at(r.headings, i) || h.text)
  const hf: Record<string, string> = {}
  if (r.headerFooter && typeof r.headerFooter === 'object') {
    for (const [k, v] of Object.entries(r.headerFooter)) {
      if (/^word\/(header|footer)\d*\.xml$/.test(k) && str(v)) hf[k] = str(v)
    }
  }
  return {
    title: str(r.title) || headings[0] || '팀 템플릿',
    purpose: str(r.purpose),
    materials: strs(r.materials),
    wikiPages: strs(r.wikiPages).filter((p) => knownWikiPages.has(p)),
    headings,
    guidance: outline.headings.map((_, i) => at(r.guidance, i)),
    coverLabels: outline.cover.map((_, i) => at(r.coverLabels, i)),
    headerFooter: hf,
  }
}
