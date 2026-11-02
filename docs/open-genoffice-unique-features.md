# Open GenOffice에만 있는 기능

같은 GenOffice에서 갈라진 이음오피스(IeumOffice, [pblsketch/openoffice](https://github.com/pblsketch/openoffice))와 비교해, **Open GenOffice에만 있는 기능**을 개발 내용과 소스 위치로 정리했습니다.

- 비교 기준
  - Open GenOffice: `migrate/upstream-2026-10` 브랜치, 0.5.12 릴리스와 0.5.13 준비 커밋
  - 이음오피스: `main` `f1e4ebc22` (2026-11-02 13:26)
- 근거
  - 우리 쪽: `MODIFICATIONS.md`, `docs/superpowers/specs` 설계 문서 11건, 커밋
  - 이음오피스 쪽: README, 결정 기록(`docs/tracking/decisions`) 100건, 코드 검색
  - 이음오피스 앱을 직접 실행해 보지는 않았습니다.
- 빠진 것
  - **방향이 다른 부분**: 회사 LiteLLM 게이트웨이를 넣은 빌드, Codex를 설치 파일에 포함, 업데이트 방식, AI 연결 방식(구독·무료·회사 게이트웨이)
  - **두 포크 모두 있는 기능**: 한글 파일 연결, `.bak` 보관, 다른 편집기 AI의 한글 첨부 읽기 등
  - **이음오피스에서 가져온 기능**: 홈 빠른 미리보기, 분할 화면, PDF 주석 목록·노트

## 한눈에 보기

| #   | 기능                                             | 적용 형식                  | 이음오피스                                     |
| --- | ------------------------------------------------ | -------------------------- | ---------------------------------------------- |
| 1   | 업무 위키: 저장한 문서에서 학습하는 업무 기억    | 일곱 편집기 전부           | 없음. 마크다운 노트 사이 링크만 있음           |
| 2   | 자료로 쓰는 장문 문서: 계획 후 장별 작성         | Word, 한글                 | 없음. 원본의 한 번에 쓰기(자료는 앞 8,000자만) |
| 3   | 문서 서식 위키                                   | 한글, Word, PowerPoint     | 없음                                           |
| 4   | 공공 입찰·ODA 제안서 서식과 제안요청서 따라 쓰기 | 한글, Word, PowerPoint     | 없음                                           |
| 5   | 팀 NAS 템플릿·팀 문서함, 저장 시 자동 보내기     | Word, PowerPoint, Excel 등 | 없음                                           |
| 6   | 공유 사본의 개인정보 마스킹                      | NAS로 가는 모든 사본       | 없음. AI로 가는 내용 가리기는 별개 기능        |
| 7   | 팀 문서로 템플릿 만들기, 맞는 템플릿 찾아 쓰기   | Word                       | 없음                                           |
| 8   | 한글 2005에서도 열리는 `.hwp` 저장               | 한글                       | 없음. 실패하면 HWPX·PDF로 저장하라고 안내      |
| 9   | AI 표 열 너비를 내용에 맞춤, 넓은 표는 9pt       | Word                       | 없음. 모든 열을 같은 너비로 나눔               |
| 10  | 비표준 XML 접두사(`ns0:`) PPTX 열기              | PowerPoint                 | 없음. 같은 파일을 열지 못함                    |

### 형식별 적용 범위

| 형식           | 장별 작성                 | 서식 위키                               | 업무 위키 참고 | 팀 템플릿 |
| -------------- | ------------------------- | --------------------------------------- | -------------- | --------- |
| Word           | ✔                         | ✔ 역할별 서식으로 작성                  | ✔              | ✔         |
| 한글           | ✔                         | ✔ 서식 문서 생성                        | ✔              | —         |
| PowerPoint     | — 원본의 `generate_deck`  | ✔ 덱 유형(색, 글꼴, 제목 위치, A4 가로) | ✔              | —         |
| Excel, PDF     | —                         | —                                       | ✔              | —         |
| Markdown, HTML | — 원본의 `write_document` | —                                       | ✔              | —         |

장별 작성과 팀 템플릿을 한글·PowerPoint로 넓히는 일은 남은 과제입니다.

---

## 1. 업무 위키

저장한 문서와 대화에서 업무, 작업 방식, 기관을 학습해 작은 위키로 쌓고, 모든 편집기의 AI가 이를 참고합니다. 함께 설치되는 LLM Wiki가 원본 자료를 학습하고, 두 위키는 하나의 검색으로 찾습니다.

**개발 내용**

- **학습 대상**
  - 일곱 편집기(한글, Word, PowerPoint, Excel, PDF, Markdown, HTML)에서 저장한 문서
  - `raw/sources/`에 넣은 파일
  - 대화 중 남길 만한 내용
- **위키 구조**
  - 업무는 `wiki/work`, 작업 방식은 `wiki/methods`, 기관은 `wiki/clients`에 둡니다.
  - 나머지 폴더는 LLM Wiki가 관리합니다.
  - 기본 폴더는 `문서\GenOffice 업무위키`입니다.
- **학습 방식**
  - 첫 저장 때는 문서 개요를 보내고, 이후 저장 때는 바뀐 문단만 보냅니다.
  - 계획 호출 1회와 병합 호출 1~3회로 페이지를 분량 한도 안에 유지합니다.
  - 업무 페이지의 관련 문서 목록은 코드가 관리합니다.
- **저장 문서를 LLM Wiki로**
  - 저장한 문서를 `raw/sources/genoffice-saved/`에 복사합니다. 한글 문서는 Markdown으로 바꿔 넣습니다.
  - 내용이 바뀐 경우에만, 문서당 한 시간에 한 번까지 복사합니다.
  - 설정에서 끌 수 있고, 처음 복사할 때 한 번 안내합니다.
- **LLM Wiki 함께 설치**
  - LLM Wiki(GPL-3.0)를 고친 판을 별도 프로그램으로 설치 파일에 넣었습니다.
  - GenOffice가 켜져 있는 동안 숨은 창으로 돌고, 설정은 GenOffice의 AI 설정을 따릅니다.
- **목차**: LLM Wiki가 모델에게 목차를 다시 쓰게 하지 않고, 디스크의 페이지로 직접 만듭니다.
  - 최상위 `wiki/index.md`는 4,000자까지입니다.
  - 분류별로 `wiki/index/` 아래에 목록을 둡니다.
- **바뀐 원본**: 그 원본으로만 만든 페이지를 지우고 다시 학습합니다(덧붙이지 않고 다시 씁니다).
- **원본의 사실 보존**: 숫자, 이름, 목록, 권고는 원문 그대로 옮깁니다. 해석은 마지막 절 `## 활용 메모 (원문 아님)`에만 둡니다.
- **긴 답 처리**: 학습 답이 분량 한도에서 잘리면 한도를 늘려 다시 요청합니다.
- **스캔 PDF**: 설치 파일에 넣은 Tesseract(한국어·영어)로 스캔 PDF도 학습합니다.
- **AI 사용**
  - 일곱 편집기의 AI 패널이 매 메시지마다 관련 페이지 목록(3,000자 이내)을 받습니다.
  - 도구 `wiki_search`, `wiki_read`, `wiki_index`, `wiki_remember`를 씁니다.
  - 위키 글은 데이터로 구분해 AI에 넘깁니다.
- **첨부를 위키에**: AI 패널의 첨부 카드에서 그 파일을 업무 위키 자료로 바로 넣을 수 있습니다.

**소스 위치**

- 위키 엔진: `packages/work-wiki/src/`
  - 학습 `node/learn.ts`
  - 저장 문서 복사 `node/mirror.ts`
  - 검색 `node/search.ts`
  - 저장소 `node/store.ts`
  - AI 도구 `skill.ts`
  - 첨부 넣기 `material.ts`
- 앱 쪽 실행·설정
  - `apps/shell/src/main/work-wiki.ts`, `work-wiki-settings.ts`, `work-wiki-notice.ts`, `wiki-material-request.ts`
  - 설정 화면 `apps/shell/src/renderer/src/WorkWikiSettings.tsx`
- LLM Wiki 실행·연동
  - `apps/shell/src/main/llm-wiki.ts`, `llm-wiki-process.ts`, `llm-wiki-ready.ts`
  - 초기 `purpose.md`·`schema.md` 생성: `llm-wiki-seed.ts`
- LLM Wiki 포크: [raondaon-kim/llm_wiki](https://github.com/raondaon-kim/llm_wiki) `genoffice` 브랜치 (현재 고정 `og-v0.5.2`, `69026df`)
  - 목차 생성기 `src/lib/wiki-index.ts`
  - 바뀐 원본 다시 쓰기 `src/lib/project-file-sync.ts`, `src/lib/source-lifecycle.ts`
  - 숨은 실행 모드와 API, Tesseract OCR
- 함께 넣는 프로그램 준비: `tools/fetch-llm-wiki.mjs`, `tools/llm-wiki.pin.json`, `tools/fetch-tesseract.mjs`, `tools/tesseract.pin.json`
- 설계 문서 (`docs/superpowers/specs/`)
  - `2026-10-13-work-wiki-design.md`
  - `2026-10-15-llm-wiki-bundle-design.md`
  - `2026-10-16-scanned-pdf-ocr-design.md`
  - `2026-10-20-chat-attachment-to-work-wiki-design.md`
  - `2026-10-21-wiki-saved-docs-and-index-design.md`

## 2. 자료로 쓰는 장문 문서 (`write_report`)

첨부 자료와 업무 위키로 보고서, 제안서, 계획서를 씁니다. 원본 방식처럼 한 번에 통째로 쓰지 않습니다. 주제와 소주제를 먼저 계획하고, 장마다 따로 씁니다.

**개발 내용**

- **계획**
  - 문서 개요: 목적, 독자, 핵심 메시지, 용어
  - 장마다 정하는 것
    - 제목과 요점
    - 맡을 주제(장끼리 겹치지 않게)
    - 입장
    - 소주제(절) 목록
    - 그 장에 쓸 첨부 부분과 위키 페이지
  - 첨부는 끝까지 다 읽습니다. 위키는 목차부터 보고 필요한 페이지만 고릅니다.
- **장별 작성**
  - 제목과 목차가 먼저 문서에 들어가고, 장마다 「쓰는 중…」 자리를 채워 갑니다.
  - 장마다 넘기는 것은 전체 목차, 앞 장들의 주장, **그 장에 배정된 자료만**입니다.
- **작성 규칙**
  - 절은 요점으로 시작합니다.
  - 사실은 자료에서만 가져오고 출처를 밝힙니다.
  - 작성자의 제안에는 「(제안)」을 붙입니다.
  - 자료로 뒷받침되지 않는 내용은 「확인 필요 사항」 표로 모읍니다. 제안서는 `[회사 실적 기재]` 같은 빈칸으로 남깁니다.
- **분량 한도**
  - 계획은 16K, 장은 32K 토큰으로 시작합니다.
  - 답이 한도에서 잘리면 64K까지 늘립니다. 잘린 장이 그대로 문서에 들어가지 않습니다.
- **Word**
  - 서식 위키의 역할별 서식으로 씁니다. 기본은 `docx-report`, 제안요청서가 있으면 `docx-bid-proposal`입니다.
  - 표는 Word 표로 들어갑니다.
  - 변경 추적이 켜져 있으면 추적됩니다.
  - AI 변경 강조색 없이 들어갑니다.
- **한글**
  - 서술형 보고서 서식(`report`)이 기본입니다.
  - 빈 문서면 장마다 다시 만들어 바로 보여 줍니다. 아니면 새 문서로 만듭니다.
- **진행 표시**: 두 패널 모두 진행 카드와 취소가 있습니다. 취소해도 이미 쓴 장은 남습니다.

**소스 위치**

- 작성 엔진: `packages/report-writer/src/`
  - 계획 `plan.ts`
  - 실행 `run.ts`
  - 프롬프트 `prompts.ts`
  - 첨부 `attachments.ts`, `read-attachments.ts`
  - 위키 `wiki.ts`
  - 분량 `budget.ts`
  - 진행 표시 `progress-view.ts`
  - 도구 정의 `skill.ts`
- Word: `apps/docs/src/renderer/ai/report/report-skill.ts`, `docs-lander.ts`
- 한글: `apps/hwp/src/renderer/ai/report/report-skill.ts`, `hwp-lander.ts`, `wiring.ts`
- 설계 문서: `docs/superpowers/specs/2026-10-22-report-writing-design.md`

## 3. 문서 서식 위키

한글, Word, PowerPoint 문서 유형마다 역할별 서식 값(글꼴, 크기, 간격, 들여쓰기, 제목 위치 등)을 재서 Markdown 페이지로 둡니다. AI는 새 문서를 쓰기 전에 이 위키를 읽고, 맞는 페이지가 없을 때만 스스로 서식을 정합니다.

**개발 내용**

- **서식 페이지 18개**: 보고서, 계획서, 제안서, 회의록, 공문, 보도자료, 서울시 기안·보고, 입찰 제안서, ODA 제안서, 강의·사업·피치 덱 등
- **한글**
  - 도구: `list_document_styles`, `read_document_style`, `create_styled_document`, `export_document_styles`
  - 서식 문서를 엔진 한 번으로 만듭니다. 몇 분 걸리던 작업이 몇 초로 줄었습니다.
- **Word**: `write_styled_document`가 역할별 문단·글자 서식(동아시아 글꼴 포함)을 가진 블록을 한 번에 넣습니다. 되돌리기도 한 번입니다.
- **PowerPoint**: 위키의 덱 유형을 `generate_deck`의 스타일 템플릿(`wiki:<id>`)으로 씁니다. 회사 색, 글꼴, 크기, 제목 위치대로 덱을 만듭니다.

**소스 위치**

- 서식 위키 패키지: `packages/doc-styles/src/` (`hwp.ts`, `docx.ts`, `pptx.ts`, `common.ts`)
- 서식 페이지: `apps/hwp/resources/doc-styles/*.md` (설치본에는 `modules/hwp-doc-styles`로 들어감)
- 한글
  - 메인 `apps/hwp/src/main/doc-styles.ts`, `styled-document.ts`, `styled-fast.ts`, `styled-drafts.ts`
  - AI 도구 `apps/hwp/src/renderer/ai/tools/styles.ts`, `tools/create.ts`
- Word: `apps/docs/src/renderer/ai/styles-skill.ts`, `style-ops.ts`
- PowerPoint: `apps/slides/src/renderer/ai/wiki-template.ts`

## 4. 공공 입찰·ODA 제안서

공공 입찰과 ODA(KOICA, EDCF) 제안서를 쓰기 위한 서식 페이지와 작성 규칙입니다.

**개발 내용**

- **서식 페이지**
  - 한글 기술제안서 `bid-proposal`, Word `docx-bid-proposal`
  - A4 가로 PowerPoint 제안서 `deck-bid-proposal`
  - ODA 제안서 `oda-proposal`, `docx-oda-proposal`, `deck-oda-proposal`
- **제안요청서 따라 쓰기**: AI가 첨부한 제안요청서를 읽고, 그 목차·작성 규칙·평가 항목을 따릅니다.
- **사실 지어내지 않기**: 입찰 회사에 관한 사실은 지어내지 않고 빈칸으로 남깁니다. 요청서 내용을 되풀이하지 않고 수행 방법을 제안합니다.
- **A4 가로 덱**
  - PowerPoint 페이지에 덱 유형별 규칙을 둘 수 있습니다.
  - A4 덱 유형이면 `generate_deck`이 정확히 297×210mm 슬라이드를 만듭니다.

**소스 위치**

- 서식 페이지: `apps/hwp/resources/doc-styles/bid-proposal.md`, `docx-bid-proposal.md`, `deck-bid-proposal.md`, `oda-proposal.md`, `docx-oda-proposal.md`, `deck-oda-proposal.md`
- A4 가로: `packages/pipelines` (용지 크기), `apps/slides/src/renderer/ai/wiki-template.ts`

## 5. 팀 NAS 템플릿·팀 문서함

탐색기에 이미 연결된 NAS 공유 폴더를 골라, 홈에 「팀 템플릿」과 「팀 문서」 두 공간을 둡니다. NAS 비밀번호는 저장하지 않습니다.

**개발 내용**

- **템플릿**: 로컬 작업 사본으로 엽니다. 선택한 홈 폴더가 있으면 그 안에 엽니다.
- **자동 보내기**
  - 켜 두면 사용자가 직접 한 저장만 대기열(`userData/team-sync.json`)에 넣습니다. 자동 저장이나 AI·에이전트의 저장은 보내지 않습니다.
  - NAS의 `프로젝트 / 작성자 / 형식` 폴더에 씁니다. 프로젝트는 문서가 든 가장 안쪽 홈 폴더입니다.
- **안전한 쓰기**
  - 임시 이름으로 쓴 뒤 이름을 바꿉니다.
  - 일시적인 실패는 30초마다, 그리고 재시작 후에 다시 시도합니다.
- **마스킹**: 자동이든 직접 등록이든 NAS로 가는 모든 사본은 먼저 마스킹을 거칩니다(6번).

**소스 위치**

- 메인: `apps/shell/src/main/team-library.ts`, `team-sync.ts`, `team-library-ipc.ts`
- 화면: `apps/shell/src/renderer/src/TeamLibrary.tsx`, `team-library-strings.ts`, `team-library.css`
- 설계 문서: `docs/superpowers/specs/2026-10-28-nas-template-collection-design.md`

## 6. 공유 사본의 개인정보 마스킹

NAS로 가는 문서 사본에서 주민등록번호 같은 식별번호와 메일 주소를 자리표시로 바꿉니다. 파일 이름도 같이 바꿉니다.

**개발 내용**

- **대상 형식**: Word, Excel, PowerPoint, HWPX, 텍스트 문서의 본문을 처리합니다.
- **거부하는 경우**: `.hwp`, `.pdf`, 그리고 마스킹할 수 없는 포함 개체가 든 문서는 보내지 않고 화면에 그 사실을 보여 줍니다.
- **검증**: 마스킹한 결과를 다시 확인한 뒤에만 씁니다.
- **팀 템플릿 파일**: 7번의 템플릿 두 파일도 쓰기 전에 같은 검사를 거칩니다.

**소스 위치**

- `packages/doc-mask/src/`
  - 규칙 `rules.ts`
  - 검증 `verify.ts`
  - 형식별 처리 `formats/docx.ts`, `xlsx.ts`, `pptx.ts`, `hwpx.ts`, `office.ts`, `text.ts`

## 7. 팀 문서로 템플릿 만들기와 템플릿 찾아 쓰기

팀 문서함의 Word 문서 가운데 같은 양식으로 쓴 문서를 묶어 템플릿 후보를 보여 주고, 템플릿을 만듭니다. AI는 문서 작성 요청을 받으면 맞는 템플릿을 찾아 그 양식으로 씁니다. 지금은 Word만 됩니다.

**개발 내용**

- **템플릿 한 벌**: 템플릿 폴더의 `Word/<이름>/` 안에 두 파일이 있습니다.
  - `form.docx`
    - 원본의 양식만 남깁니다: 제목, 스타일, 쪽 설정, 머리글·바닥글, `[항목]` 자리표시가 든 표지, 표 머리행
    - 본문 문장, 값, 메모, 변경 추적, 그림은 모두 지웁니다.
  - `template.md`
    - 목적, 필요한 자료, 읽을 위키 페이지
    - 고정 `## 목차`와 제목별 작성 안내
    - `form.docx`의 sha256
    - 잰 서식 값
- **후보 찾기**
  - 팀 문서함의 Word 문서를 제목 순서와 표 머리글로 묶습니다. 번호와 사업명 같은 단어는 무시합니다.
  - 「템플릿 만들기」를 누르면 AI가 `template.md` 초안을 쓰고, 사람이 검토해 확정합니다.
- **유출 방지**
  - 쓰기 전에 원본 문장, 표지 값, 표 값이 8글자 이상 이어서 남아 있으면 안 됩니다. 걸린 줄은 모두 화면에 보여 줍니다.
  - 마스킹 검사도 거칩니다.
- **NAS 쓰기**
  - 확정과 삭제 때만 씁니다. 그 전에 쓰기 가능한지 먼저 확인합니다.
  - 새 템플릿은 숨은 임시 폴더에 쓴 뒤 이름 한 번으로 바꿉니다.
  - 다시 만들 때는 실패하면 원래 파일로 되돌립니다. 그사이 다른 사람이 바꿨으면 거부합니다.
- **목록**
  - `index.md`와 형식 폴더 목록으로 만듭니다.
  - 탐색기에서 추가·이름 변경·삭제한 템플릿도 맞춰 고칩니다.
- **작성**: 「이 양식으로 작성」을 누르면 양식의 로컬 사본을 엽니다. 그 문서에서는 `write_report`가 템플릿 목차를 그대로 따릅니다.
  - 표지 자리표시부터 채웁니다.
  - 제목마다 첨부와 업무 위키로 씁니다. 네 개씩 동시에 쓰고, 순서대로 넣습니다.
  - 열이 맞으면 양식의 표를 채웁니다.
  - 미정 사항은 「확인 필요 사항」에 모읍니다.
- **템플릿 찾기**
  - 다른 Word 문서에서 문서 전체 작성을 요청받으면, AI가 템플릿 목록(`list_team_templates`)을 읽습니다.
  - 맞는 템플릿으로 쓸지 한 번 묻고, 승낙하면 `use_team_template`으로 작업 사본을 엽니다.
  - 새 대화가 요청과 첨부를 이어받아 채웁니다.
- **LLM Wiki 기다리기**: 채우기 전에 LLM Wiki가 준비되기를 최대 30초 기다리고, 한 번 다시 시작합니다.

**소스 위치**

- 템플릿 패키지: `packages/team-templates/src/`
  - 목차 서명 `signature.ts`, `docx-outline.ts`
  - 양식 만들기 `form.ts`
  - 원본 문장 검사 `source-words.ts`
  - 서식 재기 `measure.ts`
  - `template.md` 생성 `template-md.ts`, `draft.ts`
  - 목록 `index-md.ts`
- 메인: `apps/shell/src/main/team-templates.ts`
- 화면: `apps/shell/src/renderer/src/TeamTemplateSets.tsx`
- Word AI: `apps/docs/src/renderer/ai/report/team-template-skill.ts`, `template-lander.ts`
- 템플릿 채우기: `packages/report-writer/src/template-run.ts`, `template-prompts.ts`
- 설계 문서: `docs/superpowers/specs/2026-10-28-team-templates-from-documents-design.md`

## 8. 한글 2005에서도 열리는 `.hwp` 저장

rhwp 엔진이 쓴 `.hwp`는 그대로 두면 한글 2005에서 열리지 않습니다. 저장할 때마다 한글 2005가 읽는 형식으로 다시 묶습니다. `.hwpx`는 한글 2010 이상이 필요합니다.

**개발 내용**

- **재포장**: 압축 스트림을 4KB 창으로 다시 압축하고, 한글의 CRC32·크기 꼬리말을 붙입니다.
- **쓰기 전 확인**: 복합 파일, 압축 스트림, CRC32와 크기 꼬리말을 확인합니다. 맞지 않으면 rhwp가 쓴 원래 바이트로 저장합니다.

**소스 위치**

- `apps/hwp/src/main/hwp5-legacy.ts`

## 9. AI 표 열 너비를 내용에 맞추기 (0.5.12)

Word AI가 넣는 표의 열 너비를 칸 내용에 맞춥니다. 원본과 이음오피스는 모든 열을 같은 너비로 나눕니다. 그래서 「세부 과업 + 1~13월」 같은 일정표에서 과업 이름이 한 글자씩 세로로 쌓였습니다.

**개발 내용**

- **같은 너비 유지**: 모든 열이 같은 너비에 들어가면 그대로 같은 너비로 둡니다. 짧은 표는 달라지지 않습니다.
- **내용에 맞춤**: 들어가지 않으면 브라우저의 자동 표 배치처럼 정합니다.
  - 열마다 가장 긴 낱말이 한 줄에 들어갈 너비를 먼저 줍니다.
  - 남는 너비는 긴 글이 있는 열에 더 줍니다.
- **9pt로 쓰기**: 11pt로는 가장 긴 낱말들도 다 들어가지 않으면 표 글자를 9pt로 씁니다. 2026-11-02 사용자가 이 방식을 골랐습니다.
- **저장**: 열 너비와 글자 크기는 저장한 `.docx`에도 그대로 들어갑니다.
- **남은 과제**: 표를 넣은 뒤 AI가 스스로 너비를 다시 좁히는 경우가 있습니다(설치본 시험 3회 중 1회). AI에게 표 너비가 이미 정해졌다고 알려 주는 수정을 검토 중입니다.

**소스 위치**

- `apps/docs/src/renderer/ai/table-widths.ts`
- 표 만들기: `apps/docs/src/renderer/ai/protocol.ts` `parseTable`
- 시험: `apps/docs/tests/ai-table-widths.test.ts`

## 10. 비표준 XML 접두사로 저장된 PPTX 열기 (0.5.13, 아직 배포 전)

Python ElementTree 같은 스크립트로 다시 저장한 PPTX는 XML 이름표가 `p:`, `a:`, `r:` 대신 `ns0:`, `ns1:`입니다. PowerPoint는 이 파일을 열지만, 원본과 이음오피스의 슬라이드 엔진은 「malformed presentation.xml」로 열지 못합니다.

**개발 내용**

- **표준 이름으로 바꾸기**: 파일을 열 때 이런 접두사를 쓰는 XML 부분의 이름을 표준 이름으로 바꿉니다.
- **바꾸지 않는 경우**
  - 같은 접두사가 두 네임스페이스에 쓰이는 등 뜻이 달라질 수 있는 경우
  - 이미 표준인 파일(원래 바이트 그대로 둡니다)
- **확인**: 실제 사례(35장 덱)가 열리고, 저장한 뒤 다시 열리는 것을 확인했습니다.

**소스 위치**

- `packages/pptx-engine/src/ooxml-prefixes.ts`
- 열 때 적용: `packages/pptx-engine/src/zip.ts` `PackageArchive.open`
- 시험: `packages/pptx-engine/tests/foreign-prefixes.test.ts`
