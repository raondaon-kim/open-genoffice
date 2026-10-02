# AI 생각 과정 실시간 표시와 DeepSeek 생각 모드 설계

- 날짜: 2026-10-02
- 상태: 설계 승인, 구현 전
- 브랜치: `feat/ai-thinking-stream` (기반: `feat/hwp-ai-engine-surface` — 한글 AI 패널이 이 브랜치에만 있다)
- 범위: `packages/ai-provider`, `packages/agent-core`, `packages/project-store`, `packages/ui`, 다섯 모듈
  (`apps/docs`·`apps/sheets`·`apps/slides`·`apps/pdf`·`apps/hwp`)의 AI 패널과 전송 층, `apps/docs` 메인의 AI 라우팅.
- 후속: `docs/superpowers/plans/`에 구현 계획 작성 (writing-plans).

## 1. 배경과 문제

1. **기본 AI(Codex)는 답변 글이 실시간으로 나오지 않는다.**
   - Codex 경로는 도구 호출을 위해 정해진 출력 형식(JSON 스키마)으로 한 차례를 통째로 받는다
     ([codex-app-server.ts](../../../packages/ai-provider/src/codex-app-server.ts)의 `outputSchema`).
   - 그래서 글이 차례가 끝날 때 한꺼번에 나타난다.
   - Codex가 실시간으로 보내는 생각 요약(`item/reasoning/summaryTextDelta`)은 `onReasoningDelta`까지만 오고,
     메인 라우팅(`apps/docs/src/main/ai-routing-ipc.ts`)이 화면으로 넘기지 않는다.
2. **DeepSeek API는 실시간 출력과 도구 호출을 지원하지만, 현재 코드는 최신 API와 맞지 않는다.**
   - **모델 이름:** 앱 등록부([providers.ts](../../../packages/ai-provider/src/providers.ts))는 `deepseek-chat`, `deepseek-reasoner`다.
     두 이름은 2026-07-24 중단 공지가 있었다.
     현재 모델은 `deepseek-flash`(V4.1-Flash, 2026-09-10)와 `deepseek-v4-pro`(2026-08-13)다.
   - **생각 모드:** 새 모델은 생각 모드가 기본으로 켜져 있다.
     `tools`를 담은 요청에서는 이전 AI 답의 `reasoning_content`를 **도구를 쓰지 않은 차례까지 전부** 돌려보내야 하고,
     안 보내면 400 오류다.
     현재 코드는 `reasoning_content`를 읽지도, 돌려보내지도 않는다.
     따라서 도구를 두 번 이상 이어 쓰는 편집(문서 확인 → 찾기 → 고치기)이 두 번째 요청에서 실패한다.
   - **`temperature`:** 생각 모드는 `temperature`를 지원하지 않는다.
     현재 OpenAI 호환 경로는 항상 `temperature: 0.3`을 보낸다.

## 2. 목표와 성공 기준

**목표:** 사용자가 DeepSeek을 고르면 다음이 모두 된다.

- 답변 글과 생각 내용이 실시간으로 보인다.
- 생각 모드를 켠 채로 도구를 여러 번 이어 쓰는 문서 편집이 끝까지 된다.
- Codex를 쓸 때도 생각 요약이 같은 상자에 보인다.

**성공 기준**

1. 한글 패널에서 DeepSeek(`deepseek-flash`)으로 "찾기 → 고치기" 편집이 400 없이 끝난다.
   이때 생각 과정 상자가 실시간으로 쌓이고, 답변이 시작되면 접힌다.
2. 앱을 닫았다 다시 연 DeepSeek 대화에 이어서 요청해도 오류가 없다.
3. 다른 AI에서 DeepSeek으로 바꾼 대화, 자동 요약이 일어난 대화도 오류 없이 이어진다.
   이 경우 생각 모드는 §4.3 규칙에 따른다.
4. Codex 대화에서 생각 요약이 같은 상자에 실시간으로 보인다.
5. OpenAI·Anthropic·Gemini 등 다른 서비스의 동작은 바뀌지 않는다.
6. 다섯 모듈(한글·워드·엑셀·파워포인트·PDF)이 모두 같은 상자를 쓴다.

