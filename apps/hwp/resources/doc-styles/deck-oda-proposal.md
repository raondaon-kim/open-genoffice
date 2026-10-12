# 국내 ODA 사업 제안 발표 (PowerPoint, KOICA·EDCF)

KOICA·EDCF 입찰의 제안 발표자료(PT) 서식 초안입니다. KOICA 제안요청서는 발표 10분 안팎, **20장 이하, PDF 제출, 제안서 목차를 따를 것**을 정합니다. 16:9 장에, 골격은 **표지 → 목차 → 장 간지와 본문 장 → 마무리** 입니다.

- **발표 순서 (제안서 목차와 같게):** 사업 이해(대상지 As-is/To-be, 문제·원인) → 추진 전략과 차별성 → 세부실행방안(PDM 기반 활동: 전문가, 연수, 기자재) → 사업관리(성과관리, 일정, 위험·안전, 사후관리) → 투입인력·조직 → 고도화 제안 → 마무리.
- **본문 장의 구성:** 위쪽 제목 띠에 "장 번호 + 제목", 오른쪽 위에 해당 평가항목, 제목 아래 핵심 메시지 한 줄, 가운데 근거 도식 2~3개(PDM 표, 대상지 지도·사진, 지표 표, 일정표), 아래 성과·효과 한 줄(KEY POINT), 바닥글(사업명·쪽번호).
- **글자 크기:** 표지 사업명 32pt, 장 제목 24pt 굵게, 핵심 메시지 17pt 굵게, 본문 14pt(12pt 이상), KEY POINT 13pt 굵게, 바닥글 10pt.
- **디자인:** 짙은 청록과 청록을 주색, 황색을 강조색으로 쓰는 차분한 개발협력 배색입니다. 발주기관의 로고·상표는 쓰지 않습니다.
- **ODA 발표에서 꼭 보일 것:** PDM 논리(목표–성과–산출–활동), 지표의 기초선·목표치, 범분야 이슈, 현지 파트너와 지속가능성·출구전략, 위험 매트릭스. 제안사 실적·인력은 지어내지 않고 자리표시로 둡니다.

**확인이 필요한 값 (초안):** 공개된 KOICA 발표 PPTX는 찾지 못했고, KOICA가 공개한 설명회·사례 자료(16:9와 A4 가로가 섞임, 본문 12~16pt)를 참고해 배치와 배색을 설계했습니다. 사내 과거 발표자료로 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정·인용한 수치와 설명만 적었습니다.

