# Codex CLI 기본 AI + 업스트림 프로바이더 11종 설계 (Phase 3)

- 날짜: 2026-10-01
- 상태: 설계 승인(대화), 스펙 검토 대기
- 선행: Phase 1(`2026-09-21-hwp-local-self-hosting-design.md`) — 네이티브 바이너리 패키징 계약(`resources/native/`,
  `beforePack` 존재 검사, 릴리스 자산 + SHA256 검증 fetch 스크립트)을 그대로 쓴다.
- 범위: `packages/ai-provider`(Codex 브리지 포팅, 프로바이더 메타·엔드포인트), `apps/docs/src/main`(설정·카탈로그·라우팅 —
  5개 모듈 공용), `apps/shell`(Codex 계정 IPC, 설정 카드, 패키징), `tools/fetch-codex.mjs`.
- 순서: **M1 Codex** → **M2 프로바이더 11종** → (이후) Phase 2 HWP AI 엔진. 계획은 M1·M2 각각 작성한다.

## 1. 배경

포크의 AI는 Genspark 로그인 또는 사용자 API 키(10개 프로바이더, 공개 8개)로만 동작한다. 사용자는 ChatGPT 구독(Codex)을
기본 AI로 쓰고, 다른 API 키 프로바이더도 함께 쓰기를 원한다. 원본 `genspark-ai/genoffice`(Apache-2.0, `upstream/main`
`676bf4d5`)에는 이미 다음이 있다.

- `packages/ai-provider/src/codex-app-server.ts`(1,083줄) + 테스트 2개: 설치된 Codex CLI를 `codex app-server`(stdio
  JSON-RPC)로 띄워 Codex 자체 ChatGPT 로그인으로 모델을 쓰는 브리지. 모델 목록은 `model/list`, 문서 도구 호출은
  JSON Schema 구조화 출력(`outputSchema`)으로 받아 GenOffice가 실행한다.
- 프로바이더 22종(포크에 없는 것: codex, qwen, doubao, mimo, hunyuan, xai, mistral, requesty, opper,
  cheaperinference, opencode-zen, opencode-go)과 엔드포인트 어댑터(`registry.ts` — temperature 생략,
  `max_completion_tokens`, `bodyExtras`, 모델별 프로토콜 분기).

업스트림에 없는 것: 앱 안의 Codex 로그인/로그아웃/상태 표시(경로 입력란만 있음), Codex 동봉(설치된 CLI만 탐지).

결정 기록(대화): CLIProxyAPI 동봉안은 폐기 — 공식 Codex 클라이언트가 ChatGPT 구독의 정상 경로이고 업스트림이 검증한 코드다.
Codex 계정은 하나. Codex는 설치본에 동봉한다.

## 2. 실측 (2026-10-01, 이 PC)

