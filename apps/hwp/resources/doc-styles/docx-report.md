# 보고서 (Word)

조사·진행 결과를 보고하는 문서의 서식 초안입니다. 골격은 **제목 → 본문(대제목·중제목·소제목, 본문, 글머리 목록)** 입니다.

- **측정 근거:** 공개 저장소의 이 종류 문서 7건을 측정했고, 본문을 11pt로 쓰는 6건 계열의 값을 담았습니다. 한글 문서는 6건뿐이라 대부분 영문 문서의 값입니다.
- **본문:** 11pt, 왼쪽 정렬, 줄간격 1.15배, 문단 뒤 간격 8pt, 글꼴 Cambria.
- **제목 단계:** 대제목 14pt, 중제목 12pt, 소제목 11pt. (소제목은 측정값이 아니라 유도한 값)
- **쪽 설정:** A4 세로, 여백 좌 31.8 · 우 31.8 · 상 25.4 · 하 25.4mm (참고값입니다. 워드의 레이아웃 탭에서 지정하세요).

**확인이 필요한 값 (초안):** 영문 문서 중심의 값이므로 한국 사내 양식의 글꼴(예: 맑은 고딕)과 크기는 담당자가 확인해야 합니다. 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정한 수치와 설명만 적었습니다.

```json style
{
  "format": "docx",
  "id": "docx-report",
  "title": "보고서 (Word)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 6,
    "note": "GitHub 공개 저장소의 보고서 계열 docx 7건 중 본문을 11pt로 쓰는 6건(한글 문서 6건)에서 역할별 최빈값과 중앙값을 쟀다. 대부분 영문 문서이므로 한국 사내 양식은 사람이 확인해야 한다. 소제목은 측정값이 아니라 본문·대제목에서 유도했다."
  },
  "page": {
    "paper": "A4",
    "orientation": "portrait",
    "marginMm": {
      "left": 31.8,
      "right": 31.8,
      "top": 25.4,
      "bottom": 25.4
    },
    "settable": true
  },
  "fonts": {
    "latin": "Cambria"
  },
  "roles": [
    {
      "id": "title",
      "label": "문서 제목",
      "kind": "title",
      "size": 26,
      "bold": false,
      "align": "left",
      "color": "#17365D",
      "spacingBefore": 0,
      "spacingAfter": 14,
      "lineSpacing": 1,
      "indentLeft": 0,
      "indentFirstLine": 0
    },
    {
      "id": "heading-1",
      "label": "대제목",
      "kind": "heading",
      "size": 14,
      "bold": true,
      "align": "left",
      "color": "#365F91",
      "spacingBefore": 24,
      "spacingAfter": 0,
      "lineSpacing": 1.15,
      "indentLeft": 0,
      "indentFirstLine": 0,
      "heading": 1
    },
    {
      "id": "heading-2",
      "label": "중제목",
      "kind": "heading",
      "size": 12,
      "bold": true,
      "align": "left",
      "spacingBefore": 10,
      "spacingAfter": 0,
      "lineSpacing": 1.15,
      "indentLeft": 0,
      "indentFirstLine": 0,
      "heading": 2
    },
    {
      "id": "heading-3",
      "label": "소제목",
      "kind": "heading",
      "size": 11,
      "bold": true,
      "align": "left",
      "spacingBefore": 7,
      "spacingAfter": 0,
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
      "bold": false,
      "align": "left",
      "spacingBefore": 0,
      "spacingAfter": 10,
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
