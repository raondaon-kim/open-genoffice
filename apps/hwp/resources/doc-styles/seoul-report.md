# 서울시 보고서(계획서)

서울시 보고서·계획서 서식입니다. 골격은 **표지(제목, 날짜) → 본문(대제목과 항목) → 붙임** 입니다.

- **단계 부호:** `□`(대제목, 17pt) → `○`(15pt, 앞쪽 공백 2) → `-`(14pt, 공백 4) → `▸`(13pt, 공백 6) 순서입니다. 크기가 단계마다 1~2pt씩 작아지고 공백이 2칸씩 늘어납니다. 줄간격은 모두 180%입니다.
- **표지:** 제목은 28pt 굵게 가운데, 날짜는 15pt 오른쪽 정렬입니다.
- **쪽 설정:** A4 세로, 여백 좌 18 · 우 18 · 상 12.7 · 하 12.7mm (참고값, 만들어진 문서에서 직접 지정).
- **원본에서의 □:** 원본은 글꼴 전용 기호로 대제목 부호를 씁니다. 여기서는 일반 □ 문자로 씁니다.

**확인이 필요한 값 (초안):** 표 안에 있는 표지·목차 문단은 정렬을 읽을 수 없어 표지 날짜의 정렬 등은 약식보고서(seoul-3) 한 건을 기준으로 했습니다. 사람이 확인하면 이 표시를 지웁니다.

공공누리 제4유형 서식이므로 원본은 넣지 않고 측정한 수치와 설명만 적었습니다.

```json style
{
  "id": "seoul-report",
  "title": "서울시 보고서(계획서)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 2,
    "note": "서울시 보고서(계획서) 서식(seoul-2)과 약식보고서 서식(seoul-3)에서 잰 값. 표지·목차 표 안의 문단과 ※ 설명 문단은 포함하지 않았다."
  },
  "page": {
    "paper": "A4 세로",
    "marginMm": {
      "left": 18,
      "right": 18,
      "top": 12.7,
      "bottom": 12.7
    },
    "settable": false
  },
  "roles": [
    {
      "id": "cover-title",
      "label": "표지 제목",
      "marker": "text",
      "lead": 0,
      "size": 28,
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
      "id": "cover-date",
      "label": "표지 날짜",
      "marker": "text",
      "lead": 0,
      "size": 15,
      "bold": false,
      "align": "right",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "heading-1",
      "label": "대제목 (□)",
      "marker": "□",
      "lead": 0,
      "size": 17,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "item-1",
      "label": "1단계 항목 (○)",
      "marker": "○",
      "lead": 2,
      "size": 15,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "item-2",
      "label": "2단계 항목 (-)",
      "marker": "-",
      "lead": 4,
      "size": 14,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "item-3",
      "label": "3단계 항목 (▸)",
      "marker": "▸",
      "lead": 6,
      "size": 13,
      "bold": false,
      "align": "left",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "attachment",
      "label": "붙임",
      "marker": "붙임",
      "lead": 0,
      "size": 15,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    }
  ],
  "skeleton": [
    {
      "slot": "cover-title",
      "role": "cover-title",
      "required": true
    },
    {
      "slot": "cover-date",
      "role": "cover-date"
    },
    {
      "slot": "body",
      "roles": ["heading-1", "item-1", "item-2", "item-3"],
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