| 항목                                | 결과                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 로컬 Codex                          | VS Code 확장 동봉 `codex-cli 0.159.2`, `~/.codex`, ChatGPT 로그인(`planType: prolite`). 업스트림 자동 탐지 경로(`%LOCALAPPDATA%\OpenAI\Codex\bin`, PATH)에는 없음                                                                                                                                                                                                                                                                                                               |
| 릴리스(rust-v0.159.3, 최신)         | 단독 `codex-app-server-x86_64-pc-windows-msvc.exe.zip` 77.0 MB(압축 해제 248,790,832 B), `sha256:abfb74a8765c870674a3ea94b873b861b041dc6e3963f7433cb5b66c300abd64`; mac `aarch64-apple-darwin.tar.gz` 69.9 MB `sha256:40edf61c2c6b3429541e010409f6934c29327b4d3b03df5265cbf21b35ddbc83`, `x86_64` 76.0 MB `sha256:aa723f184f50d2502820fb89bc70a8dc1f7c92d894dd3f13d27684916ca52049`. 전체 `codex.exe`는 zip 154 MB(원본 309.7 MB). GitHub API `assets[].digest`가 SHA256을 준다 |
| 단독 바이너리 실행                  | 하위명령 없이 `codex-app-server --listen stdio://`(전체 CLI는 `codex app-server --listen stdio://`). `-c key=value` 설정 덮어쓰기 지원                                                                                                                                                                                                                                                                                                                                          |
| `initialize`                        | `{ userAgent, codexHome: "C:\\Users\\…\\.codex", platformFamily: "windows" }` — 로그인은 기존 Codex와 `~/.codex`를 공유                                                                                                                                                                                                                                                                                                                                                         |
| `account/read {refreshToken:false}` | `{ account: { type: "chatgpt", email, planType }, requiresOpenaiAuth: true }`(미로그인 시 `account: null`)                                                                                                                                                                                                                                                                                                                                                                      |
| `model/list`                        | 8개: gpt-6.1-sol(**isDefault**), gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, **gpt-5.6-luna**, gpt-5.5                                                                                                                                                                                                                                                                                                                                                      |
| 로그인 RPC                          | `account/login/start {type:"chatgpt"}` → `loginId` + 브라우저 URL, 완료 시 알림 `account/login/completed`; `account/login/cancel {loginId}` → `{status:"canceled"}`; `account/logout` 존재(**호출하면 실제로 `~/.codex/auth.json`이 삭제됨** — 스파이크 사고로 확인)                                                                                                                                                                                                            |
| 구조화 턴                           | `thread/start` + `turn/start {outputSchema}`로 `gpt-5.6-luna`가 `{"text":"","toolCalls":[{"name":"find","inputJson":"{\"query\":\"예산\"}"}]}` 반환. 프로세스 기동 포함 첫 턴 11.9 s, 재기동 6.5 s                                                                                                                                                                                                                                                                              |
| Windows sandbox                     | 업스트림 permission profile(`default_permissions` + `:minimal` read)은 이 PC(`[windows] sandbox = "elevated"`)에서 `thread/start` 실패: "elevated Windows sandbox requires effective `:root` read access". `-c windows.sandbox="unelevated"`로 덮어써도 동일. 업스트림 폴백 `sandbox: "read-only"` → `{type:"readOnly", networkAccess:false}`로 성공                                                                                                                            |

## 3. 목표와 비목표

### 목표

- G1. 새 설치의 기본 AI = Codex(`gpt-5.6-luna`; 계정 목록에 없으면 계정 기본 모델). 5개 모듈 전부.
- G2. 설정 화면에서 ChatGPT 로그인·로그아웃·연결 상태(이메일·플랜)를 다룬다. 터미널 불필요.
- G3. Codex 없는 PC에서도 설치본 하나로 동작(동봉 바이너리).
- G4. 기존 API 키 프로바이더 + 업스트림 11종을 Codex와 함께 쓴다(모델 선택기·전역 기본 어디서나).
- G5. 토큰은 Codex가 관리한다. 앱은 `auth.json`을 읽거나 복사하지 않고 렌더러로 계정 비밀을 넘기지 않는다.

### 비목표

- Codex 다중 계정·순환. Codex의 사용량/요금 표시(`account/rateLimits/read`) — 후속.
- 업스트림의 다른 기능(AI Media & Search, TypeSafe Jev, `genoffice` CLI/스킬, MCP) 포팅.
- 업스트림과의 전면 동기화. 포크의 설정·비밀 저장·라우팅 구조(`AiSettingsService`, `AiSecretStore`, 문서별 고정 라우트)는 유지하고
  업스트림 코드는 그 구조에 맞춰 이식한다.

## 4. 아키텍처

```
렌더러(5개 모듈 AI 패널, 설정 모달)                    메인 프로세스
  model picker ── ai:models:list ───────────────►  AiSettingsService ─ AiCatalogCache ─┬─ codex: listCodexModels()
  AI 패널 ─────── ai:stream ─────────────────────►  ai-routing-ipc ─ streamForProvider ┼─ codex: streamCodexAppServer()
  설정 카드 ───── codex:status/login/logout ──────►  codex-account.ts ─────────────────┘        │ stdio JSON-RPC
                                                                                     codex-app-server[.exe] (resources/native)
                                                                                     로그인 상태: ~/.codex (Codex가 관리)
```

