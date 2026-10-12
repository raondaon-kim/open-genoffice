# 공공입찰 기술제안서 (Word)

국가·공공기관 입찰(협상에 의한 계약)에 Word로 내는 기술제안서의 서식 초안입니다. 골격은 **표지 → 목차 → 장(Ⅰ~Ⅶ)과 그 아래 절·항·본문** 이며, 실제 장 구성과 순서는 언제나 **해당 제안요청서(RFP)의 제안서 목차**를 따릅니다. 한글 기술제안서 양식과 같은 근거로 만들었고, Word에 맞춰 맑은 고딕을 씁니다.

- **표준 목차 (조달청 별지 제5호서식, SW개발 예시):** Ⅰ 일반현황 → Ⅱ 전략 및 방법론 → Ⅲ 기술 및 기능 → Ⅳ 성능 및 품질 → Ⅴ 프로젝트 관리 → Ⅵ 프로젝트 지원 → Ⅶ 그 밖의 사항. 용역·연구 사업은 제안개요 → 제안사 현황 → 과업수행 계획 → 관리 → 기타가 많습니다.
- **단계:** 장 `Ⅰ. 제목`(제목 1, 15pt 굵게) → 절 `1. 제목`(제목 2, 13pt 굵게) → 항 `가. 제목`(제목 3, 12pt 굵게) → 본문(12pt, 줄간격 1.6배, 개조식) → 글머리 항목(12pt) → 주석(`*`, 10.5pt). 번호는 글자로 직접 씁니다(Ⅰ., 1., 가.).
- **표지:** 사업명(24pt 굵게)과 "기술제안서"(20pt 굵게)를 가운데, 제출일·제출처(14pt)를 아래에 둡니다. 블라인드 평가면 회사명·로고를 넣지 않습니다.
- **쪽 설정:** A4 세로, 여백 좌우 20mm·위아래 15mm 안팎(레이아웃 탭에서 지정). 쪽번호는 아래 가운데.
- **쓰는 규칙:** 목차와 장 번호는 RFP 그대로(해당 없으면 "해당사항 없음"), 표지 다음에 목차와 조견표(평가항목별 쪽), 분량은 배점에 비례하고 쪽수 제한 준수, "~할 수 있다·가능하다" 대신 "~한다"와 수치·기한, 요구사항 ID 빠짐없이, 약어표, 회사 연혁·실적·인력은 지어내지 않고 [회사 실적 기재] 같은 자리표시.

**확인이 필요한 값 (초안):** 실제 제출 제안서는 비공개라 공개 RFP의 작성 규칙과 서식표(본문 10~13pt, 줄간격 160%)를 Word 글꼴에 맞춰 옮긴 값입니다. 사내 과거 제안서로 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정·인용한 수치와 설명만 적었습니다.

```json style
{
  "format": "docx",
  "id": "docx-bid-proposal",
  "title": "공공입찰 기술제안서 (Word)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 9,
    "note": "공개 제안요청서 7건(HWP)의 쪽 설정·글자 크기 측정과 SPRI 제안서 서식표(Ⅰ 15pt 굵게, 1. 13pt 굵게, 본문 13pt 160%), 공공기관 계획서 서식을 근거로, RFP가 흔히 정하는 본문 10~12pt 이상·줄간격 160%를 Word 맑은 고딕에 맞춰 옮겼다. 목차는 조달청 별지 제5호서식과 SW 기술성 평가기준 지침을 따른다."
  },
  "page": {
    "paper": "A4",
    "orientation": "portrait",
    "marginMm": { "left": 20, "right": 20, "top": 15, "bottom": 15 },
    "settable": true
  },
  "fonts": { "latin": "맑은 고딕", "eastAsian": "맑은 고딕" },
  "roles": [
    {
      "id": "title",
      "label": "표지 사업명",
      "kind": "title",
      "size": 24,
      "bold": true,
      "align": "center",
      "spacingBefore": 120,
      "spacingAfter": 12,
      "lineSpacing": 1.3,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "subtitle",
      "label": "표지 문서명 (기술제안서)",
      "kind": "subtitle",
      "size": 20,
      "bold": true,
      "align": "center",
      "spacingBefore": 6,
      "spacingAfter": 60,
      "lineSpacing": 1.3,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "cover-meta",
      "label": "표지 제출일·제출처",
      "kind": "caption",
      "size": 14,
      "bold": false,
      "align": "center",
      "spacingBefore": 0,
      "spacingAfter": 6,
      "lineSpacing": 1.3,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "toc-line",
      "label": "목차 줄 (장·절과 쪽)",
      "kind": "other",
      "size": 12,
      "bold": false,
      "align": "left",
      "spacingBefore": 0,
      "spacingAfter": 2,
      "lineSpacing": 1.3,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "heading-1",
      "label": "장 (Ⅰ.)",
      "kind": "heading",
      "heading": 1,
      "size": 15,
      "bold": true,
      "align": "left",
      "spacingBefore": 18,
      "spacingAfter": 6,
      "lineSpacing": 1.3,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "heading-2",
      "label": "절 (1.)",
      "kind": "heading",
      "heading": 2,
      "size": 13,
      "bold": true,
      "align": "left",
      "spacingBefore": 12,
      "spacingAfter": 4,
      "lineSpacing": 1.3,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "heading-3",
      "label": "항 (가.)",
      "kind": "heading",
      "heading": 3,
      "size": 12,
      "bold": true,
      "align": "left",
      "spacingBefore": 6,
      "spacingAfter": 2,
      "lineSpacing": 1.3,
      "indentLeft": 10,
      "indentFirstLine": 0
    },
    {
      "id": "body",
      "label": "본문 (개조식)",
      "kind": "body",
      "size": 12,
      "bold": false,
      "align": "justify",
      "spacingBefore": 0,
      "spacingAfter": 4,
      "lineSpacing": 1.6,
      "indentLeft": 20,
      "indentFirstLine": 0
    },
    {
      "id": "bullet",
      "label": "글머리 항목 (o)",
      "kind": "list",
      "bullet": "bullet",
      "size": 12,
      "bold": false,
      "align": "justify",
      "spacingBefore": 0,
      "spacingAfter": 2,
      "lineSpacing": 1.6,
      "indentLeft": 34,
      "indentFirstLine": -14
    },
    {
      "id": "note",
      "label": "주석 (*)",
      "kind": "caption",
      "size": 10.5,
      "bold": false,
      "align": "left",
      "spacingBefore": 0,
      "spacingAfter": 4,
      "lineSpacing": 1.3,
      "indentLeft": 20,
      "indentFirstLine": 0
    }
  ],
  "skeleton": [
    { "slot": "cover-title", "role": "title", "required": true },
    { "slot": "cover-doc", "role": "subtitle", "required": true },
    { "slot": "cover-meta", "role": "cover-meta" },
    { "slot": "toc", "role": "toc-line", "repeat": true },
    {
      "slot": "body",
      "roles": ["heading-1", "heading-2", "heading-3", "body", "bullet", "note"],
      "required": true,
      "repeat": true
    }
  ]
}
```
