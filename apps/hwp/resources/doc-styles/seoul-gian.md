# 서울시 기안문(공문)

서울시 행정기관의 기안문 서식입니다. 골격은 **두문(행정기관명, 수신, 제목) → 본문(항목) → 결문(붙임, 끝 표시, 발신 명의, 시행·연락처)** 입니다.

- **항목 부호:** `1.` → `가.` → `1)` → `가)` → `(1)` 순서로 내려갑니다. 단계가 한 칸 내려갈 때마다 앞쪽 공백이 2칸씩 늘어나는 관례를 따릅니다(역할의 `lead`).
- **본문 크기·줄간격:** 서울시 기안문 서식(seoul-1)에서 13pt, 양쪽 정렬, 줄간격 180%로 쟀습니다.
- **쪽 설정:** A4 세로, 여백 좌 20 · 우 15 · 상 20 · 하 15mm (참고값입니다. 엔진은 쪽 여백과 글꼴을 바꾸지 못하므로 만들어진 문서에서 직접 지정해야 합니다).
- **만들지 않는 것:** 머리 표(로고, 기관명 칸의 테두리, 결재란)는 이번 버전에서 만들지 않고 일반 문단으로 표현합니다.

**확인이 필요한 값 (초안):** 두문·결문 역할(기관명, 수신, 제목, 발신 명의)의 크기와 정렬은 서식의 표 칸 안에 있어 엔진이 정렬을 읽을 수 없었습니다. 크기는 칸의 줄 높이로 쟀고 정렬은 관례값입니다. 단계별 들여쓰기 2칸도 관례값입니다. 사람이 확인하면 이 표시를 지웁니다.

출처는 공공누리 제4유형 서식이므로 원본 문서는 넣지 않고 측정한 수치와 설명만 적었습니다.

```json style
{
  "id": "seoul-gian",
  "title": "서울시 기안문(공문)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 2,
    "note": "서울시 기안문 서식 1개(seoul-1)와 공문 샘플 1개(f14)에서 잰 값. 두문·결문 역할의 정렬과 단계별 들여쓰기(2타씩)는 측정값이 아니라 관례값이어서 사람이 확인해야 한다."
  },
  "page": {
    "paper": "A4 세로",
    "marginMm": {
      "left": 20,
      "right": 15,
      "top": 20,
      "bottom": 15
    },
    "settable": false
  },
  "roles": [
    {
      "id": "org-name",
      "label": "행정기관명",
      "marker": "text",
      "lead": 0,
      "size": 20,
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
      "id": "recipient-line",
      "label": "수신",
      "marker": "text",
      "lead": 0,
      "size": 14,
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
      "id": "title-line",
      "label": "제목",
      "marker": "text",
      "lead": 0,
      "size": 14,
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
      "label": "1단계 항목 (1.)",
      "marker": "N.",
      "lead": 0,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 660,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "item-2",
      "label": "2단계 항목 (가.)",
      "marker": "가.",
      "lead": 2,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 660,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "item-3",
      "label": "3단계 항목 (1))",
      "marker": "N)",
      "lead": 4,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 660,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "item-4",
      "label": "4단계 항목 (가))",
      "marker": "가)",
      "lead": 6,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 660,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "item-5",
      "label": "5단계 항목 ((1))",
      "marker": "(N)",
      "lead": 8,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 660,
      "spacingBefore": 0,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "attachment",
      "label": "붙임",
      "marker": "붙임",
      "lead": 0,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 1000,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "end-mark",
      "label": "끝 표시",
      "marker": "끝",
      "lead": 0,
      "size": 13,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 1000,
      "spacingAfter": 0,
      "lineSpacing": 180
    },
    {
      "id": "sender-name",
      "label": "발신 명의",
      "marker": "text",
      "lead": 0,
      "size": 20,
      "bold": true,
      "align": "center",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 1000,
      "spacingAfter": 0,
      "lineSpacing": 160
    },
    {
      "id": "contact-line",
      "label": "시행·연락처",
      "marker": "text",
      "lead": 0,
      "size": 10,
      "bold": false,
      "align": "left",
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
      "slot": "org",
      "role": "org-name",
      "required": true
    },
    {
      "slot": "recipient",
      "role": "recipient-line",
      "required": true
    },
    {
      "slot": "title",
      "role": "title-line",
      "required": true
    },
    {
      "slot": "body",
      "roles": ["item-1", "item-2", "item-3", "item-4", "item-5"],
      "required": true,
      "repeat": true
    },
    {
      "slot": "attachment",
      "role": "attachment"
    },
    {
      "slot": "end",
      "role": "end-mark",
      "required": true
    },
    {
      "slot": "sender",
      "role": "sender-name"
    },
    {
      "slot": "contact",
      "role": "contact-line"
    }
  ]
}
```
