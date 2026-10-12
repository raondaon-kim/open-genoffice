# 공공입찰 제안서 (PowerPoint, A4 가로)

국가·공공기관 입찰에 내는 PowerPoint 제안서·발표자료의 서식 초안입니다. **A4 가로(297×210mm)** 장에, 골격은 **표지 → 목차·조견표 → 장 간지와 본문 장을 반복 → 마무리** 입니다. 장 구성과 순서는 언제나 해당 제안요청서(RFP)의 제안서 목차를 따릅니다.

- **본문 장의 구성:** 위쪽 제목 띠에 "장-절 번호 + 제목"(예: Ⅱ-2 추진전략), 오른쪽 위에 평가항목·요구사항 ID 표시, 제목 아래 핵심 메시지 한 줄(헤드메시지), 가운데 본문(도식·표·절차도가 70~80%), 아래 KEY POINT 상자(차별점·효과 한 줄), 바닥글(사업명·쪽번호).
- **글자 크기:** 표지 사업명 30pt, 장 제목 20pt 굵게, 핵심 메시지 15pt 굵게, 본문 13pt(12pt 이상), KEY POINT 12pt 굵게, 바닥글 9pt.
- **디자인:** 남색과 파랑을 주색, 주황을 강조색으로 쓰는 단정한 공공 제안서 배색입니다. 표지·마무리는 남색 바탕, 간지는 파랑 바탕, 본문 장은 흰 바탕입니다.
- **쓰는 규칙:** 목차와 장 번호는 RFP 그대로, 분량은 배점에 비례, 쪽수 제한 준수, 표지 다음에 목차와 조견표, 모호한 표현 대신 "~한다"와 수치·기한, 요구사항 ID 빠짐없이, 회사 실적·인력은 지어내지 않고 자리표시, 블라인드 평가면 회사명·로고를 넣지 않습니다.
- **분량 (참고):** 발표 15~~20분이 흔하고, 발표자료는 20~~50장 안팎, 본문 제안서는 RFP가 쪽수를 정합니다.

**확인이 필요한 값 (초안):** 공개된 A4 가로 공공 제안서 원본은 찾지 못해(제출 제안서는 비공개), 배치와 배색은 공개 RFP의 작성 규칙과 흔한 제안서 구성에 맞춰 설계한 값입니다. 사내 과거 제안서로 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정·인용한 수치와 설명만 적었습니다.

