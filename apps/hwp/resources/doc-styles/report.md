# 보고서 (한글, 서술식)

조사·검토 결과를 장과 절, 문단으로 풀어 쓰는 보고서 서식 초안입니다. 문서 쓰기(write_report)가 한글 편집기에서 스타일을 지정받지 않았을 때 씁니다. 골격은 **제목 → 본문(장 제목·절 제목·소제목, 문단, 글머리·번호 목록, 표)** 입니다.

- **구조:** Word의 보고서 서식(docx-report)과 같은 단계입니다. 장 제목 15pt 굵게, 절 제목 13pt 굵게, 소제목 12pt 굵게, 본문 11pt입니다.
- **문단:** 양쪽 정렬, 줄간격 160%, 문단 뒤 간격 4pt입니다. 장 제목 앞에는 12pt, 절 제목 앞에는 8pt 간격을 둡니다.
- **목록:** 글머리 항목은 `-`, 번호 항목은 `1.`처럼 글자로 씁니다. 두 칸 들여 씁니다.
- **표:** 표는 역할이 아니라 표 블록으로 들어갑니다. 첫 행이 머리 행입니다.
- **쪽 설정:** A4 세로, 여백 좌 30 · 우 30 · 상 20 · 하 15mm (참고값, 만들어진 문서에서 직접 지정).

**확인이 필요한 값 (초안):** 측정한 한글 서식이 아니라 Word 보고서 서식(docx-report)의 단계와 크기를 한글 문서에 옮긴 값입니다. 사내 보고서 양식이 있으면 담당자가 값을 맞추고 이 표시를 지웁니다.

```json style
{
  "id": "report",
  "title": "보고서 (한글, 서술식)",
  "version": 1,
  "draft": true,
  "evidence": {
    "documents": 6,
    "note": "Word 보고서 서식(docx-report, 공개 보고서 docx 6건에서 잰 값)의 제목 단계와 크기 비율을 한글 서술식 보고서로 옮겼다. 한글 문서에서 직접 잰 값이 아니므로 사람이 확인해야 한다."
  },
  "page": {
    "paper": "A4 세로",
    "marginMm": {
      "left": 30,
      "right": 30,
      "top": 20,
      "bottom": 15
    },
    "settable": false
  },
  "roles": [
    {
      "id": "title",
      "label": "문서 제목",
      "marker": "text",
      "lead": 0,
      "size": 20,
      "bold": true,
      "align": "center",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 1200,
      "lineSpacing": 160
    },
    {
      "id": "chapter",
      "label": "장 제목",
      "marker": "N.",
      "lead": 0,
      "size": 15,
      "bold": true,
      "align": "left",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 1200,
      "spacingAfter": 400,
      "lineSpacing": 160
    },
    {
      "id": "section",
      "label": "절 제목",
      "marker": "N.N",
      "lead": 0,
      "size": 13,
      "bold": true,
      "align": "left",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 800,
      "spacingAfter": 300,
      "lineSpacing": 160
    },
    {
      "id": "subsection",
      "label": "소제목",
      "marker": "text",
      "lead": 0,
      "size": 12,
      "bold": true,
      "align": "left",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 400,
      "spacingAfter": 200,
      "lineSpacing": 160
    },
    {
      "id": "body",
      "label": "본문",
      "marker": "text",
      "lead": 0,
      "size": 11,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 400,
      "lineSpacing": 160
    },
    {
      "id": "bullet",
      "label": "글머리 항목 (-)",
      "marker": "-",
      "lead": 2,
      "size": 11,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 200,
      "lineSpacing": 160
    },
    {
      "id": "numbered",
      "label": "번호 항목 (1.)",
      "marker": "N.",
      "lead": 2,
      "size": 11,
      "bold": false,
      "align": "justify",
      "marginLeft": 0,
      "marginRight": 0,
      "indent": 0,
      "spacingBefore": 0,
      "spacingAfter": 200,
      "lineSpacing": 160
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
      "roles": ["chapter", "section", "subsection", "body", "bullet", "numbered"],
      "repeat": true
    }
  ]
}
```