```json style
{
  "format": "pptx",
  "id": "deck-oda-proposal",
  "title": "국내 ODA 사업 제안 발표 (PowerPoint, KOICA·EDCF)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 11,
    "note": "KOICA·EDCF 제안요청서 7건의 발표 규정(10분 안팎, 20장 이하, PDF 제출, 제안서 목차 순서)과 KOICA 공개 발표·설명 자료 4건의 쪽 크기(16:9, A4 가로)·글자 크기(12~16pt) 측정을 근거로 했다. 장 배치·배색은 설계한 값이다."
  },
  "slide": { "ratio": "16:9" },
  "theme": {
    "fontMajor": "맑은 고딕",
    "fontMinor": "맑은 고딕",
    "fontEastAsian": "맑은 고딕",
    "colors": {
      "dark": "#12324A",
      "light": "#FFFFFF",
      "accent": ["#0E7C86", "#F2A541", "#3A7D44", "#5B6FB0", "#C0504D", "#6B7280"]
    }
  },
  "roles": [
    {
      "id": "cover-title",
      "label": "표지 사업명",
      "kind": "title",
      "size": 32,
      "bold": true,
      "align": "left",
      "box": { "x": 0.07, "y": 0.32, "w": 0.86, "h": 0.18 }
    },
    {
      "id": "cover-subtitle",
      "label": "표지 문서명 (사업수행 제안 발표)",
      "kind": "subtitle",
      "size": 18,
      "bold": false,
      "align": "left",
      "box": { "x": 0.07, "y": 0.52, "w": 0.86, "h": 0.08 }
    },
    {
      "id": "cover-meta",
      "label": "표지 발표일·발주기관",
      "kind": "caption",
      "size": 13,
      "bold": false,
      "align": "left",
      "box": { "x": 0.07, "y": 0.8, "w": 0.86, "h": 0.07 }
    },
    {
      "id": "section-title",
      "label": "장 간지 제목",
      "kind": "title",
      "size": 32,
      "bold": true,
      "align": "left",
      "box": { "x": 0.07, "y": 0.42, "w": 0.86, "h": 0.14 }
    },
    {
      "id": "slide-title",
      "label": "장 제목 (장 번호 + 제목)",
      "kind": "title",
      "size": 24,
      "bold": true,
      "align": "left",
      "box": { "x": 0.04, "y": 0.04, "w": 0.72, "h": 0.09 }
    },
    {
      "id": "eval-tag",
      "label": "평가항목 표시",
      "kind": "label",
      "size": 11,
      "bold": true,
      "align": "right",
      "color": "accent1",
      "box": { "x": 0.78, "y": 0.06, "w": 0.18, "h": 0.06 }
    },
    {
      "id": "key-message",
      "label": "핵심 메시지",
      "kind": "subtitle",
      "size": 17,
      "bold": true,
      "align": "left",
      "color": "accent1",
      "box": { "x": 0.04, "y": 0.15, "w": 0.92, "h": 0.08 }
    },
    {
      "id": "body-1",
      "label": "본문",
      "kind": "body",
      "size": 14,
      "bold": false,
      "align": "left",
      "level": 1,
      "box": { "x": 0.04, "y": 0.25, "w": 0.92, "h": 0.57 }
    },
    {
      "id": "key-point",
      "label": "성과·효과 한 줄 (KEY POINT)",
      "kind": "label",
      "size": 13,
      "bold": true,
      "align": "left",
      "box": { "x": 0.04, "y": 0.84, "w": 0.92, "h": 0.07 }
    },
    {
      "id": "footer",
      "label": "바닥글 (사업명·쪽번호)",
      "kind": "caption",
      "size": 10,
      "bold": false,
      "align": "left",
      "color": "mute",
      "box": { "x": 0.04, "y": 0.94, "w": 0.92, "h": 0.04 }
    },
    {
      "id": "closing-title",
      "label": "마무리 제목",
      "kind": "title",
      "size": 32,
      "bold": true,
      "align": "center",
      "box": { "x": 0.1, "y": 0.4, "w": 0.8, "h": 0.16 }
    }
  ],
  "layouts": [
    {
      "id": "cover",
      "label": "표지",
      "use": "첫 장: 사업명(국가·분야), 문서명, 발표일·발주기관",
      "background": "dark",
      "decor": [
        { "shape": "rect", "box": { "x": 0, "y": 0.93, "w": 1, "h": 0.07 }, "fill": "accent1" }
      ],
      "elements": [
        { "role": "cover-title", "color": "light" },
        { "role": "cover-subtitle", "color": "light" },
        { "role": "cover-meta", "color": "light" }
      ]
    },
    {
      "id": "section",
      "label": "장 간지",
      "use": "제안서 장이 시작되는 장: 장 번호와 제목 한 줄",
      "background": "accent1",
      "elements": [{ "role": "section-title", "color": "light" }]
    },
    {
      "id": "content",
      "label": "본문 장",
      "use": "평가항목 하나를 보여 주는 장: 제목 띠, 평가항목 표시, 핵심 메시지, 근거 도식 2~3개(PDM 표·지도·지표·일정), 성과 한 줄, 바닥글",
      "background": "light",
      "decor": [
        {
          "shape": "rect",
          "box": { "x": 0.04, "y": 0.135, "w": 0.92, "h": 0.004 },
          "fill": "accent1"
        }
      ],
      "elements": [
        { "role": "slide-title", "color": "dark" },
        { "role": "eval-tag" },
        { "role": "key-message" },
        { "role": "body-1" },
        { "role": "key-point", "color": "accent2" },
        { "role": "footer" }
      ]
    },
    {
      "id": "closing",
      "label": "마무리",
      "use": "마지막 장: 사업 성공을 위한 약속 한 줄",
      "background": "dark",
      "elements": [{ "role": "closing-title", "color": "light" }]
    }
  ],
  "skeleton": [
    { "slot": "cover", "layout": "cover", "required": true },
    { "slot": "body", "layouts": ["content", "section"], "required": true, "repeat": true },
    { "slot": "closing", "layout": "closing" }
  ],
  "rules": [
    "At most 20 slides for a ~10-minute talk; the order follows the proposal's table of contents (RFP outline).",
    "One content slide per evaluation item: title band with the chapter number, the evaluation item at the top right, one key-message line under the title.",
    "The body shows 2-3 pieces of evidence (PDM table, target-site map or photo, indicator table with baseline and target, schedule) rather than paragraphs; body text 12pt or more.",
    "Show the PDM logic (Goal - Outcome - Output - Activity) and tie every activity to an Output; indicators carry baseline, target and means of verification, disaggregated by sex.",
    "Cover cross-cutting issues (gender, vulnerable groups, environment, human rights), local partners and recipient ownership, sustainability and exit, and a risk matrix including staff safety.",
    "A KEY POINT line at the bottom: the outcome or differentiator. Footer: project name left, page number right.",
    "Write commitments as '~한다' with numbers and dates; spell out each abbreviation the first time.",
    "Never invent the bidder's track record, staff, credit rating or partners: placeholders such as [회사 실적 기재]."
  ]
}
```