**목표가 아닌 것**

- Codex 답변 글 자체의 실시간 출력 (출력 형식 방식을 바꾸는 별도 작업)
- 생각 강도 조절 화면
- 기본 AI 변경: Codex가 기본으로 남는다. DeepSeek은 모델 선택이나 설정 › AI의 기본 AI로 고른다.
- `deepseek-v4-pro`의 low/max 강도
- DeepSeek 외 서비스의 생각 원문 재전송

## 3. 결정 사항 (사용자 확인)

| 항목               | 결정                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| 방식               | B안 — 생각 모드 유지, 원문 보존·재전송                                |
| 화면               | 접히는 "생각 과정" 상자                                               |
| 빈칸이 있는 대화   | 원문을 대화 기록에 저장하고, 빈칸은 그대로 둔다 (§4.3, 실측으로 변경) |
| Codex 생각 요약    | 같은 상자에 표시 (저장은 표시용만, 재전송 안 함)                      |
| 기본 AI            | Codex 유지                                                            |
| DeepSeek 기본 모델 | `deepseek-flash` (목록에 `deepseek-v4-pro` 포함)                      |
| 생각 강도          | DeepSeek 기본값(high) 그대로                                          |
| 구현 구조          | A안 — 대화 기록의 AI 답에 `reasoning` 칸 추가                         |

## 4. 설계

### 4.1 생각 내용의 두 종류

| 종류                    | 출처                                    | 화면 표시 | 저장        | 다음 요청에 재전송         |
| ----------------------- | --------------------------------------- | --------- | ----------- | -------------------------- |
| 생각 원문 (`reasoning`) | DeepSeek `reasoning_content`            | 예        | 예          | **예 (DeepSeek 요청에만)** |
| 생각 요약 (`summary`)   | Codex `item/reasoning/summaryTextDelta` | 예        | 예 (표시용) | 아니오                     |

OpenAI 호환 응답의 `delta.reasoning_content`는 서비스와 상관없이 원문으로 읽어 화면에 보여 준다.
재전송 규칙은 DeepSeek 요청에만 적용한다.

### 4.2 부품별 변경과 인터페이스

1. **`packages/ai-provider`**
   - **`providers.ts`:** DeepSeek `models: ['deepseek-flash', 'deepseek-v4-pro']`, `defaultModel: 'deepseek-flash'`.
   - **`protocols/shared.ts` `StreamCallbacks`:**
     - `onReasoningDelta?(text)`: 생각 원문. 기존 이름을 유지하되 의미를 원문으로 좁힌다.
     - `onReasoningSummaryDelta?(text)`: 새로 추가. 생각 요약.
   - **`codex-app-server.ts`:** `summaryTextDelta`를 `onReasoningSummaryDelta`로 보낸다.
   - **`stream.ts` `streamOpenAiCompatible`:**
     - `delta.reasoning_content`를 `onReasoningDelta`로 넘긴다.
     - 공급자가 DeepSeek이면 §4.3 요청 규칙을 적용한다.
   - **`types.ts` `AiStreamChunk.type`:** `'thinking'`을 추가하고 `thinkingKind?: 'reasoning' | 'summary'` 필드를 둔다.
2. **`apps/docs/src/main/ai-routing-ipc.ts`:** 두 신호를 `{ type: 'thinking', thinkingKind, text }` 조각으로 화면에 보낸다.
   Codex 경로와 OpenAI 호환 경로 모두 해당한다. 로그에는 원문을 남기지 않는다.
