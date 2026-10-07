# 회사 소개·피치 (PowerPoint)

회사 소개, 서비스 소개, 투자 유치 발표 자료의 디자인된 서식 초안입니다. 짙은 남색과 보라·하늘색 강조색의 선명한 소개용 디자인으로, 골격은 **표지 → 본문 장(본문·카드 3개·구역 제목)을 반복 → 마무리** 입니다.

- **디자인:** 표지와 마무리는 어두운 배경에 강조색 도형, 구역 제목 장은 강조색 배경, 본문 장은 흰 배경에 제목 옆 강조 막대와 구분선, 카드 장은 연한 색 카드 세 개와 위쪽 색 막대로 꾸밉니다. 색은 테마의 어두운색·밝은색·강조색 6개에서만 씁니다.
- **글자 크기:** 표지 제목 52pt, 슬라이드 제목 34pt 굵게, 본문 24pt, 카드 제목 22pt, 카드 내용 18pt. 본문은 한 장에 **3~5개의 짧은 구**(한 줄에 담기는 길이)로 씁니다. 긴 문장은 두 장으로 나눕니다.
- **글꼴:** 맑은 고딕(제목·본문 공통). 한글과 영문이 함께 나옵니다.
- **측정 근거:** 공개 저장소의 회사 소개·피치 자료 계열 pptx 15건(16:9)에서 제목·본문 크기와 위치를 쟀고, 그 범위 안에서 설계했습니다. 배경색·도형·색 조합은 측정값이 아니라 설계한 값입니다.
- **레이아웃:** 표지, 구역 제목, 본문, 카드 3개, 마무리. 사진·도표·차트는 위키에 담지 않으며 다른 도구로 추가합니다.

**확인이 필요한 값 (초안):** 영문 문서 중심의 측정 위에 설계한 값입니다. 조직의 색과 글꼴이 정해져 있으면 담당자가 테마 색과 글꼴을 바꿔 확인합니다. 확인하면 이 표시를 지웁니다.

원본 문서는 넣지 않고 측정한 수치와 설명만 적었습니다.