- 단일 디스패치 지점은 `apps/docs/src/main/ai-routing-ipc.ts`(`streamForProvider`/`chatForProvider` 유일 호출처)라서
  `codex`·11종 추가가 5개 모듈에 한 번에 적용된다.
- app-server 프로세스는 업스트림 클라이언트가 공유·유휴 종료(120 s)한다. 계정 RPC(`codex-account.ts`)도 같은 클라이언트 풀을 쓴다.

## 5. M1 — Codex

### 5.1 공급과 실행 파일 해석

- `tools/fetch-codex.mjs`: 고정 버전(`rust-v0.159.3`)의 플랫폼별 단독 app-server 자산을 받아 **스크립트에 고정한 SHA256**(§2)과
  대조한 뒤 `apps/shell/native/codex/<platform>-<arch>/codex-app-server[.exe]`로 푼다(zip: Windows 내장 `tar -xf`, tar.gz:
  `tar -xzf`). 스탬프 파일로 재다운로드를 건너뛴다. CI·`build:all`에 단계 추가.
- `electron-builder.cjs` 플랫폼 `extraResources`: `native/codex-app-server[.exe]`. `beforePack` 검사가 자동으로 덮는다.
  설치본 증가 예상 ≈ +80 MB.
- 해석 순서(`resolveCodexBinary`): ① 설정의 사용자 지정 경로(설치된 Codex 사용) → ② 동봉본(`resources/native`, dev는
  `apps/shell/native/codex/…`) → ③ 업스트림 자동 탐지(관리 경로·PATH) + **VS Code 확장 경로**
  `~/.vscode/extensions/openai.chatgpt-*/bin/<plat>/codex[.exe]`(최신 버전). 동봉본을 ①보다 뒤, ③보다 앞에 둬 테스트한 버전이
  기본이 되게 한다.
- 실행 인자는 바이너리 종류로 정한다: 이름이 `codex-app-server`로 시작하면 `['--listen','stdio://']`, 아니면
  `['app-server','--listen','stdio://']`(업스트림 `codexAppServerLaunchArgs` 확장).

### 5.2 브리지 포팅

- `packages/ai-provider/src/codex-app-server.ts`와 의존물(업스트림 `protocols/shared.ts`의 `parseToolInput`·도구 예산,
  `watchdog.ts`)을 이식하고 업스트림 테스트 `codex-app-server.test.ts`, `codex-stdout-lines.test.ts`를 함께 옮긴다.
  출처는 `docs/upstream-provenance.md`·`MODIFICATIONS.md`에 커밋 `676bf4d5`로 기록한다.
- 업스트림 동작 유지: 스레드 `ephemeral`, `approvalPolicy:"never"`, `cwd`=임시 디렉터리, `baseInstructions`(Codex 내장 도구
  금지), permission profile 시도 → 실패 시 `sandbox:"read-only"` 폴백(§2 실측: Windows는 폴백 경로), 줄 버퍼 4 MB 상한,
  중단 시 `turn/interrupt`.
- 추가: `AiProviderConfig.cliPath`(사용자 지정 경로), 해석 함수 주입(§5.1), 이미지 입력(`localImage`)은 업스트림 그대로.

### 5.3 프로바이더 통합 (포크 구조)

