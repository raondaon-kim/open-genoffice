# 공공입찰 기술제안서 (한글)

국가·공공기관 입찰(협상에 의한 계약)에 내는 기술제안서의 서식 초안입니다. 골격은 **표지 → 목차 → 장(Ⅰ~Ⅶ)과 그 아래 절·항목** 입니다. 실제 장 구성과 순서는 언제나 **해당 제안요청서(RFP)의 제안서 목차**를 따릅니다.

- **표준 목차 (조달청 별지 제5호서식, SW개발 예시):** Ⅰ 일반현황(입찰자 현황, 수행조직·업무분장, 핵심투입인력) → Ⅱ 전략 및 방법론(사업이해도, 추진전략, 적용기술, 표준프레임워크, 개발방법론) → Ⅲ 기술 및 기능(시스템장비구성, 기능, 보안, 데이터, 시스템운영, 제약사항) → Ⅳ 성능 및 품질(성능, 품질, 인터페이스, 테스트) → Ⅴ 프로젝트 관리(관리방법론, 일정계획, 개발장비) → Ⅵ 프로젝트 지원(품질보증, 시험운영, 교육훈련, 유지보수, 기밀보안, 비상대책) → Ⅶ 그 밖의 사항. 용역·연구 사업은 제안개요 → 제안사 현황 → 과업수행 계획 → 관리 → 기타 순서가 많습니다.
- **단계 부호:** `Ⅰ.`(장, 15pt 굵게) → `1.`(절, 13pt 굵게) → `가.`(13pt) → `1)`(13pt) → `o`(13pt) → `-`(13pt) → `*`(주석 12pt). 공공기관 RFP의 서식표(Ⅰ 15pt 굵게, 1. 13pt 굵게, 가. 13pt, o 13pt, * 12pt 줄간격 130)와 같습니다. 본문 줄간격은 160%, 개조식으로 씁니다.
- **표지:** 사업명(24pt 굵게)과 "기술제안서"(30pt 굵게)를 가운데, 제출일·제출처(15pt)를 아래에 둡니다. 회사명을 가리라는 RFP(블라인드 평가)는 표지와 본문에 회사명·로고를 넣지 않습니다.
- **쪽 설정:** A4 세로(일부 쪽 가로 허용이 흔함), 여백 좌우 20mm·위아래 15mm 안팎. 쪽번호는 아래 가운데. 표 안 글자는 10~11pt가 흔합니다.
- **쓰는 규칙 (RFP에서 자주 나오는 조항):**
  - 목차와 장 번호는 RFP가 정한 그대로, 해당 없는 항목도 빼지 말고 "해당사항 없음"으로 둡니다.
  - 표지 다음에 목차, 그다음 평가항목별 쪽수를 적은 조견표를 둡니다(조달청 기준은 조견표를 요구합니다).
  - 분량은 평가 배점에 비례해 나누고, RFP의 쪽수 제한(예: 50쪽 이하, 표지 포함 여부)을 지킵니다.
  - "~할 수 있다", "가능하다", "고려하고 있다" 같은 표현은 이행하지 않는 것으로 평가되므로 "~한다"와 수치·기한으로 씁니다.
  - 약어는 약어표로 정리하고 한글로 씁니다.
  - 요구사항 ID(SFR-001, SER-002 …)가 있으면 해당 절 제목이나 첫 줄에 ID를 적고 빠짐없이 답합니다.
  - 회사 연혁·실적·인력·인증처럼 RFP에 없는 사실은 지어내지 않고 [회사 실적 기재] 같은 자리표시로 둡니다.
- **글꼴 (참고):** 공공 문서에는 휴먼명조(본문)와 HY헤드라인M·고딕(제목·표)이 많습니다. 이 도구는 글꼴을 지정하지 않으므로 필요하면 한글에서 바꿉니다.

**확인이 필요한 값 (초안):** 실제 제출 제안서는 비공개라 공개 RFP의 작성 규칙과 서식표, 공공기관 계획서 서식에서 잰 값으로 만들었습니다. 사내 과거 제안서로 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정·인용한 수치와 설명만 적었습니다.

```json style
{
  "id": "bid-proposal",
  "title": "공공입찰 기술제안서 (한글)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 9,
    "note": "공개 제안요청서 7건(HWP, 조달청·연구기관·지자체 출연기관)의 쪽 설정과 글자 크기 측정, SPRI 제안요청서의 제안서 서식표(Ⅰ 15pt 굵게 160%, 1. 13pt 굵게, 가.·o 13pt, * 12pt 130%), 공공기관 사업수행계획서 서식(본문 13pt 160%)을 근거로 했다. 목차는 조달청 협상에 의한 계약 제안서평가 세부기준 별지 제5호서식과 SW 기술성 평가기준 지침을 따른다. 실제 제출 제안서는 비공개라 측정하지 못했다."
  },
  "page": {
    "paper": "A4 세로",
    "marginMm": { "left": 20, "right": 20, "top": 15, "bottom": 15 },
    "settable": false
  },
  "roles": [
    {
      "id": "cover-doc",
      "label": "표지 문서명 (기술제안서)",
      "marker": "text",
      "lead": 0,
      "size": 30,
      "bold": true,
      "align": "center",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "cover-title",
      "label": "표지 사업명",
      "marker": "text",
      "lead": 0,
      "size": 24,
      "bold": true,
      "align": "center",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "cover-meta",
      "label": "표지 제출일·제출처",
      "marker": "text",
      "lead": 0,
      "size": 15,
      "bold": false,
      "align": "center",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "toc-title",
      "label": "목차 제목",
      "marker": "text",
      "lead": 0,
      "size": 17,
      "bold": true,
      "align": "center",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "toc-line",
      "label": "목차 줄 (장·절과 쪽)",
      "marker": "text",
      "lead": 0,
      "size": 13,
      "bold": false,
      "align": "left",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "chapter",
      "label": "장 (Ⅰ.)",
      "marker": "Ⅰ.",
      "lead": 0,
      "size": 15,
      "bold": true,
      "align": "left",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "section",
      "label": "절 (1.)",
      "marker": "1.",
      "lead": 0,
      "size": 13,
      "bold": true,
      "align": "left",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "item-1",
      "label": "항 (가.)",
      "marker": "가.",
      "lead": 1,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "item-2",
      "label": "목 (1))",
      "marker": "1)",
      "lead": 2,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "bullet",
      "label": "세부 (o)",
      "marker": "o",
      "lead": 3,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "dash",
      "label": "세부 (-)",
      "marker": "-",
      "lead": 5,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "note",
      "label": "주석 (*)",
      "marker": "*",
      "lead": 5,
      "size": 12,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 130
    }
  ],
  "skeleton": [
    { "slot": "cover-title", "role": "cover-title", "required": true },
    { "slot": "cover-doc", "role": "cover-doc", "required": true },
    { "slot": "cover-meta", "role": "cover-meta" },
    { "slot": "toc", "roles": ["toc-title", "toc-line"], "repeat": true },
    {
      "slot": "body",
      "roles": ["chapter", "section", "item-1", "item-2", "bullet", "dash", "note"],
      "required": true,
      "repeat": true
    }
  ]
}
```