```json style
{
  "format": "pptx",
  "id": "deck-pitch",
  "title": "회사 소개·피치 (PowerPoint)",
  "version": 2,
  "draft": true,
  "evidence": {
    "documents": 15,
    "note": "GitHub 공개 저장소의 회사 소개·피치 자료 계열 pptx 15건(16:9)에서 제목·본문 글자 크기와 위치를 재고, 그 범위 안에서 설계했다. 배경색·도형·색 조합·레이아웃은 측정값이 아니라 설계한 것이다. 대부분 영문 문서 표본이므로 사람이 확인해야 한다."
  },
  "slide": {
    "ratio": "16:9"
  },
  "theme": {
    "fontMajor": "맑은 고딕",
    "fontMinor": "맑은 고딕",
    "colors": {
      "dark": "#0B1220",
      "light": "#F8FAFC",
      "accent": ["#6366F1", "#22D3EE", "#F472B6", "#F59E0B", "#10B981", "#94A3B8"]
    }
  },
  "roles": [
    {
      "id": "cover-title",
      "label": "표지 제목",
      "kind": "title",
      "size": 52,
      "bold": true,
      "align": "left",
      "box": {
        "x": 0.08,
        "y": 0.3,
        "w": 0.62,
        "h": 0.28
      }
    },
    {
      "id": "cover-subtitle",
      "label": "표지 부제",
      "kind": "subtitle",
      "size": 22,
      "bold": false,
      "align": "left",
      "box": {
        "x": 0.08,
        "y": 0.62,
        "w": 0.62,
        "h": 0.12
      }
    },
    {
      "id": "section-title",
      "label": "구역 제목",
      "kind": "title",
      "size": 40,
      "bold": true,
      "align": "left",
      "box": {
        "x": 0.08,
        "y": 0.38,
        "w": 0.8,
        "h": 0.24
      }
    },
    {
      "id": "slide-title",
      "label": "슬라이드 제목",
      "kind": "title",
      "size": 34,
      "bold": true,
      "align": "left",
      "box": {
        "x": 0.09,
        "y": 0.06,
        "w": 0.84,
        "h": 0.13
      }
    },
    {
      "id": "body-1",
      "label": "본문 (글머리 1단계)",
      "kind": "body",
      "size": 24,
      "bold": false,
      "align": "left",
      "level": 1,
      "box": {
        "x": 0.08,
        "y": 0.27,
        "w": 0.84,
        "h": 0.62
      }
    },
    {
      "id": "card-title",
      "label": "카드 제목",
      "kind": "label",
      "size": 22,
      "bold": true,
      "align": "left",
      "color": "accent1"
    },
    {
      "id": "card-body",
      "label": "카드 내용",
      "kind": "body",
      "size": 18,
      "bold": false,
      "align": "left"
    },
    {
      "id": "closing-title",
      "label": "마무리 제목",
      "kind": "title",
      "size": 44,
      "bold": true,
      "align": "center",
      "box": {
        "x": 0.1,
        "y": 0.36,
        "w": 0.8,
        "h": 0.2
      }
    },
    {
      "id": "closing-subtitle",
      "label": "마무리 부제",
      "kind": "subtitle",
      "size": 22,
      "bold": false,
      "align": "center",
      "box": {
        "x": 0.1,
        "y": 0.6,
        "w": 0.8,
        "h": 0.12
      }
    }
  ],
  "layouts": [
    {
      "id": "cover",
      "label": "표지",
      "use": "첫 장: 발표 제목과 부제 (어두운 배경)",
      "background": "dark",
      "decor": [
        {
          "shape": "ellipse",
          "box": {
            "x": 0.74,
            "y": 0.14,
            "w": 0.2,
            "h": 0.36
          },
          "fill": "accent1"
        },
        {
          "shape": "ellipse",
          "box": {
            "x": 0.68,
            "y": 0.4,
            "w": 0.14,
            "h": 0.25
          },
          "fill": "accent2"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0.08,
            "y": 0.25,
            "w": 0.09,
            "h": 0.012
          },
          "fill": "accent2"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0,
            "y": 0.94,
            "w": 1,
            "h": 0.06
          },
          "fill": "accent1"
        }
      ],
      "elements": [
        {
          "role": "cover-title",
          "color": "light"
        },
        {
          "role": "cover-subtitle",
          "color": "tint"
        }
      ]
    },
    {
      "id": "section",
      "label": "구역 제목",
      "use": "내용을 나누는 장: 큰 제목 한 줄 (강조색 배경)",
      "background": "accent1",
      "decor": [
        {
          "shape": "rect",
          "box": {
            "x": 0.08,
            "y": 0.33,
            "w": 0.07,
            "h": 0.012
          },
          "fill": "light"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0,
            "y": 0.94,
            "w": 1,
            "h": 0.06
          },
          "fill": "dark"
        }
      ],
      "elements": [
        {
          "role": "section-title",
          "color": "light"
        }
      ]
    },
    {
      "id": "content",
      "label": "본문",
      "use": "제목과 글머리 항목(3~5개, 짧은 구)으로 설명하는 일반 장",
      "background": "light",
      "decor": [
        {
          "shape": "rect",
          "box": {
            "x": 0.06,
            "y": 0.07,
            "w": 0.01,
            "h": 0.1
          },
          "fill": "accent1"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0.06,
            "y": 0.205,
            "w": 0.88,
            "h": 0.005
          },
          "fill": "tint"
        }
      ],
      "elements": [
        {
          "role": "slide-title",
          "color": "dark"
        },
        {
          "role": "body-1"
        }
      ]
    },
    {
      "id": "cards",
      "label": "카드 3개",
      "use": "세 가지를 나란히 비교·나열하는 장: 카드마다 제목 한 줄과 내용 두세 줄",
      "background": "light",
      "decor": [
        {
          "shape": "rect",
          "box": {
            "x": 0.06,
            "y": 0.07,
            "w": 0.01,
            "h": 0.1
          },
          "fill": "accent1"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0.06,
            "y": 0.205,
            "w": 0.88,
            "h": 0.005
          },
          "fill": "tint"
        },
        {
          "shape": "roundRect",
          "box": {
            "x": 0.06,
            "y": 0.28,
            "w": 0.26,
            "h": 0.58
          },
          "fill": "tint"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0.06,
            "y": 0.28,
            "w": 0.26,
            "h": 0.012
          },
          "fill": "accent1"
        },
        {
          "shape": "roundRect",
          "box": {
            "x": 0.37,
            "y": 0.28,
            "w": 0.26,
            "h": 0.58
          },
          "fill": "tint"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0.37,
            "y": 0.28,
            "w": 0.26,
            "h": 0.012
          },
          "fill": "accent2"
        },
        {
          "shape": "roundRect",
          "box": {
            "x": 0.68,
            "y": 0.28,
            "w": 0.26,
            "h": 0.58
          },
          "fill": "tint"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0.68,
            "y": 0.28,
            "w": 0.26,
            "h": 0.012
          },
          "fill": "accent3"
        }
      ],
      "elements": [
        {
          "role": "slide-title",
          "color": "dark"
        },
        {
          "role": "card-title",
          "key": "card-1-title",
          "box": {
            "x": 0.08,
            "y": 0.31,
            "w": 0.22,
            "h": 0.1
          },
          "color": "accent1"
        },
        {
          "role": "card-body",
          "key": "card-1-body",
          "box": {
            "x": 0.08,
            "y": 0.43,
            "w": 0.22,
            "h": 0.4
          }
        },
        {
          "role": "card-title",
          "key": "card-2-title",
          "box": {
            "x": 0.39,
            "y": 0.31,
            "w": 0.22,
            "h": 0.1
          },
          "color": "accent2"
        },
        {
          "role": "card-body",
          "key": "card-2-body",
          "box": {
            "x": 0.39,
            "y": 0.43,
            "w": 0.22,
            "h": 0.4
          }
        },
        {
          "role": "card-title",
          "key": "card-3-title",
          "box": {
            "x": 0.7000000000000001,
            "y": 0.31,
            "w": 0.22,
            "h": 0.1
          },
          "color": "accent3"
        },
        {
          "role": "card-body",
          "key": "card-3-body",
          "box": {
            "x": 0.7000000000000001,
            "y": 0.43,
            "w": 0.22,
            "h": 0.4
          }
        }
      ]
    },
    {
      "id": "closing",
      "label": "마무리",
      "use": "마지막 장: 핵심 한 줄과 연락·다음 단계 (어두운 배경)",
      "background": "dark",
      "decor": [
        {
          "shape": "rect",
          "box": {
            "x": 0.46,
            "y": 0.31,
            "w": 0.08,
            "h": 0.012
          },
          "fill": "accent2"
        },
        {
          "shape": "rect",
          "box": {
            "x": 0,
            "y": 0.94,
            "w": 1,
            "h": 0.06
          },
          "fill": "accent1"
        }
      ],
      "elements": [
        {
          "role": "closing-title",
          "color": "light"
        },
        {
          "role": "closing-subtitle",
          "color": "tint"
        }
      ]
    }
  ],
  "skeleton": [
    {
      "slot": "cover",
      "layout": "cover",
      "required": true
    },
    {
      "slot": "content",
      "layouts": ["content", "cards", "section"],
      "required": true,
      "repeat": true
    },
    {
      "slot": "closing",
      "layout": "closing"
    }
  ]
}
```