- `types.ts`: `AiProviderId += 'codex'`, `AiProviderProtocol += 'codex-app-server'`, `AiProviderAuth += 'codex-login'`,
  `AiProviderConfig.cliPath?`. `providers.ts`: `{ id:'codex', label:'Codex (ChatGPT)', protocol:'codex-app-server',
auth:'codex-login', modelSource:'remote', models:[], defaultModel:'gpt-5.6-luna', keyPlaceholder:'' }`.
- `stream.ts`/`chat.ts`: `case 'codex'` → `streamCodexAppServer`/`chatCodexAppServer`.
- `PUBLIC_AI_PROVIDER_IDS`(맨 앞) `+= 'codex'`.
- `AiSettingsService`(genspark와 같은 특수 분기):
  - configured = `codexAccount.status()`가 `connected`(캐시된 마지막 `account/read`, 5분 TTL; 로그인·로그아웃 직후 무효화).
  - `getProviderConfig(codex)` → `{ apiKey:'', model, cliPath? }`.
  - `publicProvider(codex)` → `status: connected | not-configured | unavailable`, `accountLabel = email`.
  - `DEFAULT_ROUTE = { providerId:'codex', modelId:'gpt-5.6-luna' }` — 새 설치만. 기존 설정 파일의 `globalDefault`는 그대로.
  - `setGlobalDefault`/`assertRouteAvailable`: codex 미연결이면 "Codex에 로그인하세요"(설정 위치 포함) 오류.
- `AiCatalogCache`: codex 카탈로그 = `listCodexModels(cliPath)` → `AiModelSummary`(`supportsTools: true` — 구조화 출력으로
  도구 지원, 입력 `text`+`image`, 컨텍스트 미상 `null`). 계정 목록에 `gpt-5.6-luna`가 없으면 기본 라우트는 계정
  `isDefault` 모델로 대체한다(패널의 기존 "첫 호환 모델" 폴백과 같은 경로).

### 5.4 계정 IPC와 설정 카드

`apps/shell/src/main/codex-account.ts`(Electron 의존은 `openExternal` 주입만):

