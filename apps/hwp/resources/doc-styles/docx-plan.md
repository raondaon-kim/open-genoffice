# 계획서 (Word)

사업·프로젝트 계획을 설명하는 문서의 서식 초안입니다. 골격은 **제목 → 본문(대제목·중제목·소제목, 본문, 글머리 목록)** 입니다.

- **측정 근거:** 공개 저장소의 이 종류 문서 31건을 측정했고, 본문을 11pt로 쓰는 12건 계열의 값을 담았습니다. 한글 문서는 0건뿐이라 대부분 영문 문서의 값입니다.
- **본문:** 11pt, 왼쪽 정렬, 줄간격 1.15배, 문단 뒤 간격 8pt, 글꼴 Arial.
- **제목 단계:** 대제목 15pt, 중제목 14pt, 소제목 12pt.
- **쪽 설정:** A4 세로, 여백 좌 25.4 · 우 25.4 · 상 25.4 · 하 25.4mm (참고값입니다. 워드의 레이아웃 탭에서 지정하세요).

**확인이 필요한 값 (초안):** 영문 문서 중심의 값이므로 한국 사내 양식의 글꼴(예: 맑은 고딕)과 크기는 담당자가 확인해야 합니다. 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정한 수치와 설명만 적었습니다.

```json style
{
  "format": "docx",
  "id": "docx-plan",
  "title": "계획서 (Word)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 12,
    "note": "GitHub 공개 저장소의 계획서 계열 docx 31건 중 본문을 11pt로 쓰는 12건(한글 문서 0건)에서 역할별 최빈값과 중앙값을 쟀다. 대부분 영문 문서이므로 한국 사내 양식은 사람이 확인해야 한다."
  },
  "page": {
    "paper": "A4",
    "orientation": "portrait",
    "marginMm": {
      "left": 25.4,
      "right": 25.4,
      "top": 25.4,
      "bottom": 25.4
    },
    "settable": true
  },
  "fonts": {
    "latin": "Arial"
  },
  "roles": [
    {
      "id": "title",
      "label": "문서 제목",
      "kind": "title",
      "size": 26,
      "bold": false,
      "align": "left",
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 1.15,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "heading-1",
      "label": "대제목",
      "kind": "heading",
      "size": 15,
      "bold": false,
      "align": "left",
      "spacingBefore": 20,
      "spacingAfter": 6,
      "lineSpacing": 1.15,
      "indentLeft": 0,
      "indentFirstLine": 0,
      "heading": 1
    },
    {
      "id": "heading-2",
      "label": "중제목",
      "kind": "heading",
      "size": 14,
      "bold": true,
      "align": "left",
      "spacingBefore": 14,
      "spacingAfter": 6,
      "lineSpacing": 1.15,
      "indentLeft": 0,
      "indentFirstLine": 0,
      "heading": 2
    },
    {
      "id": "heading-3",
      "label": "소제목",
      "kind": "heading",
      "size": 12,
      "bold": true,
      "align": "left",
      "spacingBefore": 10,
      "spacingAfter": 5,
      "lineSpacing": 1.15,
      "indentLeft": 0,
      "indentFirstLine": 0,
      "heading": 3
    },
    {
      "id": "body",
      "label": "본문",
      "kind": "body",
      "size": 11,
      "bold": false,
      "align": "left",
      "spacingBefore": 0,
      "spacingAfter": 8,
      "lineSpacing": 1.15,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "list",
      "label": "글머리 목록",
      "kind": "list",
      "size": 11,
      "bold": true,
      "align": "left",
      "spacingBefore": 0,
      "spacingAfter": 5,
      "lineSpacing": 1.15,
      "indentLeft": 36,
      "indentFirstLine": -18,
      "bullet": "bullet"
    }
  ],
  "skeleton": [
    {
      "slot": "title",
      "role": "title",
      "required": true
    },
    {
      "slot": "body",
      "roles": ["heading-1", "heading-2", "heading-3", "body", "list"],
      "required": true,
      "repeat": true
    }
  ]
}
```
