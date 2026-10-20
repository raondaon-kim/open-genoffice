# Open GenOffice

한글 문서와 업무 기억을 갖춘 AI 오피스입니다. 한글(`.hwp`/`.hwpx`), Word, Excel, PowerPoint, PDF 문서를 AI와 함께 쓰고, 지금까지 해 온 업무와 회사 자료를 기억해 다음 문서에 활용합니다.

Open GenOffice는 [GenOffice](https://github.com/genspark-ai/genoffice)(Apache-2.0)를 바탕으로 한 독립 포크입니다. 문서 편집기와 AI 패널 같은 기본 기능은 원본에서 왔고, 이 저장소는 한국 기관·기업의 문서 업무에 맞춘 기능을 더했습니다. 원본의 기능 소개는 [원본 README](https://github.com/genspark-ai/genoffice#readme)를 보세요.

## 무엇이 다른가

### 한글 문서

- `.hwp`/`.hwpx` 문서를 탭에서 열고, 고치고, 저장합니다. 편집기는 [rhwp](https://github.com/edwardkim/rhwp)를 씁니다.
- `.hwp`로 저장한 문서는 한글 2005 같은 옛 버전에서도 열립니다. 저장할 때 원본은 `.bak`으로 남깁니다.
- 한글 AI 도우미가 문서를 새로 쓰거나 고치고, 첨부한 한글 파일도 읽습니다.

### 문서 스타일 위키와 제안서

- 기관의 문서 양식(글꼴, 크기, 제목 위치, 표 모양)을 위키 페이지로 두면 한글·Word·PowerPoint 도우미가 새 문서를 그 양식대로 씁니다.
- 공공 입찰 기술제안서(한글)와 A4 가로 제안 발표자료(PowerPoint) 페이지가 들어 있습니다. 제안요청서(RFP)를 첨부하면 목차, 작성 규칙, 평가 항목을 따르고, 확인되지 않은 회사 정보는 비워 둡니다.

### 업무 위키

- 저장한 문서, 대화에서 말한 내용, 직접 넣은 자료를 작은 위키로 정리해 기억합니다. 위키는 업무(무슨 일을 했는지), 작업 방식(어떻게 쓰는지), 기관(발주처의 선호)으로 나뉩니다.
- 회사소개서나 제안요청서 같은 자료는 홈의 **업무 위키에 자료 추가** 또는 파일 메뉴로 넣습니다. 함께 설치되는 [LLM Wiki](https://github.com/nashsu/llm_wiki)가 앱이 켜져 있는 동안 화면 없이 실행되며 자료를 위키 페이지로 만듭니다.
- 도우미는 문서를 쓰기 전에 두 위키를 검색하고 읽습니다. 예를 들어 "후속 제안서 개요를 우리 회사 실적을 넣어서 써 줘"라고 하면, 회사소개서에 있던 실적과 이전 제안서의 작성 방식을 근거로 쓰고 참고한 페이지를 밝힙니다.
- 위키 폴더는 기본으로 `문서\GenOffice 업무위키`이고, 설정 › AI 미디어에서 끄거나 바꿀 수 있습니다.

### AI 연결 방식 세 가지

설정 › AI 모델에서 연결 방식을 고릅니다.

| 방식                 | 이런 경우                          | 필요한 것                                                                                                   |
| -------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **LiteLLM**          | 회사가 LiteLLM 프록시를 운영할 때  | 회사에서 받은 가상 키. 기본 모델은 `deepseek-flash`이고, 회사용 설치 파일은 서버 주소가 미리 들어 있습니다. |
| **Codex**            | ChatGPT 계정으로 쓰고 싶을 때      | 로그인 한 번. Codex CLI가 설치 파일에 들어 있고, 이미 Codex에 로그인한 PC는 바로 연결됩니다.                |
| **API 키 직접 입력** | 원하는 회사의 모델을 내 키로 쓸 때 | Claude, OpenAI, Gemini, DeepSeek 등의 API 키                                                                |

어느 방식이든 업무 위키 학습에 그대로 쓰입니다. Codex로 연결하면 GenOffice가 LLM Wiki와 Codex 사이를 이어 줍니다.

## 설치

Windows 설치 파일(`OpenGenOfficeSetup-<버전>-x64.exe`)에는 LLM Wiki와 Codex CLI가 함께 들어 있어, 하나만 설치하면 됩니다. 설치 파일은 아래 [빌드](#빌드) 방법으로 만듭니다.

## 빌드

필요한 것: Node.js 22.12 이상, npm 10 이상, Rust(`cargo`, 스프레드시트 엔진용). Windows 설치 파일을 만들려면 LLM Wiki 수정본을 받아 둔 폴더와 그 빌드 도구(Rust, `protoc`)도 필요합니다.

```bash
npm install
npm run dev          # 모든 편집기와 셸을 개발 모드로 실행
npm test             # 단위 테스트
npm run typecheck    # 모든 작업 공간의 타입 검사
```

Windows 설치 파일:

```bash
# LLM Wiki 수정본: https://github.com/raondaon-kim/llm_wiki (genoffice 브랜치)
LLM_WIKI_FORK_DIR=<llm_wiki 폴더> npm run dist:win
```

`dist:win`은 LLM Wiki(고정된 커밋)와 Codex CLI(고정된 버전, 해시 확인)를 먼저 준비한 뒤 설치 파일을 만듭니다. 결과는 `apps/shell/release/`에 생깁니다.

회사용 설치 파일은 빌드할 때 LiteLLM 주소와 모델을 넣습니다. 이 값은 설치 파일에만 들어가고 저장소에는 남지 않습니다.

```bash
OPEN_GENOFFICE_LITELLM_URL=<프록시 주소>/v1 \
OPEN_GENOFFICE_LITELLM_MODEL=deepseek-flash \
LLM_WIKI_FORK_DIR=<llm_wiki 폴더> \
npm run dist:win
```

GNU 툴체인이 없는 PC에서는 `OPEN_GENOFFICE_WIN_SIDECAR_TARGET=x86_64-pc-windows-msvc`를 함께 줍니다.

## 저장소 구성 (이 포크에서 더한 것)

| 경로                                                    | 내용                                  |
| ------------------------------------------------------- | ------------------------------------- |
| `apps/hwp`                                              | 한글 문서 편집기                      |
| `packages/doc-styles`                                   | 문서 스타일 위키                      |
| `packages/work-wiki`                                    | 업무 위키 엔진과 도우미 도구          |
| `packages/ai-provider/src/connection-modes.ts`          | AI 연결 방식                          |
| `apps/shell/src/main/llm-wiki*.ts`                      | LLM Wiki 실행·설정·자료 추가          |
| `apps/shell/src/main/codex-*.ts`                        | Codex 로그인과 LLM Wiki용 연결 어댑터 |
| `tools/fetch-llm-wiki.mjs`, `tools/fetch-codex-cli.mjs` | 설치 파일에 넣을 프로그램 준비        |

변경 목록 전체는 [MODIFICATIONS.md](MODIFICATIONS.md)에 있습니다.

## 라이선스

- Open GenOffice: [Apache License 2.0](LICENSE). 원본의 라이선스, 저작권, [NOTICE](NOTICE)를 그대로 따릅니다. `ee/` 폴더는 원본의 [Enterprise License](ee/LICENSE)를 따릅니다.
- 함께 설치되는 프로그램은 각자의 라이선스를 따르며, 설치 폴더에 라이선스와 소스 위치(`SOURCE.txt`)가 함께 들어갑니다.
  - LLM Wiki: GPL-3.0. 이 포크의 수정본은 [raondaon-kim/llm_wiki](https://github.com/raondaon-kim/llm_wiki)에 있습니다.
  - Codex CLI: Apache-2.0 ([openai/codex](https://github.com/openai/codex)), 수정하지 않았습니다.
- 홈 화면 빠른 미리보기(스페이스바)와 두 문서 나란히 보기(분할 화면)는 [이음오피스](https://github.com/pblsketch/openoffice)(Apache-2.0, 같은 GenOffice의 포크)에서 가져왔습니다.
- GenOffice와 Genspark 이름과 로고는 Mainfunc, Inc.의 상표이며, 이 포크는 Mainfunc나 Genspark와 관계가 없습니다.

도움을 받은 프로젝트는 [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md)에 정리했습니다.
