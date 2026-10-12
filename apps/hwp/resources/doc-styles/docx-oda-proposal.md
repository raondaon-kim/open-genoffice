# 국내 ODA 사업 제안서 (Word, KOICA·EDCF)

KOICA·EDCF 사업수행기관·컨설팅 입찰에 Word로 내는 국문 제안서의 서식 초안입니다. 골격은 **표지 → 조견표·목차 → 장(Ⅰ~Ⅳ)과 절·항·본문** 이며, 장 구성과 분량은 언제나 해당 제안요청서(과업지시서)의 제안서 목차와 분량 비율을 따릅니다. 한글 ODA 제안서 양식과 같은 근거이고, Word에 맞춰 본문은 바탕(영문 Times New Roman)을 씁니다.

- **KOICA 표준 목차:** Ⅰ 제안사 소개(≤10%) → Ⅱ 기술 부문(≤50%: 사업이해도, 세부실행방안) → Ⅲ 사업관리 부문(≤30%: 투입인력, 성과관리, 일정, 위험·안전, 사후관리, 품질, 홍보) → Ⅳ 제안내용 고도화(≤10%).
- **EDCF 표준 목차:** Ⅰ 과업 이해 → Ⅱ 수행계획 → Ⅲ 조직·인력 → Ⅳ 성과·품질 제고 → 첨부 서식.
- **단계:** 장 `Ⅰ. 제목`(제목 1, 16pt 굵게) → 절 `1. 제목`(제목 2, 14pt 굵게) → 항 `1-1. 제목`(제목 3, 13pt 굵게) → 본문(13pt, 줄간격 1.6배, 개조식) → 글머리 항목(13pt) → 주석(`*`, 11pt).
- **쪽 설정:** A4 세로, 여백 좌우 25mm·위 20mm·아래 15mm(레이아웃 탭에서 지정), 쪽번호 아래 가운데.
- **ODA 제안서에서 꼭 지킬 것:** 모든 활동을 PDM 산출물·성과에 연결, 지표마다 산식·기초선·목표치·검증수단(성별 분리), 범분야 이슈(성평등·취약계층·환경·인권), 현지 파트너·수원국 오너십·지속가능성·출구전략, 위험 매트릭스(가능성×영향, 안전 포함), 자료에 근거한 주장, 약어는 처음에 풀어 쓰기, "~한다"로 확정, 제안사 실적·인력·신용등급은 지어내지 않고 [회사 실적 기재] 같은 자리표시.

**확인이 필요한 값 (초안):** 실제 제출 제안서는 비공개라 KOICA·EDCF 제안요청서의 서식 규정(본문 13pt, 160%, 여백 25/20/15mm)과 KOICA 공식 Word 양식(제목 14/12/11pt, 1. / 1.1 번호)을 근거로 했습니다. 사내 과거 제안서로 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정·인용한 수치와 설명만 적었습니다.

```json style
{
  "format": "docx",
  "id": "docx-oda-proposal",
  "title": "국내 ODA 사업 제안서 (Word, KOICA·EDCF)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 12,
    "note": "KOICA·EDCF 제안요청서 7건의 서식 규정(본문 13pt, 줄간격 160%, 여백 좌우 25·위 20·아래 15mm, Ⅰ. 16pt·1. 13pt 굵게)과 KOICA 공식 제안서 양식(Word 1건, HWP 4건)의 측정값을 근거로 했다. 실제 제출 제안서는 비공개다."
  },
  "page": {
    "paper": "A4",
    "orientation": "portrait",
    "marginMm": { "left": 25, "right": 25, "top": 20, "bottom": 15 },
    "settable": true
  },
  "fonts": { "latin": "Times New Roman", "eastAsian": "바탕" },
  "roles": [
    {
      "id": "title",
      "label": "표지 사업명",
      "kind": "title",
      "size": 22,
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
      "label": "표지 문서명 (사업수행 제안서)",
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
      "label": "표지 제출일·발주기관",
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
      "label": "목차·조견표 줄",
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
      "size": 16,
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
      "size": 14,
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
      "label": "항 (1-1.)",
      "kind": "heading",
      "heading": 3,
      "size": 13,
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
      "size": 13,
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
      "size": 13,
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
      "size": 11,
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