3. **`packages/agent-core`**
   - **`types.ts`:**
     - `AgentMessage`의 assistant에 `reasoning?: string`를 둔다 (원문만).
     - `AgentStreamCallbacks.onThinking?(text: string, kind: 'reasoning' | 'summary')`를 둔다.
   - **`electron-transport.ts` `IpcStreamChunk`:** `'thinking'`과 `thinkingKind`를 `AiStreamChunk`와 같은 구조로 추가한다.
   - **`loop.ts`:**
     - 차례마다 원문(`turnReasoning`)과 표시용(`turnThinking`, 원문과 요약 모두)을 따로 모은다.
     - 표시용이 늘 때마다 `events.onThinking?(turnThinking)`를 부른다 (누적 글).
     - 기록에 넣는 AI 답에 원문을 `reasoning`으로 넣는다. 원문이 없으면 칸을 두지 않는다.
     - 이 칸을 보존하는 곳: `copyMessages`, 복원(`restore`), 자동 요약, 실패 정리.
       자동 요약이 만드는 AI 답(`COMPACT_SUMMARY_ACK`)에는 원문이 없다 (빈칸).
4. **다섯 패널의 `transport.ts`:** `chunk.type === 'thinking'`을 `callbacks.onThinking?.(text, kind)`로 넘긴다.
5. **`packages/ui`:** `ThinkingBox`를 추가한다 (§4.4).
   다섯 패널(`apps/*/src/renderer/ai/AiPanel.tsx`, 엑셀은 `AiChatPanel.tsx`)이 AI 답 말풍선 위에 이것을 그린다.
6. **`packages/project-store`:**
   - `ChatMessage`에 `reasoning?: string`, `thinking?: string`를 둔다.
   - 저장 시 각각 최대 32,000자로 자르고, **뒷부분을 남긴다.**
   - 패널은 한 번의 요청(여러 차례)에 대해 AI 답 하나를 저장한다. 그 답의 `reasoning`과 `thinking`은
     그 요청의 모든 차례를 순서대로 이어 붙인 것이다.
   - 다시 열 때 각 패널은 `reasoning`을 `AgentMessage.reasoning`으로 복원하고,
     `thinking`은 접힌 상자로 보여 준다.
7. **저장된 기본 경로 이전:** 설정에 저장된 DeepSeek 경로의 모델이 `deepseek-chat` 또는 `deepseek-reasoner`이면,
   읽을 때 `deepseek-flash`로 바꾼다.

### 4.3 DeepSeek 요청 규칙

공급자가 DeepSeek인 OpenAI 호환 요청에만 적용한다.

**실측 결과 (2026-10-02, 실제 키, `deepseek-flash`와 `deepseek-v4-pro` 동일).** 공식 문서와 다른 점이 있어 문서 대신 이 결과를 따른다.

