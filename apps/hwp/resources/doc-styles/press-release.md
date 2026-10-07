# 보도자료

정부·지자체 보도자료의 본문 서식입니다. 골격은 **제목 → 담당 부서·날짜 → 본문(□ 항목 아래 ○, 그 아래 -) → 붙임** 입니다.

- **단계 부호:** `□`(앞쪽 공백 0) → `○`(공백 1) → `-`(공백 3) → `※`(참고, 공백 4). 모두 양쪽 정렬이고 내어쓰기가 있으며, □와 ○는 앞에 간격(1000)이 있어 묶음이 구분됩니다.
- **크기:** 본문 계열은 문서마다 14pt 또는 15pt로 나뉩니다. 여기서는 □를 14pt로 쓰는 가장 큰 계열의 값입니다. 이 계열에서도 -는 15pt로 쓰는 문서가 많았습니다(표본 30개 중 57%).
- **쪽 설정:** A4 세로, 여백 좌 20 · 우 20 · 상 15 · 하 15mm (98건 중 67건, 참고값).
- **만들지 않는 것:** 제목 칸의 표와 기관 로고는 만들지 않고 일반 문단으로 표현합니다.

**확인이 필요한 값 (초안):** 14pt 계열 값입니다. 15pt 계열(18건)의 값은 다를 수 있고, 제목(19pt)과 담당 부서 줄(10pt, 오른쪽)은 전체 99건의 일반 문단에서 가장 흔한 값입니다. 사람이 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정한 수치와 설명만 적었습니다.

```json style
{
  "id": "press-release",
  "title": "보도자료",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 22,
    "note": "정부 보도자료 99건 중 □를 14pt로 쓰는 가장 큰 계열 22건에서 마커별 최빈값(정렬·크기·공백)과 중앙값(여백·내어쓰기·간격)을 쟀다. 같은 계열이라도 -의 크기는 문서마다 달랐다."
  },
  "page": {
    "paper": "A4 세로",
    "marginMm": {
      "left": 20,
      "right": 20,
      "top": 15,
      "bottom": 15
    },
    "settable": false
  },
  "roles": [
    {
      "id": "headline",
      "label": "제목(큰 글씨)",
      "marker": "text",
      "lead": 0,
      "size": 19,
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
      "id": "dept-line",
      "label": "담당 부서·날짜 줄",
      "marker": "text",
      "lead": 0,
      "size": 10,
      "bold": false,
      "align": "right",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "box-1",
      "label": "1단계 항목 (□)",
      "marker": "□",
      "lead": 0,
      "size": 14,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": -4032,
      "spacingBefore": 1000,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "circle-1",
      "label": "2단계 항목 (○)",
      "marker": "○",
      "lead": 1,
      "size": 14,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": -5746,
      "spacingBefore": 1000,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "dash-1",
      "label": "3단계 항목 (-)",
      "marker": "-",
      "lead": 3,
      "size": 15,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": -7040,
      "spacingBefore": 1200,
      "spacingAfter": 0,
      "lineSpacing": 155
    },
    {
      "id": "note",
      "label": "참고 (※)",
      "marker": "※",
      "lead": 4,
      "size": 12,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": -8002,
      "spacingBefore": 600,
      "spacingAfter": 0,
      "lineSpacing": 154
    },
    {
      "id": "body-text",
      "label": "이어 쓰는 본문 줄",
      "marker": "text",
      "lead": 2,
      "size": 14,
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
      "id": "attachment",
      "label": "붙임",
      "marker": "붙임",
      "lead": 0,
      "size": 14,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 160
    }
  ],
  "skeleton": [
    {
      "slot": "headline",
      "role": "headline",
      "required": true
    },
    {
      "slot": "dept",
      "role": "dept-line"
    },
    {
      "slot": "body",
      "roles": ["box-1", "circle-1", "dash-1", "body-text", "note"],
      "required": true,
      "repeat": true
    },
    {
      "slot": "attachment",
      "role": "attachment"
    }
  ]
}
```