```json style
{
  "format": "pptx",
  "id": "deck-bid-proposal",
  "title": "공공입찰 제안서 (PowerPoint, A4 가로)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 21,
    "note": "공개 제안요청서 17건의 제안서·발표자료 작성 규칙(A4, 쪽수 제한, 쪽번호, 발표 시간, 블라인드)과 공개 제안서형 PPT 4건(16:9)의 글자 크기 측정을 근거로 했다. A4 가로 원본은 공개된 것이 없어 장 배치·배색은 설계한 값이다."
  },
  "slide": { "ratio": "A4" },
  "theme": {
    "fontMajor": "맑은 고딕",
    "fontMinor": "맑은 고딕",
    "fontEastAsian": "맑은 고딕",
    "colors": {
      "dark": "#1E2B4A",
      "light": "#FFFFFF",
      "accent": ["#1F5FAD", "#E8792B", "#2E8B6E", "#7A5AA6", "#C0392B", "#6B7280"]
    }
  },
  "roles": [
    {
      "id": "cover-title",
      "label": "표지 사업명",
      "kind": "title",
      "size": 30,
      "bold": true,
      "align": "left",
      "box": { "x": 0.08, "y": 0.34, "w": 0.84, "h": 0.16 }
    },
    {
      "id": "cover-subtitle",
      "label": "표지 문서명 (기술제안서·제안 발표)",
      "kind": "subtitle",
      "size": 18,
      "bold": false,
      "align": "left",
      "box": { "x": 0.08, "y": 0.52, "w": 0.84, "h": 0.08 }
    },
    {
      "id": "cover-meta",
      "label": "표지 제출일·제출처",
      "kind": "caption",
      "size": 13,
      "bold": false,
      "align": "left",
      "box": { "x": 0.08, "y": 0.8, "w": 0.84, "h": 0.07 }
    },
    {
      "id": "section-title",
      "label": "장 간지 제목",
      "kind": "title",
      "size": 30,
      "bold": true,
      "align": "left",
      "box": { "x": 0.08, "y": 0.42, "w": 0.84, "h": 0.14 }
    },
    {
      "id": "slide-title",
      "label": "장 제목 (장-절 번호 + 제목)",
      "kind": "title",
      "size": 20,
      "bold": true,
      "align": "left",
      "box": { "x": 0.04, "y": 0.035, "w": 0.74, "h": 0.07 }
    },
    {
      "id": "eval-tag",
      "label": "평가항목·요구사항 ID 표시",
      "kind": "label",
      "size": 10,
      "bold": true,
      "align": "right",
      "color": "accent1",
      "box": { "x": 0.8, "y": 0.045, "w": 0.16, "h": 0.05 }
    },
    {
      "id": "key-message",
      "label": "핵심 메시지 (헤드메시지)",
      "kind": "subtitle",
      "size": 15,
      "bold": true,
      "align": "left",
      "color": "accent1",
      "box": { "x": 0.04, "y": 0.125, "w": 0.92, "h": 0.07 }
    },
    {
      "id": "body-1",
      "label": "본문",
      "kind": "body",
      "size": 13,
      "bold": false,
      "align": "left",
      "level": 1,
      "box": { "x": 0.04, "y": 0.21, "w": 0.92, "h": 0.62 }
    },
    {
      "id": "key-point",
      "label": "KEY POINT (차별점·효과 한 줄)",
      "kind": "label",
      "size": 12,
      "bold": true,
      "align": "left",
      "box": { "x": 0.04, "y": 0.85, "w": 0.92, "h": 0.06 }
    },
    {
      "id": "footer",
      "label": "바닥글 (사업명·쪽번호)",
      "kind": "caption",
      "size": 9,
      "bold": false,
      "align": "left",
      "color": "mute",
      "box": { "x": 0.04, "y": 0.945, "w": 0.92, "h": 0.035 }
    },
    {
      "id": "closing-title",
      "label": "마무리 제목",
      "kind": "title",
      "size": 30,
      "bold": true,
      "align": "center",
      "box": { "x": 0.1, "y": 0.4, "w": 0.8, "h": 0.14 }
    }
  ],
  "layouts": [
    {
      "id": "cover",
      "label": "표지",
      "use": "첫 장: 사업명, 문서명(기술제안서/제안 발표), 제출일·제출처 — 회사명은 RFP가 허용할 때만",
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
      "use": "장(Ⅰ~Ⅶ)이 시작되는 장: 장 번호와 제목 한 줄",
      "background": "accent1",
      "elements": [{ "role": "section-title", "color": "light" }]
    },
    {
      "id": "content",
      "label": "본문 장",
      "use": "평가항목·요구사항 하나를 답하는 장: 제목 띠, 오른쪽 위 평가항목/요구사항 ID, 핵심 메시지 한 줄, 도식·표 중심 본문, KEY POINT, 바닥글",
      "background": "light",
      "decor": [
        {
          "shape": "rect",
          "box": { "x": 0.04, "y": 0.108, "w": 0.92, "h": 0.004 },
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
    "Order and numbering follow the RFP's proposal table of contents (제안서 목차) exactly; an item that does not apply still gets a page saying 해당사항 없음.",
    "After the cover: a table of contents page, then a cross-reference page (조견표) mapping each evaluation item (평가항목) to its page.",
    "One content page answers one evaluation item or requirement: title band 'chapter-section number + title' (e.g. Ⅱ-2 추진전략), the evaluation item or requirement ID (SFR-001 …) at the top right.",
    "Under the title, one key-message line (헤드메시지): the conclusion the evaluator should take from the page.",
    "The body is diagrams, comparison tables, process flows and schedules (70-80% of the page), not paragraphs; body text 12pt or more; one or two tables/diagrams per page.",
    "A KEY POINT line at the bottom: the differentiator or the measurable effect.",
    "Footer: project name at the left, page number at the right; no company name or logo when the RFP asks for blind evaluation.",
    "Pages per chapter in proportion to the evaluation points; respect the RFP page limit.",
    "Write commitments as '~한다' with numbers and dates; never '~할 수 있다', '가능하다', '고려하고 있다'.",
    "Never invent facts about the bidder (history, staff, past projects, certifications): put placeholders such as [회사 실적 기재]."
  ]
}
```