| 채널                 | 동작                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex:status`       | `account/read {refreshToken:false}` → `{ state:'connected', email, planType, binary:{path, source:'custom'\|'bundled'\|'detected', version} }` \| `{ state:'signed-out' }` \| `{ state:'error', message }` |
| `codex:login`        | `account/login/start {type:'chatgpt'}` → URL을 `shell.openExternal`, `account/login/completed` 대기(10분) → 상태 무효화·카탈로그 갱신 → 새 상태 반환                                                       |
| `codex:login-cancel` | `account/login/cancel {loginId}`                                                                                                                                                                           |
| `codex:logout`       | 메인이 확인 대화상자(계정 이메일 표시, "이 PC의 Codex 앱·VS Code 확장도 로그아웃됩니다") 후 `account/logout`                                                                                               |

- 렌더러에는 이메일·플랜·바이너리 경로/출처/버전만 간다. URL은 메인이 직접 연다.
- 설정 모달: 프로바이더 목록 맨 위 "Codex (ChatGPT 로그인)" 카드 — 상태 배지, [ChatGPT로 로그인]/[로그인 취소]/[로그아웃],
  "설치된 Codex 사용" 경로 입력(비우면 동봉본), 사용 중 바이너리 표시. 업스트림 `shouldShowGensparkLogin` 패턴을 따른다.
- AI 패널: 라우트가 codex인데 미연결이면 기존 `modelNotice`에 "Codex에 로그인하세요 — 설정 › AI" 표시.
- 기기 코드 로그인·API 키 로그인(`account/login/start`의 다른 `type`)은 M1 계획 Task 0에서 지원 여부를 확인해 **지원되면**
  버튼을 추가하고, 아니면 넣지 않는다(카드 문구만으로 대체하지 않는다).

### 5.5 오류 처리

| 상황                                                      | 동작                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 바이너리 없음/실행 실패                                   | `codex:status` `error`("Codex 실행 파일을 찾을 수 없습니다: <경로>"), 카드에 표시. 다른 프로바이더는 영향 없음 |
| 미로그인 상태로 codex 라우트 호출                         | 업스트림 메시지 "Codex CLI is not signed in" → 패널 안내(§5.4)                                                 |
| 로그인 10분 무응답/브라우저 닫힘                          | `account/login/cancel` 후 `signed-out`                                                                         |
| 턴 실패(`turn/completed status:failed`, 비재시도 `error`) | 업스트림 처리 그대로 패널 오류                                                                                 |
| 앱 종료                                                   | `before-quit`에서 `shutdownCodexAppServers()`                                                                  |

### 5.6 보안

- 앱은 `auth.json`을 열지 않는다. 계정 정보는 `account/read` 응답의 email·planType만 쓴다.
- Codex 내장 도구 위험: read-only sandbox는 Codex 셸 도구의 디스크 읽기를 막지 못한다(업스트림 주석, §2). 완화 —
  `approvalPolicy:"never"`, `networkAccess:false`, 임시 `cwd`, ephemeral 스레드, 도구 금지 지시. M1 Task 0에서 `-c`로 셸 도구를
  끄는 설정이 있는지 확인하고, 있으면 기본으로 넘긴다.
- **테스트·드라이버·스파이크는 `account/logout`과 계정을 바꾸는 RPC를 실제 바이너리에 호출하지 않는다**(로그아웃은 가짜
  클라이언트로만 검증). `account/login/start`는 즉시 `cancel`하는 조건에서만 계약 테스트에 쓴다.

## 6. M2 — 업스트림 프로바이더 11종

모두 API 키(Bearer) + OpenAI 호환. 메타(라벨·모델 목록·기본 모델·키 형식·키 발급 링크·도움말)는 업스트림 `providers.ts`에서,
엔드포인트는 업스트림 `registry.ts`에서 가져온다.

| id               | 라벨              | 기본 URL                                            | 기본 모델                  | 이미지 | 특이 처리                                                    |
| ---------------- | ----------------- | --------------------------------------------------- | -------------------------- | ------ | ------------------------------------------------------------ |
| qwen             | Qwen              | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen3.8-max                | 아니오 | —                                                            |
| doubao           | Doubao            | `https://ark.cn-beijing.volces.com/api/v3`          | doubao-seed-2-1-pro-260628 | 예     | —                                                            |
| mimo             | MiMo              | `https://api.xiaomimimo.com/v1`                     | mimo-v2.6-pro              | 예     | —                                                            |
| hunyuan          | Hunyuan           | `https://tokenhub.tencentmaas.com/v1`               | hy4-preview                | 아니오 | reasoning 반향(업스트림 `modelEchoesReasoning`)              |
| xai              | Grok              | `https://api.x.ai/v1`                               | grok-4.6                   | 예     | —                                                            |
| mistral          | Mistral           | `https://api.mistral.ai/v1`                         | mistral-medium-latest      | 아니오 | —                                                            |
| requesty         | Requesty          | `https://router.requesty.ai/v1`                     | claude-sonnet-5            | 예     | 저장된 base URL로 지역 라우터                                |
| opper            | Opper             | `https://api.opper.ai/v3/compat`                    | claude-sonnet-4-6          | 예     | —                                                            |
| cheaperinference | Cheaper Inference | `https://api.cheaperinference.com/v1`               | gpt-5.4-mini               | 예     | —                                                            |
| opencode-zen     | OpenCode Zen      | `https://opencode.ai/zen` (프로토콜별 하위 경로)    | claude-sonnet-5            | 예     | claude·qwen은 Anthropic `/v1/messages`, gemini는 Gemini 경로 |
| opencode-go      | OpenCode Go       | `https://opencode.ai/zen/go` (프로토콜별 하위 경로) | kimi-k2.7-code             | 예     | minimax·qwen3.8-flash는 Anthropic 경로                       |

- 공통 특이 처리 포팅: `modelHasFixedSampling`(gpt-5+/kimi-k3/gemini-3/o-series → temperature 생략),
  `useMaxCompletionTokens`, `modelEchoesReasoning`, `bodyExtras`. 포크의 기존 openai/kimi/deepseek 경로에도 같은 규칙을 적용해
  업스트림과 동작을 맞춘다(현재 포크는 gpt-5 계열에 temperature를 보낼 수 있다 — 계획에서 회귀 테스트로 확인).