| 항목                                                   | 결과                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /v1/models`                                       | `deepseek-flash`, `deepseek-v4-pro` 두 개                                                          |
| `deepseek-chat`                                        | 아직 응답한다 (서버가 `deepseek-flash`로 연결). 앱 목록에는 나오지 않는다                          |
| 실시간 조각                                            | `delta.reasoning_content`(생각)가 먼저 오고(약 0.4초), 이어서 `delta.content`와 `delta.tool_calls` |
| 생각 모드 + `tools` + 앞 차례 생각을 **빼고** 보냄     | 200 (400 아님)                                                                                     |
| 같은 경우 `reasoning_content: ""`                      | 200                                                                                                |
| 도구 없이 끝난 글만 있는 AI 답(생각 없음) 뒤의 새 요청 | 200                                                                                                |
| 생각 모드 + `temperature: 0.3`                         | 200 (무시되는 것으로 보임)                                                                         |
| `thinking: {"type": "disabled"}`                       | 200, 생각 조각이 오지 않음                                                                         |
| 쉬운 요청의 첫 차례                                    | 생각이 0글자일 수 있음 → 상자를 그리지 않는다                                                      |

따라서 규칙은 다음과 같다.

1. **재전송:** `reasoning`이 있는 모든 AI 답에 `reasoning_content`를 넣는다. 도구를 쓰지 않은 차례도 포함한다.
   공식 문서가 요구하는 방식이며, 모델이 앞선 생각을 이어 쓰게 한다.
2. **빈칸:** `reasoning`이 없는 AI 답(다시 연 옛 대화, 다른 AI의 답, 자동 요약 뒤의 답)은 그대로 둔다.
   칸을 채우지도, 생각 모드를 끄지도 않는다. 현재 서버는 이를 받아들인다.
3. **`temperature`:** 생각 모드(기본)로 보내는 요청에는 `temperature`를 넣지 않는다.
   `thinking: disabled`로 보내는 요청에는 기존 값 0.3을 넣는다.
4. **400 안전망:** 서버가 나중에 규칙을 엄격하게 바꿀 수 있으므로,
   HTTP 400을 받고 본문에 `reasoning_content`가 있으면 같은 요청을 `thinking: disabled`로 **한 번만** 다시 보낸다.
   400은 응답 시작 전에 오므로 화면에 보낸 조각이 없을 때만 재시도한다.
5. **실측 확인 스크립트:** 구현 마지막 작업의 실제 확인에서 같은 항목을 다시 확인하고 수용 로그에 남긴다.
   키는 환경 변수에서만 읽고 출력하지 않는다.

### 4.4 "생각 과정" 상자 (`ThinkingBox`)

- **속성:** `{ text: string; live: boolean; lang: 'ko' | 'en' }`.
- **`live`일 때 (생각 중, 답변 글이 아직 없음):**
  - 흐린 글씨 상자에 `text`를 실시간으로 표시한다.
  - 높이는 최대 6줄로 제한하고, 맨 아래를 따라 내려간다.
  - 제목은 "생각 중…" / "Thinking…"이다.
- **답변 글이 시작되거나 차례가 끝나면:**
  - 한 줄("생각 과정 보기 ▸" / "Show thinking ▸")로 접힌다.
  - 누르면 펼쳐져 전체를 보여 주고("생각 과정 접기 ▾"), 다시 누르면 접힌다.
- **표시하지 않는 경우:** `text`가 비어 있으면 아무것도 그리지 않는다. 생각 내용이 없는 AI가 해당한다.
- **글 처리:** 생각 내용은 Markdown이 아닌 일반 글로 그린다. 문서에서 온 내용이 섞일 수 있어 링크·HTML을 해석하지 않는다.
- **접근성:** 상자 머리는 `button`이고 `aria-expanded`를 가진다.
- **다시 연 대화:** 접힌 상태로 그린다.

### 4.5 오류 처리

- 생각 조각이 깨지거나 형식이 달라도 답변 글과 도구 호출은 계속된다. 생각 표시만 빠진다.
- 사용자가 중지하면 그때까지의 생각 내용은 화면에 남는다. 기록·저장에는 넣지 않는다 (기존 중지 처리와 같음).
- 400 안전망 재시도도 실패하면 기존과 같은 오류 메시지를 보인다.
- 키와 생각 원문은 로그(`console`, 메인 로그)에 남기지 않는다.

### 4.6 테스트용 키 미리 넣기 (시작 시 시드)

실제 확인 때마다 설정 화면에서 키를 입력하지 않도록, 앱이 시작할 때 환경 변수의 키를 한 번 저장한다.

- **환경 변수:** `GENOFFICE_SEED_DEEPSEEK_API_KEY`. 사용자가 Windows 사용자 환경 변수로 직접 설정한다.
- **동작 조건:** 그 프로필에 DeepSeek 키가 아직 없을 때만 저장한다. 이미 저장된 키는 덮어쓰지 않는다.
- **저장 경로:** 설정 화면에서 키를 넣을 때와 같은 경로(`AiSettingsService.verifyAndSave`)를 탄다.
  키가 맞는지 DeepSeek에 확인한 뒤 암호화(`safeStorage`)해서 `ai-secrets.json`에 저장한다.
- **확인 실패:** 저장하지 않고 로그에 "시작 키 확인 실패" 한 줄만 남긴다. 키 값과 서버 응답 본문은 남기지 않는다.
- **적용 범위:** 설치본, 개발 실행, 테스트 드라이버 모두 같은 방식이다. 드라이버의 임시 프로필에서는 시작할 때마다 저장된다.
- **키 위치:** 키 값은 코드, 저장소(git), 설치 파일, 계획·로그·화면 캡처 어디에도 넣지 않는다.
- **범위 한정:** 이 기능은 환경 변수가 있을 때만 동작하며, 설정 화면이나 기본 AI 선택은 바꾸지 않는다 (기본 AI는 Codex).
- **테스트 종료 후:** 사용자가 환경 변수를 지우면 시드는 더 이상 동작하지 않는다. 이미 저장된 키는 설정 › AI에서 지운다.

## 5. 테스트와 수용

### 5.1 자동 테스트 (먼저 실패하는 테스트를 쓴다)

- **ai-provider**
  - DeepSeek 요청 본문: 원문 재전송, 빈칸은 그대로 둠, 생각 모드에서 `temperature` 없음,
    `thinking: disabled`일 때 `temperature` 있음
  - 실시간 응답: `reasoning_content` 조각과 `content` 조각을 나눠 넘김
  - 400 안전망: 한 번만 재시도, 조각을 보낸 뒤에는 재시도하지 않음
  - 다른 서비스: OpenAI 호환 요청 본문이 바뀌지 않음
  - Codex: 생각 요약이 `onReasoningSummaryDelta`로 감
- **agent-core**
  - 원문과 표시용을 나눠 모음, `onThinking` 누적
  - `reasoning` 칸 보존: 기록 복사, 복원, 자동 요약, 실패 정리
  - 원문이 없으면 칸이 생기지 않음
- **project-store:** `reasoning`·`thinking` 저장·읽기 왕복, 32,000자 자르기(뒷부분 유지)
- **ui:** `ThinkingBox`
  - 생각 중 표시, 답변 시작 시 접힘, 펼치기/접기, 빈 글이면 그리지 않음
  - 링크·HTML을 해석하지 않음
- **설정 이전:** 저장된 `deepseek-chat`/`deepseek-reasoner` 경로 → `deepseek-flash`
- **시드(§4.6):** 변수가 없으면 아무것도 하지 않음 / 키가 이미 있으면 덮어쓰지 않음 / 확인에 실패하면 저장하지 않음 /
  성공하면 `verifyAndSave`와 같은 경로로 저장 / 어떤 경우에도 키 값이 로그와 오류 메시지에 나타나지 않음
- **각 패널:** 생각 조각이 상자로 그려지고, 다시 열 때 원문이 기록으로 복원됨

### 5.2 실제 확인 (키는 앱만 사용)

0. §4.6 시드로 DeepSeek 키가 저장됐는지 확인 (설정 › AI의 DeepSeek 상태)
1. §4.3 실측 항목 다시 확인
2. **한글 패널, DeepSeek:**
   - "찾기 → 고치기" 편집이 끝까지 됨
   - 생각 과정 상자가 쌓였다가 접히는 것을 화면 캡처로 확인
3. 앱을 닫았다 다시 연 대화에 이어서 요청
4. Codex → DeepSeek으로 바꾼 대화에 이어서 요청
5. Codex 대화에서 생각 요약 표시
6. 워드 패널에서 같은 확인을 한 번 더 함 (다른 모듈 대표)
7. 설치본(exe)에서 2·5를 다시 확인

## 6. 위험

| 위험                                                          | 대응                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 재전송으로 요청 크기가 커짐                                   | 반복 부분은 캐시 요금이라 비용이 작다. 저장 상한 32,000자                                               |
| DeepSeek 서버가 나중에 reasoning_content 규칙을 엄격하게 바꿈 | 400 안전망(§4.3-4)이 한 번 재시도하고, 실제 확인에서 다시 측정한다                                      |
| DeepSeek 모델 이름이 또 바뀜                                  | 모델 목록은 키로 DeepSeek에 묻고, 등록 이름이 없으면 실제 이름을 보여 준다 (기존 `ai-catalog-cache.ts`) |
| 생각 내용에 문서 내용이 섞임                                  | 일반 글로만 그리고, 링크·HTML을 해석하지 않음                                                           |

## 7. 참고

- [DeepSeek API — Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [DeepSeek API — Change Log](https://api-docs.deepseek.com/updates/)
- [DeepSeek API — Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