- 키 검증: 포크의 `verifyOpenAiCompatibleModelsKey`(GET `/models`). `/models`가 없는 엔드포인트(M2 Task 0에서 11종 각각
  확인)는 `max_tokens:1` 채팅 프로브로 검증한다. 카탈로그: `conservativeRemoteModels`(업스트림 모델 목록을 허용 목록으로) —
  `/models`가 없으면 업스트림 정적 목록.
- 설정 카드·`PROVIDER_HELP`·`PROVIDER_KEY_LINKS`·`KEY_PLACEHOLDERS`에 11종 추가. `PUBLIC_AI_PROVIDER_IDS`에 추가.
- 비밀 저장·검증·라우트 고정 등 나머지는 기존 키 프로바이더와 동일 경로.

## 7. 테스트

- 유닛: 업스트림 테스트 이식(codex 2개, providers/registry 관련), 신규 — `resolveCodexBinary` 순서·인자, `codex-account`
  상태 기계(가짜 RPC 클라이언트: 로그인 완료·취소·타임아웃·로그아웃), `AiSettingsService` codex 분기(configured·기본 라우트·
  기존 설정 유지·미연결 오류), 카탈로그 정규화, 11종 엔드포인트·특이 처리 골든, 검증 프로브 분기.
- 계약(실바이너리, 없으면 skip): 동봉 `codex-app-server` — `initialize`, `account/read`, `model/list`, `account/login/start`
  →즉시 `cancel`. 계정 변경 RPC 금지(§5.6).
- 드라이버(패키지 앱, 이 PC의 실제 로그인): 설정 카드 "연결됨"·이메일, 모델 선택기에 Codex 모델, HWP 또는 Docs 패널에서
  `gpt-5.6-luna` 실제 턴 1회(도구 호출 포함). M2는 키가 있는 프로바이더만 수동 확인(키 없음은 미검증으로 기록).
- 마무리: 버전 0.5.0, `dist:win` 재빌드, 설치본 크기 기록.

## 8. 위험과 선행 확인 (계획 Task 0)

1. `account/login/start`의 다른 `type`(기기 코드, API 키) 지원 여부 → §5.4 버튼 범위.
2. Codex 셸 도구를 끄는 `-c` 설정 존재 여부 → §5.6.
3. 동봉 0.159.3과 사용자 설치 Codex(0.159.2 등)의 app-server 프로토콜 차이 → 사용자 지정 경로를 쓸 때의 호환.
4. 업스트림 `codex-app-server.ts` 의존 모듈 범위(포크에 없는 `protocols/`, `watchdog`) — 최소 이식 단위 확정.
5. 11종 각각의 `/models` 지원 여부·키 검증 방식.
6. 설치본 크기(+80 MB 예상)와 NSIS 압축 후 실측.

## 9. 변경 파일 (예상)

신규: `packages/ai-provider/src/codex-app-server.ts`(+의존), `packages/ai-provider/tests/codex-*.test.ts`,
`apps/shell/src/main/codex-account.ts`, `apps/shell/src/main/codex-binary.ts`, `tools/fetch-codex.mjs`, 각 테스트.

수정: `packages/ai-provider/src/{types,providers,stream,chat,verification,index}.ts`, `apps/docs/src/shared/ipc.ts`,
`apps/docs/src/main/{ai-settings-service,ai-catalog-cache,ai-routing-ipc}.ts`, `apps/shell/src/main/index.ts`,
`apps/shell/src/preload/index.ts`, `apps/shell/src/renderer/src/settings/{AiSettingsModal.tsx,provider-card.ts}`,
`apps/shell/electron-builder.cjs`, `package.json`(스크립트·버전), `.gitignore`, `.github/workflows/ci.yml`, `README.md`,
`MODIFICATIONS.md`, `docs/upstream-provenance.md`, `tools/gen-third-party-notices.mjs`(Codex Apache-2.0 고지).
