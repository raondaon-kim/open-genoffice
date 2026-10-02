# AI 생각 과정 실시간 표시와 DeepSeek 생각 모드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기본 AI(Codex)의 생각 요약과 DeepSeek의 생각 원문을 다섯 모듈(한글·워드·엑셀·파워포인트·PDF)의 AI 패널에 접히는 "생각 과정" 상자로 실시간 표시하고, DeepSeek 요청에 앞 차례의 생각 원문을 돌려보낸다. DeepSeek 모델 목록을 현재 API(`deepseek-flash`, `deepseek-v4-pro`)로 맞추고, 테스트용 DeepSeek 키를 환경 변수로 미리 넣는다.

**Architecture:** 생각 내용을 두 종류로 나눈다. 원문(`reasoning`)은 화면에 보이고, 저장되고, DeepSeek 요청에만 돌려보낸다. 요약(`summary`, Codex)은 화면과 저장에만 쓴다. 공급자 부품(`ai-provider`)이 두 종류의 조각을 콜백으로 내보내고, 메인 연결부(`ai-routing-ipc`)가 `thinking` 조각으로 화면에 보내며, 대화 처리 부품(`agent-core`)이 차례마다 모아 기록의 AI 답 `reasoning` 칸과 실행 결과에 담는다. 화면 부품 `ThinkingBox`(`@genoffice/ui`)를 다섯 패널이 함께 쓰고, 대화 저장소(`project-store`)가 두 칸을 저장·복원한다.

**Tech Stack:** TypeScript, React 19, Electron IPC, vitest (jsdom), 기존 패키지(`@genoffice/agent-core`, `@genoffice/ai-provider`, `@genoffice/project-store`, `@genoffice/ui`).

**Spec:** `docs/superpowers/specs/2026-10-02-ai-thinking-stream-design.md`

## Global Constraints

- 기본 AI는 Codex(`gpt-5.6-luna`)로 유지한다. DeepSeek은 모델 선택이나 설정 › AI의 기본 AI로 고른다. 키를 넣어도 기본 AI를 바꾸지 않는다.
- DeepSeek 모델 목록은 `['deepseek-flash', 'deepseek-v4-pro']`, 기본 모델은 `deepseek-flash`다.
  저장된 `deepseek-chat` / `deepseek-reasoner` 경로는 읽을 때 `deepseek-flash`로 바꾼다.
- 생각 원문 재전송은 **DeepSeek 요청에만** 적용한다. 다른 서비스의 요청 본문은 바뀌지 않는다.
- DeepSeek 요청: 생각 모드(기본)에는 `temperature`를 넣지 않는다. `thinking: { type: 'disabled' }`로 보낼 때만 `temperature: 0.3`을 넣는다.
- 원문이 없는 AI 답은 그대로 둔다 (칸을 채우지도, 생각 모드를 끄지도 않는다). 실측으로 200이 확인됐다.
- 400 안전망: 생각 모드 요청이 HTTP 400이고 본문에 `reasoning_content`가 있으면 `thinking: disabled`로 **한 번만** 다시 보낸다.
- 저장: `reasoning`과 `thinking`은 각각 최대 32,000자이고, 넘으면 **뒷부분**을 남긴다. 글자 한가운데(서로게이트 쌍)가 잘리지 않게 한다.
- 화면: 생각 중에는 최대 6줄 상자(맨 아래로 따라 내려감), 답변이 시작되거나 차례가 끝나면 한 줄로 접힌다. 생각 내용은 일반 글로만 그리고 링크·HTML을 해석하지 않는다. 내용이 비어 있으면 아무것도 그리지 않는다.
- 키와 생각 원문은 로그(`console`, 메인 로그), 오류 메시지, 화면 캡처, 계획·원장에 남기지 않는다.
- 시드: `GENOFFICE_SEED_DEEPSEEK_API_KEY`가 있고 그 프로필에 DeepSeek 키가 아직 없을 때만 저장한다. 저장은 `AiSettingsService.verifyAndSave`를 거친다.
- 테스트는 먼저 실패하는 것을 쓴다 (RED → GREEN). 린트·타입 검사가 모든 커밋의 관문이다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`를 넣는다.
- `git commit`은 다른 명령과 묶지 말고 단독으로 실행한다 (저장소의 훅이 묶음 명령을 오탐지한다). 메시지 본문은 `-m`을 여러 번 써서 나눈다.
- 실제 Codex 계정으로 `account/logout`이나 API 키 로그인을 호출하지 않는다. `~/.codex/auth.json`을 읽거나 복사하지 않는다.

## Review Focus

스펙이 암시하지만 작업별 테스트가 따로 다루지 않는 입력과 실패 모드이다. 각 줄의 테스트는 그 코드를 가진 작업에 넣었다.

1. **모르는 조각 종류가 스트림을 죽임.** 렌더러 전송 층 다섯 곳은 알 수 없는 조각을 오류로 처리하고 구독을 끝낸다.
   메인이 `thinking` 조각을 보내기 시작하면, 고치지 않은 전송 층은 모든 대화를 끊는다. → 작업 3(공용 IPC 전송), 8~12(모듈별 전송)에 "thinking 조각이 오류가 아니고 스트림을 끝내지 않는다" 테스트.
2. **차례 도중 중지.** 생각 중에 멈추면 그 차례의 AI 답에 원문이 없어 이후 요청이 모두 "빈칸"이 된다. 기록에는 원문을 남기고 저장은 하지 않아야 한다. → 작업 3 `stop` 테스트.
3. **긴 생각과 글자 경계.** 복원한 `reasoning`이 요청 크기와 압축 예산을 키운다. 잘린 앞부분이 이모지·한글 서로게이트 한가운데면 깨진 글자가 저장된다. → 작업 3 예산 테스트, 작업 6 자르기 테스트.
4. **생각 내용이 HTML·링크를 품음.** 문서에서 온 글이 섞일 수 있으므로 해석하지 않고 글자로만 그려야 한다. → 작업 7.
5. **시드가 키를 흘림.** 확인 실패·예외 메시지에 키가 들어가면 로그에 남는다. → 작업 1 (모든 실패 경로에서 `warn` 호출 내용에 키가 없음).

## 사전 점검 (Pre-flight)

| 생산 작업 → 소비 작업 | 넘기는 것                                                                                                                                                                                                                                 | 확인 결과                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 3 → 4                 | agent-core `AgentStreamCallbacks.onThinking(text, kind)`와 ai-provider `StreamCallbacks.onReasoningDelta` / `onReasoningSummaryDelta`는 **서로 다른 이름**이다. 둘을 잇는 것은 5(메인 연결부)가 보내는 `thinking` 조각과 8~12(전송 층)다. | 이름을 섞지 않는다. 5가 `onReasoningDelta`→`thinkingKind: 'reasoning'`, `onReasoningSummaryDelta`→`'summary'`로 보낸다. |
| 3 ↔ 4                 | `IpcStreamChunk`(agent-core)와 `AiStreamChunk`(ai-provider)는 구조가 같아야 한다.                                                                                                                                                         | 둘 다 `type`에 `'thinking'`, `thinkingKind?: 'reasoning' \| 'summary'`를 추가한다 (3, 4).                               |
| 3 → 8~12              | `toRestorableMessages`, `AgentRunResult.reasoning/thinking`, `AgentLoopEvents.onThinking`                                                                                                                                                 | 작업 3이 `@genoffice/agent-core`에서 내보낸다.                                                                          |
| 6 → 8~12              | `ChatMessage.reasoning/thinking`, `AppendChatArgs.reasoning/thinking`                                                                                                                                                                     | 작업 6이 project-store와 네 메인의 `project:appendChat` 핸들러에 넣는다. 한글은 docs 메인 핸들러를 쓴다.                |
| 7 → 8~12              | `ThinkingBox`, `thinkingLabels(lang)`                                                                                                                                                                                                     | 작업 7이 `@genoffice/ui`에서 내보낸다.                                                                                  |

## 미리 내린 결정 (Ruling)

- **R1.** 저장된 키가 `unreadable`(암호 해독 불가)이면 시드는 다시 저장한다. 읽을 수 없는 키는 쓸 수 없고, 테스트용 시드가 복구해 준다. 비용: 사용자가 일부러 남긴 읽을 수 없는 키를 덮어쓴다 (이미 쓸 수 없음).
- **R2.** 사용자가 중지한 차례의 생각 원문은 **메모리 기록에는 남기고 저장소에는 넣지 않는다.** 스펙 §4.5의 "기록·저장에는 넣지 않는다"를 저장소에 한정해 읽었다. 기록에서 빼면 한 번 중지할 때마다 그 이후 대화 전체가 "빈칸"이 된다. 비용: 중지한 차례의 불완전한 생각이 다음 요청에 같이 간다 (DeepSeek은 허용).
- **R3.** `ThinkingBox` 문구는 ko·en·ja·zh·zh-TW만 번역하고 나머지 언어는 영어로 보인다. 패널 문자열 표가 언어별로 따로 있고 모듈마다 19개 언어라 이번 범위에서 제외한다. 비용: 일부 언어에서 이 상자의 제목만 영어.
- **R4.** `AgentRunResult.reasoning` / `thinking`은 선택 칸이다. 생각이 없으면 칸 자체가 없다. 기존 `onDone` 호출부와 테스트가 그대로 통과한다.
- **R5.** DeepSeek 규칙은 공급자 id가 아니라 `streamOpenAiCompatible`의 마지막 선택 인자 `variant: 'deepseek'`로 켠다. 사용자 지정 주소(`custom`)가 DeepSeek을 가리켜도 규칙이 켜지지 않는다. 비용: 그 경우 생각 원문을 돌려보내지 못한다 (실측상 무해).
- **R6.** 시드는 `app.whenReady()` 뒤에 실행한다. `safeStorage`가 준비되기 전에 암호화하면 실패할 수 있다.
- **R7.** 검증 깊이: 한글·워드는 실제 키 드라이버로 전체를 확인하고, 파워포인트·엑셀·PDF는 자동 테스트와 타입 검사, 공용 부품 테스트로 확인한 뒤 사용자 눈 확인 목록을 남긴다 (드라이버 비용 대비 위험이 작음: 같은 `ThinkingBox`와 같은 코드 형태).

## 파일 구조

| 파일                                                                              | 책임                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/docs/src/main/ai-key-seed.ts` (신규)                                        | 환경 변수의 DeepSeek 키를 시작 시 저장                        |
| `packages/ai-provider/src/providers.ts`                                           | DeepSeek 모델 목록, `migrateLegacyRoute`                      |
| `packages/ai-provider/src/stream.ts`                                              | OpenAI 호환 스트림: 생각 조각, DeepSeek 요청 규칙, 400 안전망 |
| `packages/ai-provider/src/protocols/shared.ts`, `types.ts`, `codex-app-server.ts` | 콜백 이름, 조각 타입, Codex 요약 콜백                         |
| `packages/agent-core/src/{types,loop,electron-transport,restore,index}.ts`        | 메시지·콜백·이벤트 타입, 차례별 모으기, 복원 도우미, IPC 전송 |
| `apps/docs/src/main/ai-routing-ipc.ts`, `ai-settings-service.ts`                  | `thinking` 조각 전송, 메시지 `reasoning` 허용, 옛 경로 변환   |
| `packages/project-store/src/{types,ipc,store}.ts` + 네 메인 핸들러                | `reasoning`/`thinking` 저장·복원, 자르기                      |
| `packages/ui/src/ThinkingBox.{tsx,css}` (신규)                                    | 공용 "생각 과정" 상자                                         |
| `apps/{hwp,docs,slides,pdf,sheets}/src/renderer/**`                               | 전송 층 `thinking` 처리, 패널 표시·저장·복원                  |

---

### Task 1: 테스트용 DeepSeek 키 미리 넣기

**Files:**

- Create: `apps/docs/src/main/ai-key-seed.ts`
- Create: `apps/docs/tests/ai-key-seed.test.ts`
- Modify: `apps/docs/src/main/docs-main.ts` (`getAiSettingsService`, import)

**Interfaces:**

- Consumes: `AiSecretStore.status(providerId): 'missing' | 'ready' | 'unreadable'`, `AiSettingsService.verifyAndSave(args: { providerId: KeyedPublicAiProviderId; apiKey: string }): Promise<{ saved: boolean; ... }>`
- Produces: `DEEPSEEK_SEED_ENV: 'GENOFFICE_SEED_DEEPSEEK_API_KEY'`, `seedDeepSeekKey(options: SeedDeepSeekKeyOptions): Promise<'seeded' | 'skipped' | 'failed'>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/docs/tests/ai-key-seed.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_SEED_ENV, seedDeepSeekKey } from '../src/main/ai-key-seed'

const KEY = 'sk-seed-test-0123456789abcdef'

function setup(
  options: {
    status?: 'missing' | 'ready' | 'unreadable'
    env?: Record<string, string | undefined>
    verify?: () => Promise<{ saved: boolean }>
  } = {},
) {
  const verifyAndSave = vi.fn(options.verify ?? (async () => ({ saved: true })))
  const warn = vi.fn()
  const run = () =>
    seedDeepSeekKey({
      secretStore: { status: () => options.status ?? 'missing' },
      settings: { verifyAndSave: verifyAndSave as never },
      env: options.env ?? { [DEEPSEEK_SEED_ENV]: KEY },
      warn,
    })
  return { run, verifyAndSave, warn }
}

describe('seedDeepSeekKey', () => {
  it('does nothing without the variable', async () => {
    const { run, verifyAndSave } = setup({ env: {} })
    expect(await run()).toBe('skipped')
    expect(verifyAndSave).not.toHaveBeenCalled()
  })

  it('does nothing for a blank variable', async () => {
    const { run, verifyAndSave } = setup({ env: { [DEEPSEEK_SEED_ENV]: '   ' } })
    expect(await run()).toBe('skipped')
    expect(verifyAndSave).not.toHaveBeenCalled()
  })

  it('never overwrites a key that is already stored', async () => {
    const { run, verifyAndSave } = setup({ status: 'ready' })
    expect(await run()).toBe('skipped')
    expect(verifyAndSave).not.toHaveBeenCalled()
  })

  it('saves through verifyAndSave when the profile has no key', async () => {
    const { run, verifyAndSave, warn } = setup({ status: 'missing' })
    expect(await run()).toBe('seeded')
    expect(verifyAndSave).toHaveBeenCalledWith({ providerId: 'deepseek', apiKey: KEY })
    expect(warn).not.toHaveBeenCalled()
  })

  it('replaces a stored key that can no longer be read', async () => {
    const { run, verifyAndSave } = setup({ status: 'unreadable' })
    expect(await run()).toBe('seeded')
    expect(verifyAndSave).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected key without leaking it', async () => {
    const { run, warn } = setup({ verify: async () => ({ saved: false }) })
    expect(await run()).toBe('failed')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY)
  })

  it('reports a thrown error without leaking the key', async () => {
    const { run, warn } = setup({
      verify: async () => {
        throw new Error(`HTTP 401 for Bearer ${KEY}`)
      },
    })
    expect(await run()).toBe('failed')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/docs -- tests/ai-key-seed.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/ai-key-seed"`.

- [ ] **Step 3: 구현한다**

`apps/docs/src/main/ai-key-seed.ts`:

```ts
import type { AiSecretStore } from './ai-secret-store'
import type { AiSettingsService } from './ai-settings-service'

/** Windows user variable a developer sets to pre-load a DeepSeek test key (spec §4.6). */
export const DEEPSEEK_SEED_ENV = 'GENOFFICE_SEED_DEEPSEEK_API_KEY'

export interface SeedDeepSeekKeyOptions {
  secretStore: Pick<AiSecretStore, 'status'>
  settings: Pick<AiSettingsService, 'verifyAndSave'>
  env: Readonly<Record<string, string | undefined>>
  /** one fixed line per failure; the key and the server's reply never go in */
  warn(message: string): void
}

export type SeedOutcome = 'seeded' | 'skipped' | 'failed'

/**
 * Save the DeepSeek key from the environment through the same verify-and-encrypt path as the
 * settings screen. Only when the profile has no usable key; never touches the default AI.
 */
export async function seedDeepSeekKey(options: SeedDeepSeekKeyOptions): Promise<SeedOutcome> {
  const apiKey = options.env[DEEPSEEK_SEED_ENV]?.trim()
  if (!apiKey) return 'skipped'
  if (options.secretStore.status('deepseek') === 'ready') return 'skipped'
  try {
    const result = await options.settings.verifyAndSave({ providerId: 'deepseek', apiKey })
    if (result.saved) return 'seeded'
    options.warn('DeepSeek seed key was not accepted; nothing was saved')
    return 'failed'
  } catch {
    options.warn('DeepSeek seed key could not be saved')
    return 'failed'
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test -w @genoffice/docs -- tests/ai-key-seed.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: 시작할 때 실행되게 연결한다**

`apps/docs/src/main/docs-main.ts`에서 `import { AiSecretStore } from './ai-secret-store'` 바로 아래에 추가:

```ts
import { seedDeepSeekKey } from './ai-key-seed'
```

`getAiSettingsService()`의 끝부분을 바꾼다. 바꾸기 전:

```ts
  aiSettingsService = new AiSettingsService({
    settingsPath: SETTINGS_PATH(),
    secretStore: secrets,
    catalogs,
    isGensparkConfigured: hasGskAuth,
    codex,
  })
  return aiSettingsService
}
```

바꾼 뒤:

```ts
  const service = new AiSettingsService({
    settingsPath: SETTINGS_PATH(),
    secretStore: secrets,
    catalogs,
    isGensparkConfigured: hasGskAuth,
    codex,
  })
  aiSettingsService = service
  // test builds: pre-load a DeepSeek key from the environment (spec §4.6); a no-op without the variable.
  // After app ready so safeStorage can encrypt.
  void app.whenReady().then(() =>
    seedDeepSeekKey({
      secretStore: secrets,
      settings: service,
      env: process.env,
      warn: (message) => console.warn(`[ai-seed] ${message}`),
    }),
  )
  return service
}
```

- [ ] **Step 6: 타입 검사와 린트**

Run: `npm run typecheck -w @genoffice/docs`
Expected: 오류 0건.
Run: `npx eslint apps/docs/src/main/ai-key-seed.ts apps/docs/src/main/docs-main.ts apps/docs/tests/ai-key-seed.test.ts`
Expected: 오류 0건.

- [ ] **Step 7: 커밋**

```bash
git add apps/docs/src/main/ai-key-seed.ts apps/docs/tests/ai-key-seed.test.ts apps/docs/src/main/docs-main.ts
```

그다음 별도 명령으로:

```bash
git commit -m "feat(docs): pre-load a DeepSeek test key from the environment" -m "GENOFFICE_SEED_DEEPSEEK_API_KEY is saved through verifyAndSave when the profile has no usable key. It never overwrites a stored key, never changes the default AI, and no failure path logs the key." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: DeepSeek 모델 목록과 옛 경로 변환

**Files:**

- Modify: `packages/ai-provider/src/providers.ts` (DeepSeek 항목, `migrateLegacyRoute`)
- Modify: `packages/ai-provider/src/index.ts` (내보내기)
- Modify: `packages/ai-provider/tests/providers.test.ts`
- Modify: `apps/docs/src/main/ai-settings-service.ts` (`normalizeRoute`)
- Modify: `apps/docs/src/main/ai-routing-ipc.ts` (`getOrCreateRoute`, import)
- Modify: `apps/docs/tests/ai-settings-service.test.ts`, `apps/docs/tests/ai-routing-ipc.test.ts`

**Interfaces:**

- Produces: `migrateLegacyRoute(route: AiRoute): AiRoute` — `@genoffice/ai-provider`에서 내보냄.

- [ ] **Step 1: 실패하는 테스트를 쓴다 (ai-provider)**

`packages/ai-provider/tests/providers.test.ts` 맨 위 import를 바꾼다:

```ts
import {
  AI_PROVIDERS,
  OPENAI_COMPATIBLE_BASE_URLS,
  defaultAiSettings,
  migrateLegacyRoute,
  resolveAiSettings,
} from '../src/providers'
```

기존 `it.each` 안의 DeepSeek 항목 `defaultModel: 'deepseek-chat'`을 `defaultModel: 'deepseek-flash'`로 고치고, 파일 끝에 추가:

```ts
describe('DeepSeek model lineup', () => {
  it('lists the current API models and defaults to the flash model', () => {
    const provider = AI_PROVIDERS.find((meta) => meta.id === 'deepseek')!
    expect(provider.models).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    expect(provider.defaultModel).toBe('deepseek-flash')
  })

  it('maps the retired model names to deepseek-flash, for DeepSeek routes only', () => {
    const flash = { providerId: 'deepseek', modelId: 'deepseek-flash' }
    expect(migrateLegacyRoute({ providerId: 'deepseek', modelId: 'deepseek-chat' })).toEqual(flash)
    expect(migrateLegacyRoute({ providerId: 'deepseek', modelId: 'deepseek-reasoner' })).toEqual(
      flash,
    )
    const pro = { providerId: 'deepseek', modelId: 'deepseek-v4-pro' } as const
    expect(migrateLegacyRoute(pro)).toBe(pro)
    const other = { providerId: 'openrouter', modelId: 'deepseek-chat' } as const
    expect(migrateLegacyRoute(other)).toBe(other)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/ai-provider -- tests/providers.test.ts`
Expected: FAIL — `migrateLegacyRoute is not a function`, 모델 목록 불일치.

- [ ] **Step 3: 구현한다**

`packages/ai-provider/src/providers.ts` 첫 줄을 바꾼다:

```ts
import type { AiProviderId, AiProviderMeta, AiRoute, AiSettings, LegacyAiSettings } from './types'
```

DeepSeek 항목의 두 줄을 바꾼다:

```ts
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    defaultModel: 'deepseek-flash',
```

`OPENROUTER_API_BASE_URL` 선언 바로 아래에 추가:

```ts
/** DeepSeek retired these names (2026-07-24); the API still answers them but the model list no longer carries them. */
const RETIRED_DEEPSEEK_MODELS: ReadonlySet<string> = new Set(['deepseek-chat', 'deepseek-reasoner'])

/** A stored route that names a retired model becomes its current replacement; everything else is returned as is. */
export function migrateLegacyRoute(route: AiRoute): AiRoute {
  if (route.providerId === 'deepseek' && RETIRED_DEEPSEEK_MODELS.has(route.modelId)) {
    return { providerId: 'deepseek', modelId: 'deepseek-flash' }
  }
  return route
}
```

`packages/ai-provider/src/index.ts`의 `export { AI_PROVIDERS, ... } from './providers'` 목록에 `migrateLegacyRoute,`를 `defaultAiSettings,` 다음 줄로 추가한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test -w @genoffice/ai-provider -- tests/providers.test.ts`
Expected: PASS.

- [ ] **Step 5: 실패하는 테스트를 쓴다 (docs)**

`apps/docs/tests/ai-settings-service.test.ts` 파일 끝에 추가:

```ts
describe('retired DeepSeek model names', () => {
  it('reads a stored deepseek-chat default as deepseek-flash', () => {
    const { settingsPath, service } = fixture()
    writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        globalDefault: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        providers: {},
      }),
    )
    expect(service.getGlobalDefault()).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
    })
  })
})
```

`apps/docs/tests/ai-routing-ipc.test.ts` 파일 끝에 추가:

```ts
describe('retired DeepSeek model names in a conversation route', () => {
  it('answers a stored deepseek-chat route as deepseek-flash', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const stored = { providerId: 'deepseek', modelId: 'deepseek-chat' }
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) =>
          handlers.set(channel, listener as (...args: unknown[]) => unknown),
      },
      settings: { getGlobalDefault: () => stored } as never,
      getProjectStore: () =>
        ({
          getOrCreateChatAiMetadata: () => ({
            schemaVersion: 1,
            route: stored,
            createdAt: '2026-10-02T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
          }),
        }) as never,
      getGensparkApiKey: () => '',
    })
    const route = await handlers.get(AI_CHANNELS.getConversationRoute)!(
      {},
      { projectId: 'default', chatId: '0123456789abcdef' },
    )
    expect(route).toEqual({ providerId: 'deepseek', modelId: 'deepseek-flash' })
  })
})
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm run test -w @genoffice/docs -- tests/ai-settings-service.test.ts tests/ai-routing-ipc.test.ts`
Expected: FAIL — 두 새 테스트가 `deepseek-chat`을 돌려받아 실패.

- [ ] **Step 7: 구현한다**

`apps/docs/src/main/ai-settings-service.ts`의 `@genoffice/ai-provider` 기존 import(값 import 목록)에 `migrateLegacyRoute`를 추가하고, `normalizeRoute`를 바꾼다. 바꾸기 전:

```ts
return { providerId: value.providerId, modelId: value.modelId.trim() }
```

바꾼 뒤:

```ts
return migrateLegacyRoute({ providerId: value.providerId, modelId: value.modelId.trim() })
```

`apps/docs/src/main/ai-routing-ipc.ts`의 `@genoffice/ai-provider` 값 import 목록에 `migrateLegacyRoute`를 추가하고 `getOrCreateRoute`를 바꾼다. 바꾸기 전:

```ts
  const globalDefault = options.settings.getGlobalDefault()
  return identity
    ? options
        .getProjectStore()
        .getOrCreateChatAiMetadata(identity.projectId, identity.chatId, globalDefault).route
    : globalDefault
}
```

바꾼 뒤:

```ts
  const globalDefault = options.settings.getGlobalDefault()
  const route = identity
    ? options
        .getProjectStore()
        .getOrCreateChatAiMetadata(identity.projectId, identity.chatId, globalDefault).route
    : globalDefault
  // a conversation created while DeepSeek still served the old names keeps working
  return migrateLegacyRoute(route)
}
```

- [ ] **Step 8: 통과와 전체 확인**

Run: `npm run test -w @genoffice/docs -- tests/ai-settings-service.test.ts tests/ai-routing-ipc.test.ts tests/ai-catalog-cache.test.ts`
Expected: PASS (카탈로그 테스트의 `deepseek-chat`/`deepseek-reasoner` 기대값은 등록 이름이 하나도 없을 때 접근 가능한 이름을 그대로 돌려주는 기존 규칙 덕분에 그대로 통과한다).
Run: `npm run test -w @genoffice/ai-provider`
Expected: PASS 전체.
Run: `npm run typecheck -w @genoffice/ai-provider && npm run typecheck -w @genoffice/docs`
Expected: 오류 0건.

- [ ] **Step 9: 커밋**

```bash
git add packages/ai-provider/src/providers.ts packages/ai-provider/src/index.ts packages/ai-provider/tests/providers.test.ts apps/docs/src/main/ai-settings-service.ts apps/docs/src/main/ai-routing-ipc.ts apps/docs/tests/ai-settings-service.test.ts apps/docs/tests/ai-routing-ipc.test.ts
```

그다음 별도 명령으로:

```bash
git commit -m "feat(ai): DeepSeek model lineup is deepseek-flash and deepseek-v4-pro" -m "The retired deepseek-chat / deepseek-reasoner names in a stored default or conversation route are read as deepseek-flash." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 대화 처리 부품(agent-core)이 생각을 모은다

**Files:**

- Modify: `packages/agent-core/src/types.ts`, `loop.ts`, `electron-transport.ts`, `index.ts`
- Create: `packages/agent-core/src/restore.ts`, `packages/agent-core/tests/restore.test.ts`
- Modify: `packages/agent-core/tests/loop.test.ts`, `packages/agent-core/tests/electron-transport.test.ts`

**Interfaces:**

- Produces:
  - `AgentMessage` assistant 변형의 `reasoning?: string | undefined`
  - `type AgentThinkingKind = 'reasoning' | 'summary'`
  - `AgentStreamCallbacks.onThinking?(text: string, kind: AgentThinkingKind): void`
  - `AgentLoopEvents.onThinking?(thinking: string): void` — 현재 차례의 누적 표시 글(원문·요약 모두)
  - `AgentRunResult.reasoning?: string`, `AgentRunResult.thinking?: string` — 실행 전체(차례는 빈 줄 하나로 이음), 없으면 칸 자체가 없음
  - `IpcStreamChunk.type`에 `'thinking'`, `thinkingKind?: AgentThinkingKind`
  - `toRestorableMessages(messages: readonly StoredChatMessage[]): AgentMessage[]`, `StoredChatMessage`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (복원 도우미)**

`packages/agent-core/tests/restore.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toRestorableMessages } from '../src'

describe('toRestorableMessages', () => {
  it('keeps text and carries the reasoning of assistant messages', () => {
    expect(
      toRestorableMessages([
        { role: 'user', text: 'q' },
        { role: 'assistant', text: 'a', reasoning: 'why' },
        { role: 'assistant', text: 'b' },
      ]),
    ).toEqual([
      { role: 'user', text: 'q' },
      { role: 'assistant', text: 'a', reasoning: 'why' },
      { role: 'assistant', text: 'b' },
    ])
  })

  it('never puts reasoning on a user message and leaves empty reasoning out', () => {
    const out = toRestorableMessages([
      { role: 'user', text: 'q', reasoning: 'ignored' },
      { role: 'assistant', text: 'a', reasoning: '' },
    ])
    expect(out[0]).toEqual({ role: 'user', text: 'q' })
    expect(out[1]).toEqual({ role: 'assistant', text: 'a' })
  })
})
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 (loop)**

`packages/agent-core/tests/loop.test.ts` 파일 끝에 추가:

```ts
describe('AgentLoop thinking', () => {
  it("keeps each turn's raw reasoning on its assistant message and reports the run's thinking", async () => {
    const transport = scriptedTransport([
      (cb) => {
        cb.onThinking?.('plan ', 'reasoning')
        cb.onThinking?.('step', 'reasoning')
        cb.onToolCall({ id: 't1', name: 'do_thing', input: {} })
        cb.onDone()
      },
      (cb) => {
        cb.onThinking?.('check', 'reasoning')
        cb.onDelta('ok')
        cb.onDone()
      },
    ])
    const onThinking = vi.fn()
    const onDone = vi.fn()
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: { onThinking, onDone } })
    loop.run('go')
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onThinking.mock.calls.map((call) => call[0])).toEqual(['plan ', 'plan step', 'check'])
    expect(onDone).toHaveBeenCalledWith({
      text: 'ok',
      cancelled: false,
      turnLimit: false,
      reasoning: 'plan step\n\ncheck',
      thinking: 'plan step\n\ncheck',
    })
    expect(loop.messages[1]).toMatchObject({
      role: 'assistant',
      reasoning: 'plan step',
      toolCalls: [{ id: 't1' }],
    })
    expect(loop.messages[3]).toMatchObject({ role: 'assistant', text: 'ok', reasoning: 'check' })
    // the next request carries the first turn's reasoning back
    expect(transport.requests[1]!.messages[1]).toMatchObject({ reasoning: 'plan step' })
  })

  it('shows summaries without treating them as model reasoning', async () => {
    const transport = scriptedTransport([
      (cb) => {
        cb.onThinking?.('Reading the file', 'summary')
        cb.onDelta('hi')
        cb.onDone()
      },
    ])
    const onDone = vi.fn()
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: { onDone } })
    loop.run('x')
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone).toHaveBeenCalledWith({
      text: 'hi',
      cancelled: false,
      turnLimit: false,
      thinking: 'Reading the file',
    })
    expect(loop.messages[1]).toEqual({ role: 'assistant', text: 'hi' })
  })

  it('stop: keeps the reasoning of the stopped turn in the context so later turns are not left blank', async () => {
    const transport = scriptedTransport([
      (cb) => {
        cb.onThinking?.('partial', 'reasoning')
        cb.onDelta('par') // never finishes; the user stops it
      },
      (cb) => {
        cb.onDelta('next')
        cb.onDone()
      },
    ])
    const onDone = vi.fn()
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: { onDone } })
    loop.run('one')
    await flush()
    loop.cancel()
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(onDone.mock.calls[0]![0]).toMatchObject({ cancelled: true })
    loop.run('two')
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(2))
    expect(transport.requests[1]!.messages[1]).toEqual({
      role: 'assistant',
      text: 'par',
      reasoning: 'partial',
    })
    // the second run reports only its own thinking (none)
    expect(onDone.mock.calls[1]![0]).toEqual({ text: 'next', cancelled: false, turnLimit: false })
  })

  it('restore keeps stored reasoning on assistant messages', async () => {
    const transport = scriptedTransport([
      (cb) => {
        cb.onDelta('ok')
        cb.onDone()
      },
    ])
    const loop = new AgentLoop({ transport, skill: makeSkill() })
    loop.restore([
      { role: 'user', text: 'q' },
      { role: 'assistant', text: 'a', reasoning: 'r' },
    ])
    loop.run('next')
    await flush()
    expect(transport.requests[0]!.messages[1]).toEqual({
      role: 'assistant',
      text: 'a',
      reasoning: 'r',
    })
  })

  it('counts restored reasoning toward the compaction budget', () => {
    const loop = new AgentLoop({
      transport: scriptedTransport([]),
      skill: makeSkill(),
      compaction: { maxBytes: 300, keepRecentBytes: 100, disableLlmSummary: true },
    })
    loop.restore([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1', reasoning: 'r'.repeat(400) },
      { role: 'user', text: 'q2' },
      { role: 'assistant', text: 'a2' },
    ])
    // the visible text is a few bytes; only the reasoning pushes the history over 300,
    // so the oldest turn is folded into the digest together with its reasoning
    expect(
      loop.messages.some((m) => m.role === 'assistant' && 'reasoning' in m && !!m.reasoning),
    ).toBe(false)
    expect(loop.messages.at(-1)).toEqual({ role: 'assistant', text: 'a2' })
  })
})
```

- [ ] **Step 3: 실패하는 테스트를 쓴다 (IPC 전송)**

`packages/agent-core/tests/electron-transport.test.ts`의 `setup()` 안 `cb` 객체를 바꾼다:

```ts
const cb = {
  onDelta: vi.fn(),
  onThinking: vi.fn(),
  onToolCall: vi.fn(),
  onDone: vi.fn(),
  onError: vi.fn(),
}
```

`describe('createIpcTransport', ...)` 안, `it('ignores chunks for other requestIds'` 바로 앞에 추가:

```ts
it('forwards thinking chunks with their kind and keeps the stream open', () => {
  const { cb, emit, unsubscribe } = setup()
  emit({ type: 'thinking', thinkingKind: 'reasoning', text: 'raw ' })
  emit({ type: 'thinking', thinkingKind: 'summary', text: 'summary' })
  emit({ type: 'thinking', text: 'no kind means raw reasoning' })
  emit({ type: 'thinking' }) // an empty chunk is dropped
  expect(cb.onThinking.mock.calls).toEqual([
    ['raw ', 'reasoning'],
    ['summary', 'summary'],
    ['no kind means raw reasoning', 'reasoning'],
  ])
  expect(cb.onError).not.toHaveBeenCalled()
  expect(unsubscribe).not.toHaveBeenCalled()
})
```

- [ ] **Step 4: 실패를 확인한다**

Run: `npm run test -w @genoffice/agent-core`
Expected: FAIL — `toRestorableMessages is not a function`(restore), `onThinking` 호출 없음(loop), 전송 테스트는 `thinking`이 오류로 처리됨.

- [ ] **Step 5: 구현한다 — 타입**

`packages/agent-core/src/types.ts`의 `AgentMessage`를 바꾼다:

```ts
export type AgentMessage =
  | { role: 'user'; text: string; images?: AgentImage[] | undefined }
  | {
      role: 'assistant'
      text: string
      toolCalls?: AgentToolCall[] | undefined
      /** the model's raw reasoning for this turn; providers that need it (DeepSeek) get it back on later requests */
      reasoning?: string | undefined
    }
  | { role: 'tool'; results: AgentToolResult[] }
```

`AgentStreamCallbacks` 위에 타입을 추가하고 콜백을 넣는다:

```ts
/** 'reasoning' = the provider's raw chain of thought; 'summary' = a display-only summary (never sent back) */
export type AgentThinkingKind = 'reasoning' | 'summary'

export interface AgentStreamCallbacks {
  onDelta(text: string): void
  /** model thinking as it streams; transports that cannot deliver it may omit the call */
  onThinking?(text: string, kind: AgentThinkingKind): void
  /** complete parsed tool call (arguments finished streaming) */
  onToolCall(call: AgentToolCall): void
  /** Phase changes within the model stream (thinking / responding / tool-input); older transports may omit this */
  onPhase?(phase: AgentPhase): void
  onDone(): void
  onError(error: string): void
}
```

`packages/agent-core/src/index.ts`: 첫 `export type { ... } from './types'` 목록에 `AgentThinkingKind,`를 `AgentStreamRequest,` 다음에 추가하고, 파일 끝에 추가:

```ts
export { toRestorableMessages } from './restore'
export type { StoredChatMessage } from './restore'
```

`packages/agent-core/src/restore.ts` 생성:

```ts
import type { AgentMessage } from './types'

/** a transcript message as the panels persist it */
export interface StoredChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** raw model reasoning of an assistant message */
  reasoning?: string | undefined
}

/** model-context messages for AgentLoop.restore(): the text plus the reasoning providers want sent back */
export function toRestorableMessages(messages: readonly StoredChatMessage[]): AgentMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.reasoning
      ? { role: 'assistant', text: message.text, reasoning: message.reasoning }
      : { role: message.role, text: message.text },
  )
}
```

- [ ] **Step 6: 구현한다 — IPC 전송**

`packages/agent-core/src/electron-transport.ts`: 파일 위 import에 `AgentThinkingKind`를 추가하고 `IpcStreamChunk`를 바꾼다:

```ts
import type {
  AgentStreamRequest,
  AgentThinkingKind,
  AgentToolCall,
  AgentToolDef,
  AgentTransport,
  AgentMessage,
} from './types'

export interface IpcStreamChunk {
  requestId: string
  type: 'delta' | 'thinking' | 'tool-call' | 'done' | 'error'
  text?: string
  thinkingKind?: AgentThinkingKind
  toolCall?: AgentToolCall
  error?: string
}
```

`createIpcTransport`의 `onStream` 안, `delta` 분기와 `tool-call` 분기 사이에 추가:

```ts
        } else if (chunk.type === 'thinking') {
          if (chunk.text) {
            cb.onThinking?.(chunk.text, chunk.thinkingKind === 'summary' ? 'summary' : 'reasoning')
          }
```

(앞의 `if (chunk.type === 'delta') { cb.onDelta(chunk.text ?? '') }` 블록의 닫는 `}` 다음에 `else if`로 이어지게 한다. 결과 구조는 `delta → thinking → tool-call → done → else error` 순서.)

- [ ] **Step 7: 구현한다 — loop**

`packages/agent-core/src/loop.ts`:

1. import 목록(`./types`)에 `AgentThinkingKind`는 필요 없다. 이벤트·결과 인터페이스를 바꾼다.

`AgentRunResult`에 두 칸을 추가:

```ts
export interface AgentRunResult {
  /** final assistant text of the run ('' when cut off) */
  text: string
  cancelled: boolean
  /** true when maxTurns was reached; text is the partial answer from the no-tools finalizing turn */
  turnLimit: boolean
  /** the run's raw model reasoning, turns joined by a blank line; absent when the model produced none */
  reasoning?: string
  /** everything shown in the thinking box for the run (reasoning and summaries); absent when none */
  thinking?: string
}
```

`AgentLoopEvents`의 `onText` 아래에 추가:

```ts
  /** cumulative thinking text of the current turn (reasoning and summaries), called per delta */
  onThinking?(thinking: string): void
```

2. 필드: `private turnText = ''` 아래에 추가:

```ts
  private turnReasoning = ''
  private turnThinking = ''
  private runReasoning: string[] = []
  private runThinking: string[] = []
```

3. `run()`에서 `this.turns = 0` 바로 아래에 추가:

```ts
this.runReasoning = []
this.runThinking = []
```

4. `startTurn()`에서 `this.turnText = ''` 아래에 추가:

```ts
this.turnReasoning = ''
this.turnThinking = ''
```

그리고 `stream(..., { onDelta: ..., onToolCall: ... })` 콜백 객체의 `onDelta` 다음에 추가:

```ts
        onThinking: (text, kind) => {
          if (generation !== this.generation || settled) return
          if (kind === 'reasoning') this.turnReasoning += text
          this.turnThinking += text
          this.options.events?.onThinking?.(this.turnThinking)
        },
```

5. `finishTurn()` 맨 위, `const toolCalls = this.toolCalls` 아래에 추가:

```ts
if (this.turnReasoning) this.runReasoning.push(this.turnReasoning)
if (this.turnThinking) this.runThinking.push(this.turnThinking)
```

두 `history.push`를 바꾼다. 바꾸기 전:

```ts
this.history.push({ role: 'assistant', text: this.turnText })
```

바꾼 뒤:

```ts
this.history.push({
  role: 'assistant',
  text: this.turnText,
  ...(this.turnReasoning ? { reasoning: this.turnReasoning } : {}),
})
```

바꾸기 전:

```ts
this.history.push({ role: 'assistant', text: this.turnText, toolCalls })
```

바꾼 뒤:

```ts
this.history.push({
  role: 'assistant',
  text: this.turnText,
  toolCalls,
  ...(this.turnReasoning ? { reasoning: this.turnReasoning } : {}),
})
```

두 `onDone` 호출(`finishTurn`의 최종 차례와 도구 실행 중 중지)을 바꾼다. 최종 차례:

```ts
events?.onDone?.({
  text: this.turnText,
  cancelled: this.cancelled,
  turnLimit: this.finalizing,
  ...this.thinkingResult(),
})
```

도구 실행 중 중지:

```ts
events?.onDone?.({
  text: this.turnText,
  cancelled: true,
  turnLimit: false,
  ...this.thinkingResult(),
})
```

`rollbackFailedRun()` 위에 도우미를 추가:

```ts
  private thinkingResult(): { reasoning?: string; thinking?: string } {
    return {
      ...(this.runReasoning.length > 0 ? { reasoning: this.runReasoning.join('\n\n') } : {}),
      ...(this.runThinking.length > 0 ? { thinking: this.runThinking.join('\n\n') } : {}),
    }
  }
```

6. `copyMessages`의 assistant 반환을 바꾼다:

```ts
if (message.role === 'assistant') {
  return {
    role: 'assistant',
    text: message.text,
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((call) => ({
            ...call,
            input: { ...call.input },
          })),
        }
      : {}),
  }
}
```

7. `messageSize()`에서 `let n = utf8Size(m.text)` 바로 아래에 추가:

```ts
if (m.role === 'assistant' && m.reasoning) n += utf8Size(m.reasoning)
```

- [ ] **Step 8: 통과와 전체 확인**

Run: `npm run test -w @genoffice/agent-core`
Expected: PASS 전체 (새 테스트 8개 포함, 기존 `toHaveBeenCalledWith({text, cancelled, turnLimit})` 테스트 그대로 통과).
Run: `npm run typecheck -w @genoffice/agent-core`
Expected: 오류 0건.

- [ ] **Step 9: 커밋**

```bash
git add packages/agent-core/src packages/agent-core/tests
```

그다음 별도 명령으로:

```bash
git commit -m "feat(agent-core): collect model thinking per turn and carry reasoning in the history" -m "AgentLoop reports the turn's thinking live (onThinking) and the run's reasoning/thinking in onDone. Assistant messages keep their raw reasoning through copy, restore and compaction accounting. toRestorableMessages builds restore input from stored chats. The IPC transport forwards thinking chunks." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 공급자 스트림 — 생각 조각, DeepSeek 요청 규칙, 400 안전망

**Files:**

- Modify: `packages/ai-provider/src/protocols/shared.ts`, `types.ts`, `stream.ts`, `codex-app-server.ts`
- Modify: `packages/ai-provider/tests/stream.test.ts`, `codex-app-server.test.ts`

**Interfaces:**

- Consumes: `AgentMessage.assistant.reasoning` (작업 3)
- Produces:
  - `StreamCallbacks.onReasoningDelta?(text)` (원문), `StreamCallbacks.onReasoningSummaryDelta?(text)` (요약)
  - `AiStreamChunk.type`에 `'thinking'`, `thinkingKind?: 'reasoning' | 'summary'`
  - `streamOpenAiCompatible(baseUrl, config, system, messages, tools, maxTokens, cb, variant?: 'deepseek')`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (스트림)**

`packages/ai-provider/tests/stream.test.ts`의 import 두 줄을 바꾼다:

```ts
import type { AgentMessage, AgentToolCall } from '@genoffice/agent-core'
import { errorResponse, okResponse, sseStream } from './test-utils'
```

(기존 `import type { AgentToolCall } from '@genoffice/agent-core'` 줄은 위 첫 줄로 바꾼다.)

파일 끝에 추가:

```ts
describe('streamForProvider: thinking', () => {
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
    JSON.parse(fetchMock.mock.calls[call]![1].body as string) as {
      messages: Array<Record<string, unknown>>
      temperature?: number
      thinking?: unknown
    }
  const toolTurn: AgentMessage[] = [
    { role: 'user', text: 'hi' },
    {
      role: 'assistant',
      text: '',
      toolCalls: [{ id: 'c1', name: 'do', input: {} }],
      reasoning: 'plan',
    },
    { role: 'tool', results: [{ id: 'c1', name: 'do', output: 'ok' }] },
  ]
  const answer = () =>
    okResponse(sseStream(['data: {"choices":[{"delta":{"content":"answer"}}]}', 'data: [DONE]']))

  it('streams reasoning_content as reasoning deltas, apart from the answer', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"hard"}}]}',
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      'data: [DONE]',
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)))
    const { deltas, cb } = collector()
    const reasoning: string[] = []
    await streamForProvider(
      'deepseek',
      { apiKey: 'k', model: 'deepseek-flash' },
      'sys',
      [{ role: 'user', text: 'hi' }],
      [],
      100,
      { ...cb, onReasoningDelta: (text: string) => reasoning.push(text) },
    )
    expect(reasoning).toEqual(['think ', 'hard'])
    expect(deltas).toEqual(['answer'])
  })

  it('sends earlier reasoning back and leaves temperature out in thinking mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer())
    vi.stubGlobal('fetch', fetchMock)
    const { cb } = collector()
    await streamForProvider(
      'deepseek',
      { apiKey: 'k', model: 'deepseek-flash' },
      'sys',
      toolTurn,
      [{ name: 'do', description: 'd', inputSchema: { type: 'object' } }],
      100,
      cb,
    )
    const sent = bodyOf(fetchMock)
    expect(sent.messages[2]).toMatchObject({ role: 'assistant', reasoning_content: 'plan' })
    expect(sent).not.toHaveProperty('temperature')
    expect(sent).not.toHaveProperty('thinking')
  })

  it('leaves assistant turns without reasoning as they are', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer())
    vi.stubGlobal('fetch', fetchMock)
    const { cb } = collector()
    await streamForProvider(
      'deepseek',
      { apiKey: 'k', model: 'deepseek-flash' },
      'sys',
      [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'Hello!' },
        { role: 'user', text: 'again' },
      ],
      [],
      100,
      cb,
    )
    expect(bodyOf(fetchMock).messages[2]).not.toHaveProperty('reasoning_content')
  })

  it('retries once with thinking disabled when DeepSeek rejects reasoning_content', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        errorResponse(
          400,
          '{"error":{"message":"The reasoning_content in the thinking mode must be passed back to the API."}}',
        ),
      )
      .mockResolvedValueOnce(answer())
    vi.stubGlobal('fetch', fetchMock)
    const { deltas, cb } = collector()
    await streamForProvider(
      'deepseek',
      { apiKey: 'k', model: 'deepseek-flash' },
      'sys',
      toolTurn,
      [{ name: 'do', description: 'd', inputSchema: { type: 'object' } }],
      100,
      cb,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retry = bodyOf(fetchMock, 1)
    expect(retry.thinking).toEqual({ type: 'disabled' })
    expect(retry.temperature).toBe(0.3)
    expect(retry.messages[2]).not.toHaveProperty('reasoning_content')
    expect(deltas).toEqual(['answer'])
  })

  it('does not retry other 400 errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errorResponse(400, '{"error":{"message":"invalid tools schema"}}'))
    vi.stubGlobal('fetch', fetchMock)
    const { cb } = collector()
    await expect(
      streamForProvider(
        'deepseek',
        { apiKey: 'k', model: 'deepseek-flash' },
        'sys',
        [{ role: 'user', text: 'hi' }],
        [],
        100,
        cb,
      ),
    ).rejects.toThrow(/HTTP 400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves other OpenAI-compatible providers unchanged but still forwards reasoning_content', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse(
          sseStream(['data: {"choices":[{"delta":{"reasoning_content":"hm"}}]}', 'data: [DONE]']),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const { cb } = collector()
    const reasoning: string[] = []
    await streamForProvider(
      'openai',
      { apiKey: 'k', model: 'gpt-4.1-mini' },
      'sys',
      toolTurn,
      [],
      100,
      { ...cb, onReasoningDelta: (text: string) => reasoning.push(text) },
    )
    const sent = bodyOf(fetchMock)
    expect(sent.temperature).toBe(0.3)
    expect(sent).not.toHaveProperty('thinking')
    expect(sent.messages[2]).not.toHaveProperty('reasoning_content')
    expect(reasoning).toEqual(['hm'])
  })
})
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 (Codex 요약)**

`packages/ai-provider/tests/codex-app-server.test.ts`에서 `it('keeps waiting through transient stream errors Codex retries itself'` 바로 앞에 추가:

```ts
it('reports reasoning summary deltas through onReasoningSummaryDelta', async () => {
  const summaries: string[] = []
  const transport = fakeTransport([
    {
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId: 'th', turnId: 't1', delta: 'Looking ' },
    },
    {
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId: 'th', turnId: 't1', delta: 'at the file' },
    },
    {
      method: 'item/completed',
      params: { threadId: 'th', turnId: 't1', item: { type: 'agentMessage', text: 'done' } },
    },
    {
      method: 'turn/completed',
      params: { threadId: 'th', turnId: 't1', turn: { id: 't1', status: 'completed' } },
    },
  ])
  await waitForTurn(
    transport,
    'th',
    () => transport.request('turn/start', {}),
    noopCallbacks.signal,
    { ...noopCallbacks, onReasoningSummaryDelta: (text: string) => summaries.push(text) },
  )
  expect(summaries).toEqual(['Looking ', 'at the file'])
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm run test -w @genoffice/ai-provider -- tests/stream.test.ts tests/codex-app-server.test.ts`
Expected: FAIL — 생각 조각이 전달되지 않음, `temperature`가 항상 존재, 재시도 없음, Codex 요약이 `onReasoningDelta`로만 감.

- [ ] **Step 4: 구현한다 — 타입과 콜백**

`packages/ai-provider/src/protocols/shared.ts`의 `StreamCallbacks`:

```ts
  /** raw model reasoning deltas (reasoning_content); the same provider may need them back on later requests */
  onReasoningDelta?: (text: string) => void
  /** display-only reasoning summary deltas (Codex); never sent back */
  onReasoningSummaryDelta?: (text: string) => void
```

`packages/ai-provider/src/types.ts`의 `AiStreamChunk`:

```ts
export interface AiStreamChunk {
  requestId: string
  type: 'delta' | 'thinking' | 'tool-call' | 'done' | 'error'
  text?: string
  /** for 'thinking' chunks: raw reasoning or a display-only summary */
  thinkingKind?: 'reasoning' | 'summary'
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
}
```

`packages/ai-provider/src/codex-app-server.ts`의 요약 이벤트 처리(`item/reasoning/summaryTextDelta`)를 바꾼다. 바꾸기 전:

```ts
if (typeof params.delta === 'string') cb.onReasoningDelta?.(params.delta)
```

바꾼 뒤:

```ts
if (typeof params.delta === 'string') cb.onReasoningSummaryDelta?.(params.delta)
```

- [ ] **Step 5: 구현한다 — OpenAI 호환 스트림**

`packages/ai-provider/src/stream.ts`:

`openAiMessages`의 시그니처와 assistant 분기를 바꾼다:

```ts
function openAiMessages(
  system: string,
  messages: AgentMessage[],
  sendReasoning = false,
): unknown[] {
```

assistant 분기의 `out.push`:

```ts
out.push({
  role: 'assistant',
  content: m.text || null,
  ...(sendReasoning && m.reasoning ? { reasoning_content: m.reasoning } : {}),
  ...(m.toolCalls && m.toolCalls.length > 0
    ? {
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        })),
      }
    : {}),
})
```

`streamOpenAiCompatible`을 바꾼다. 시그니처 끝에 선택 인자를 추가하고, `fetch` 호출과 응답 확인 부분을 다음으로 교체한다 (함수의 나머지 — `pendingTools`, `flushTools`, SSE 루프 — 는 아래 3번 수정만 한다).

```ts
/** DeepSeek's V4 models run in thinking mode by default (spec §4.3). */
export type OpenAiCompatibleVariant = 'deepseek'

export async function streamOpenAiCompatible(
  baseUrl: string,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  variant?: OpenAiCompatibleVariant,
): Promise<void> {
  const deepseek = variant === 'deepseek'
  const send = (thinking: boolean): Promise<Response> =>
    fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: cb.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        messages: openAiMessages(system, messages, deepseek && thinking),
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
            }
          : {}),
        // thinking mode takes no sampling parameters; a plain request keeps the old temperature
        ...(deepseek && !thinking ? { thinking: { type: 'disabled' } } : {}),
        ...(deepseek && thinking ? {} : { temperature: 0.3 }),
        stream: true,
      }),
    })
  let response = await send(true)
  if (deepseek && response.status === 400) {
    // the API may one day insist on reasoning_content we cannot supply (e.g. another model's turns):
    // a 400 arrives before any chunk, so one plain retry cannot duplicate output
    const detail = await response.text()
    if (!/reasoning_content/.test(detail)) {
      throw new Error(`HTTP 400: ${httpBodyDetail(detail, 400)}`)
    }
    response = await send(false)
  }
  if (!response.ok || !response.body) {
    throw new Error(
      `HTTP ${response.status}: ${httpBodyDetail(await response.text(), response.status)}`,
    )
  }
```

SSE 루프의 `delta` 타입에 칸을 추가하고 전달한다. `event`의 delta 타입:

```ts
        delta?: {
          content?: string
          reasoning_content?: string
          tool_calls?: Array<{
```

그리고 `if (choice.delta?.content) cb.onDelta(choice.delta.content)` 바로 위에 추가:

```ts
if (choice.delta?.reasoning_content) cb.onReasoningDelta?.(choice.delta.reasoning_content)
```

`streamForProvider`의 분기를 바꾼다. 바꾸기 전:

```ts
    case 'deepseek':
    case 'glm':
    case 'kimi':
```

바꾼 뒤:

```ts
    case 'deepseek':
      return streamOpenAiCompatible(
        OPENAI_COMPATIBLE_BASE_URLS.deepseek!,
        config,
        system,
        messages,
        tools,
        maxTokens,
        cb,
        'deepseek',
      )
    case 'glm':
    case 'kimi':
```

- [ ] **Step 6: 통과와 전체 확인**

Run: `npm run test -w @genoffice/ai-provider`
Expected: PASS 전체 (기존 `routes deepseek and openai to their fixed base URLs` 포함).
Run: `npm run typecheck -w @genoffice/ai-provider`
Expected: 오류 0건.

- [ ] **Step 7: 커밋**

```bash
git add packages/ai-provider/src packages/ai-provider/tests
```

그다음 별도 명령으로:

```bash
git commit -m "feat(ai-provider): stream reasoning, send DeepSeek reasoning back, retry once on 400" -m "OpenAI-compatible streams forward delta.reasoning_content. DeepSeek requests (variant 'deepseek') send each assistant turn's reasoning_content, leave temperature out in thinking mode and retry once with thinking disabled when the API rejects reasoning_content. Codex reasoning summaries use their own callback so they are never sent back." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 메인 연결부 — 생각 조각 전송과 메시지 `reasoning` 허용

**Files:**

- Modify: `apps/docs/src/main/ai-routing-ipc.ts` (`callbacks`, `parseMessages`)
- Modify: `apps/docs/tests/ai-routing-ipc.test.ts`

**Interfaces:**

- Consumes: `StreamCallbacks.onReasoningDelta/onReasoningSummaryDelta` (작업 4), `AiStreamChunk` (작업 4)
- Produces: 화면으로 가는 `{ requestId, type: 'thinking', thinkingKind: 'reasoning' | 'summary', text }` 조각. `parseAiStreamRequest`가 assistant 메시지의 `reasoning`을 허용.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/docs/tests/ai-routing-ipc.test.ts`의 `describe('credential-safe AI request validation', ...)` 안, `it('rejects legacy renderer-supplied provider settings'` 앞에 추가:

```ts
it('accepts the raw reasoning of an assistant turn so it can be sent back', () => {
  const request = parseAiStreamRequest({
    requestId: 'request-1',
    system: 'system',
    messages: [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'ok', reasoning: 'plan' },
    ],
  })
  expect(request.messages[1]).toEqual({ role: 'assistant', text: 'ok', reasoning: 'plan' })
})

it('rejects reasoning that is not text and reasoning on other roles', () => {
  expect(() =>
    parseAiStreamRequest({
      requestId: 'request-1',
      system: 'system',
      messages: [{ role: 'assistant', text: 'ok', reasoning: 7 }],
    }),
  ).toThrow()
  expect(() =>
    parseAiStreamRequest({
      requestId: 'request-1',
      system: 'system',
      messages: [{ role: 'user', text: 'ok', reasoning: 'x' }],
    }),
  ).toThrow('unsupported field: reasoning')
})
```

`describe('Codex dispatch', ...)` 안, `it('answers one-shot chat for a codex route through the bridge'` 앞에 추가:

```ts
it('forwards reasoning and reasoning summaries to the renderer as thinking chunks', async () => {
  codexBridge.streamCodexAppServer.mockImplementation(async (...args: unknown[]) => {
    const cb = args[5] as {
      onReasoningDelta(text: string): void
      onReasoningSummaryDelta(text: string): void
    }
    cb.onReasoningSummaryDelta('Reading the file')
    cb.onReasoningDelta('raw thought')
  })
  const { handlers, send } = registerWithCodexRoute()
  await handlers.get(AI_CHANNELS.stream)!(
    { sender: { id: 5, isDestroyed: () => false, send } },
    {
      requestId: 'codex-think',
      conversation: { projectId: 'default', chatId: '0123456789abcdef' },
      system: 'system',
      messages: [{ role: 'user', text: 'hi' }],
    },
  )
  expect(send).toHaveBeenCalledWith(AI_CHANNELS.streamChunk, {
    requestId: 'codex-think',
    type: 'thinking',
    thinkingKind: 'summary',
    text: 'Reading the file',
  })
  expect(send).toHaveBeenCalledWith(AI_CHANNELS.streamChunk, {
    requestId: 'codex-think',
    type: 'thinking',
    thinkingKind: 'reasoning',
    text: 'raw thought',
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/docs -- tests/ai-routing-ipc.test.ts`
Expected: FAIL — `unsupported field: reasoning`(assistant), `thinking` 조각이 `send`로 가지 않음.

- [ ] **Step 3: 구현한다**

`apps/docs/src/main/ai-routing-ipc.ts`의 `parseMessages` assistant 분기를 바꾼다. 바꾸기 전:

```ts
assertOnlyKeys(message, ['role', 'text', 'toolCalls'], 'AI assistant message')
const parsed: AiStreamRequest['messages'][number] = {
  role: 'assistant',
  text: boundedString(message.text, 'AI message text', MAX_USER_CHARS),
}
```

바꾼 뒤:

```ts
assertOnlyKeys(message, ['role', 'text', 'toolCalls', 'reasoning'], 'AI assistant message')
const parsed: AiStreamRequest['messages'][number] = {
  role: 'assistant',
  text: boundedString(message.text, 'AI message text', MAX_USER_CHARS),
}
if (message.reasoning !== undefined) {
  parsed.reasoning = boundedString(message.reasoning, 'AI message reasoning', MAX_USER_CHARS)
}
```

스트림 핸들러의 `callbacks`를 바꾼다. 바꾸기 전:

```ts
      const callbacks = {
        signal: controller.signal,
        onDelta: (text: string) => send({ requestId: request.requestId, type: 'delta', text }),
```

바꾼 뒤:

```ts
      const callbacks = {
        signal: controller.signal,
        onDelta: (text: string) => send({ requestId: request.requestId, type: 'delta', text }),
        onReasoningDelta: (text: string) =>
          send({ requestId: request.requestId, type: 'thinking', thinkingKind: 'reasoning', text }),
        onReasoningSummaryDelta: (text: string) =>
          send({ requestId: request.requestId, type: 'thinking', thinkingKind: 'summary', text }),
```

- [ ] **Step 4: 통과와 전체 확인**

Run: `npm run test -w @genoffice/docs -- tests/ai-routing-ipc.test.ts`
Expected: PASS.
Run: `npm run typecheck -w @genoffice/docs`
Expected: 오류 0건.

- [ ] **Step 5: 커밋**

```bash
git add apps/docs/src/main/ai-routing-ipc.ts apps/docs/tests/ai-routing-ipc.test.ts
```

그다음 별도 명령으로:

```bash
git commit -m "feat(docs): send thinking chunks to the renderer and accept assistant reasoning" -m "ai-routing-ipc forwards reasoning and Codex summaries as thinking chunks and lets assistant messages carry the reasoning to send back." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 대화 저장소에 `reasoning` / `thinking` 저장

**Files:**

- Modify: `packages/project-store/src/types.ts`, `ipc.ts`, `store.ts`
- Modify: `packages/project-store/tests/store.test.ts`
- Modify: `apps/docs/src/main/ai-routing-ipc.ts` (`parseProjectAppendArgs`), `apps/docs/tests/ai-routing-ipc.test.ts`
- Modify: `project:appendChat` 핸들러 네 곳 — `apps/docs/src/main/docs-main.ts`, `apps/sheets/src/main/sheets-main.ts`, `apps/slides/src/main/slides-main.ts`, `apps/pdf/src/main/pdf-main.ts`

**Interfaces:**

- Produces: `ChatMessage.reasoning?: string`, `ChatMessage.thinking?: string` (assistant 전용, 각 최대 32,000자·뒷부분 유지), `AppendChatArgs.reasoning?`, `AppendChatArgs.thinking?`.

- [ ] **Step 1: 실패하는 테스트를 쓴다 (저장소)**

`packages/project-store/tests/store.test.ts`의 `describe('appendChatMessage + loadChat', ...)` 안, `it('persists requested and resolved AI route provenance on assistant messages'` 앞에 추가:

```ts
it('stores reasoning and thinking on assistant messages only', () => {
  store.appendChatMessage('default', 'chat-think', {
    role: 'assistant',
    text: 'done',
    reasoning: 'raw thought',
    thinking: 'shown thought',
  })
  store.appendChatMessage('default', 'chat-think', {
    role: 'user',
    text: 'hi',
    reasoning: 'ignored',
    thinking: 'ignored',
  })
  const msgs = store.loadChat('default', 'chat-think')
  expect(msgs[0]).toMatchObject({ reasoning: 'raw thought', thinking: 'shown thought' })
  expect(msgs[1]).not.toHaveProperty('reasoning')
  expect(msgs[1]).not.toHaveProperty('thinking')
})

it('keeps the tail of reasoning and thinking beyond 32,000 characters', () => {
  const long = `HEAD-${'x'.repeat(40_000)}-TAIL`
  store.appendChatMessage('default', 'chat-long', {
    role: 'assistant',
    text: 'done',
    reasoning: long,
    thinking: long,
  })
  const msg = store.loadChat('default', 'chat-long')[0]!
  for (const field of [msg.reasoning!, msg.thinking!]) {
    expect(field.length).toBeLessThanOrEqual(32_000)
    expect(field.endsWith('-TAIL')).toBe(true)
    expect(field.startsWith('HEAD')).toBe(false)
  }
})

it('does not start the kept tail in the middle of a surrogate pair', () => {
  // 'a' + 20,000 emoji (two UTF-16 units each) + 'z' is 40,002 units: the cut at 8,002
  // lands between the two halves of an emoji, so a plain slice would start on a lone low surrogate
  const emoji = '😀'.repeat(20_000)
  store.appendChatMessage('default', 'chat-emoji', {
    role: 'assistant',
    text: 'done',
    reasoning: `a${emoji}z`,
  })
  const reasoning = store.loadChat('default', 'chat-emoji')[0]!.reasoning!
  const first = reasoning.charCodeAt(0)
  expect(first >= 0xdc00 && first <= 0xdfff).toBe(false)
  expect(reasoning.endsWith('z')).toBe(true)
  expect(reasoning.length).toBeLessThanOrEqual(32_000)
  expect(() => encodeURIComponent(reasoning)).not.toThrow()
})
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 (IPC 검증)**

`apps/docs/tests/ai-routing-ipc.test.ts`의 `describe('project IPC trusted-boundary validation', ...)` 안, `it('rejects malformed tools and attachment metadata'` 앞에 추가:

```ts
it('accepts reasoning and thinking on assistant appends only', () => {
  const base = { projectId: 'default', chatId: '0123456789abcdef', text: 'ok' }
  expect(
    parseProjectAppendArgs({ ...base, role: 'assistant', reasoning: 'raw', thinking: 'shown' }),
  ).toMatchObject({ reasoning: 'raw', thinking: 'shown' })
  expect(() => parseProjectAppendArgs({ ...base, role: 'user', reasoning: 'raw' })).toThrow()
  expect(() => parseProjectAppendArgs({ ...base, role: 'assistant', thinking: 5 })).toThrow()
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm run test -w @genoffice/project-store && npm run test -w @genoffice/docs -- tests/ai-routing-ipc.test.ts`
Expected: FAIL — 칸이 저장·허용되지 않음.

- [ ] **Step 4: 구현한다**

`packages/project-store/src/types.ts`의 `ChatMessage`에서 `tools?: ToolActivity[]` 아래에 추가:

```ts
  /** Raw model reasoning of an assistant message (sent back to providers that need it); the tail is kept past the cap */
  reasoning?: string
  /** What the panel's thinking box showed (raw reasoning or a Codex summary); the tail is kept past the cap */
  thinking?: string
```

`packages/project-store/src/ipc.ts`의 `AppendChatArgs`에서 `tools?: ToolActivity[]` 아래에 추가:

```ts
  reasoning?: string
  thinking?: string
```

`packages/project-store/src/store.ts`: `const TOOL_FIELD_MAX_CHARS = 16_000` 아래에 추가:

```ts
const THINKING_FIELD_MAX_CHARS = 32_000

/** the last `max` characters, never starting on a lone low surrogate */
function keepTail(text: string, max: number): string {
  if (text.length <= max) return text
  const tail = text.slice(text.length - max)
  const first = tail.charCodeAt(0)
  return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail
}
```

`appendChatMessage`에서 `if (msg.attachments !== undefined) record.attachments = msg.attachments` 바로 위에 추가:

```ts
if (msg.role === 'assistant') {
  if (msg.reasoning) record.reasoning = keepTail(msg.reasoning, THINKING_FIELD_MAX_CHARS)
  if (msg.thinking) record.thinking = keepTail(msg.thinking, THINKING_FIELD_MAX_CHARS)
}
```

`apps/docs/src/main/ai-routing-ipc.ts`의 `parseProjectAppendArgs`: 허용 키 목록을 바꾼다.

```ts
assertOnlyKeys(
  value,
  ['projectId', 'chatId', 'role', 'text', 'tools', 'attachments', 'ai', 'reasoning', 'thinking'],
  'Project append request',
)
```

`if (value.tools !== undefined) result.tools = parseChatTools(value.tools)` 아래에 추가:

```ts
for (const field of ['reasoning', 'thinking'] as const) {
  if (value[field] === undefined) continue
  if (value.role !== 'assistant') throw new Error(`Only assistant messages carry ${field}`)
  result[field] = boundedString(value[field], `Project chat ${field}`, MAX_CHAT_TEXT)
}
```

네 메인의 `project:appendChat` 핸들러에서 `if (args.ai) msg.ai = args.ai` 줄 아래에 각각 추가한다 (docs-main.ts, sheets-main.ts, slides-main.ts, pdf-main.ts — 같은 형태):

```ts
if (args.reasoning) msg.reasoning = args.reasoning
if (args.thinking) msg.thinking = args.thinking
```

(핸들러 안의 지역 변수 이름이 `msg`가 아니면 그 이름에 맞춘다. 네 파일 모두 `args`를 `parseProjectAppendArgs(value)`로 받는다.)

- [ ] **Step 5: 통과와 전체 확인**

Run: `npm run test -w @genoffice/project-store`
Expected: PASS.
Run: `npm run test -w @genoffice/docs -- tests/ai-routing-ipc.test.ts`
Expected: PASS.
Run: `npm run typecheck -w @genoffice/project-store && npm run typecheck -w @genoffice/docs && npm run typecheck -w @genoffice/sheets && npm run typecheck -w @genoffice/slides && npm run typecheck -w @genoffice/pdf`
Expected: 오류 0건.

- [ ] **Step 6: 커밋**

```bash
git add packages/project-store apps/docs/src/main/ai-routing-ipc.ts apps/docs/src/main/docs-main.ts apps/docs/tests/ai-routing-ipc.test.ts apps/sheets/src/main/sheets-main.ts apps/slides/src/main/slides-main.ts apps/pdf/src/main/pdf-main.ts
```

그다음 별도 명령으로:

```bash
git commit -m "feat(project-store): persist assistant reasoning and thinking" -m "ChatMessage gains reasoning and thinking, assistant-only, each capped at 32,000 characters keeping the tail without splitting a surrogate pair. The append validation and the four project:appendChat handlers pass them through." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 공용 "생각 과정" 상자 (`ThinkingBox`)

**Files:**

- Create: `packages/ui/src/ThinkingBox.tsx`, `packages/ui/src/ThinkingBox.css`, `packages/ui/tests/ThinkingBox.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**

- Produces:
  - `interface ThinkingLabels { thinking: string; show: string; hide: string }`
  - `thinkingLabels(lang: string | undefined): ThinkingLabels` — ko·en·ja·zh·zh-TW, 그 밖의 언어와 `undefined`는 영어
  - `ThinkingBox({ text: string; live: boolean; labels: ThinkingLabels }): JSX.Element | null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/ui/tests/ThinkingBox.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThinkingBox, thinkingLabels } from '../src/ThinkingBox'

describe('thinkingLabels', () => {
  it('translates ko, en, ja, zh and zh-TW and falls back to English', () => {
    expect(thinkingLabels('ko')).toEqual({
      thinking: '생각 중…',
      show: '생각 과정 보기 ▸',
      hide: '생각 과정 접기 ▾',
    })
    expect(thinkingLabels('en').show).toBe('Show thinking ▸')
    expect(thinkingLabels('ja').thinking).toBe('考え中…')
    expect(thinkingLabels('zh').show).toBe('查看思考过程 ▸')
    expect(thinkingLabels('zh-TW').show).toBe('查看思考過程 ▸')
    expect(thinkingLabels('fr')).toEqual(thinkingLabels('en'))
    expect(thinkingLabels(undefined)).toEqual(thinkingLabels('en'))
  })
})

describe('ThinkingBox', () => {
  let container: HTMLDivElement
  let root: Root
  const labels = thinkingLabels('ko')

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (text: string, live: boolean) =>
    act(() => {
      root.render(<ThinkingBox text={text} live={live} labels={labels} />)
    })

  it('draws nothing for empty or blank text', () => {
    render('', true)
    expect(container.innerHTML).toBe('')
    render('  \n ', false)
    expect(container.innerHTML).toBe('')
  })

  it('while live, shows the title and the streaming text without a toggle', () => {
    render('step one', true)
    expect(container.querySelector('.thinking-box--live')).not.toBeNull()
    expect(container.querySelector('.thinking-box__title')?.textContent).toBe('생각 중…')
    expect(container.querySelector('.thinking-box__body')?.textContent).toBe('step one')
    expect(container.querySelector('button')).toBeNull()
  })

  it('when not live, is one collapsed line that opens and closes on click', () => {
    render('step one', false)
    const toggle = container.querySelector('button')!
    expect(toggle.textContent).toBe('생각 과정 보기 ▸')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.thinking-box__body')).toBeNull()

    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('생각 과정 접기 ▾')
    expect(container.querySelector('.thinking-box__body')?.textContent).toBe('step one')

    act(() => toggle.click())
    expect(container.querySelector('.thinking-box__body')).toBeNull()
  })

  it('shows markup in the text literally instead of interpreting it', () => {
    const hostile = '<img src=x onerror=alert(1)> [link](http://example.com) <b>bold</b>'
    render(hostile, true)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('.thinking-box__body')?.textContent).toBe(hostile)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/ui -- tests/ThinkingBox.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/ThinkingBox"`.

- [ ] **Step 3: 구현한다**

`packages/ui/src/ThinkingBox.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react'
import './ThinkingBox.css'

export interface ThinkingLabels {
  /** title while the model is thinking */
  readonly thinking: string
  /** toggle while collapsed */
  readonly show: string
  /** toggle while expanded */
  readonly hide: string
}

const ENGLISH: ThinkingLabels = {
  thinking: 'Thinking…',
  show: 'Show thinking ▸',
  hide: 'Hide thinking ▾',
}

const LABELS: Record<string, ThinkingLabels> = {
  en: ENGLISH,
  ko: { thinking: '생각 중…', show: '생각 과정 보기 ▸', hide: '생각 과정 접기 ▾' },
  ja: { thinking: '考え中…', show: '思考プロセスを表示 ▸', hide: '思考プロセスを閉じる ▾' },
  zh: { thinking: '思考中…', show: '查看思考过程 ▸', hide: '收起思考过程 ▾' },
  'zh-TW': { thinking: '思考中…', show: '查看思考過程 ▸', hide: '收合思考過程 ▾' },
}

/** labels for a UI language code; languages without a translation read in English */
export function thinkingLabels(lang: string | undefined): ThinkingLabels {
  return (lang ? LABELS[lang] : undefined) ?? ENGLISH
}

export interface ThinkingBoxProps {
  readonly text: string
  /** the model is still thinking (no answer text yet): show the text as it streams in */
  readonly live: boolean
  readonly labels: ThinkingLabels
}

/**
 * The "thinking" box above an assistant answer. Live: a small muted box (about six lines,
 * following the newest text). Afterwards: one collapsed line that opens the full text.
 * The text is shown as plain text — it can contain document content, so nothing in it is interpreted.
 */
export function ThinkingBox({ text, live, labels }: ThinkingBoxProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (live && body) body.scrollTop = body.scrollHeight
  }, [text, live])

  if (!text.trim()) return null

  if (live) {
    return (
      <div className="thinking-box thinking-box--live">
        <div className="thinking-box__title">{labels.thinking}</div>
        <pre ref={bodyRef} className="thinking-box__body">
          {text}
        </pre>
      </div>
    )
  }

  return (
    <div className="thinking-box">
      <button
        type="button"
        className="thinking-box__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? labels.hide : labels.show}
      </button>
      {open && <pre className="thinking-box__body thinking-box__body--full">{text}</pre>}
    </div>
  )
}
```

`packages/ui/src/ThinkingBox.css`:

```css
.thinking-box {
  --thinking-box-muted: var(--color-text-secondary, #6b7280);
  --thinking-box-rule: var(--color-border-default, #d8dadd);
  --thinking-box-bg: var(--color-bg-subtle, #f3f4f6);
  margin: 0 0 6px;
  color: var(--thinking-box-muted);
  font-size: 12px;
  line-height: 1.5;
}

.thinking-box--live {
  padding: 6px 8px;
  border-left: 2px solid var(--thinking-box-rule);
  border-radius: 0 6px 6px 0;
  background: var(--thinking-box-bg);
}

.thinking-box__title {
  margin-bottom: 2px;
  font-weight: 600;
}

.thinking-box__body {
  margin: 0;
  max-height: 9em; /* six lines at 1.5 */
  overflow-y: auto;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.thinking-box__body--full {
  max-height: 24em;
  margin-top: 4px;
  padding: 6px 8px;
  border-left: 2px solid var(--thinking-box-rule);
  border-radius: 0 6px 6px 0;
  background: var(--thinking-box-bg);
}

.thinking-box__toggle {
  appearance: none;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.thinking-box__toggle:hover {
  text-decoration: underline;
}

.thinking-box__toggle:focus-visible {
  outline: 2px solid var(--color-brand-secondary, #2563eb);
  outline-offset: 2px;
}
```

`packages/ui/src/index.ts`의 `export { Markdown } from './Markdown'` 아래에 추가:

```ts
export { ThinkingBox, thinkingLabels } from './ThinkingBox'
export type { ThinkingBoxProps, ThinkingLabels } from './ThinkingBox'
```

- [ ] **Step 4: 통과와 전체 확인**

Run: `npm run test -w @genoffice/ui`
Expected: PASS 전체 (ModelPicker 테스트 포함).
Run: `npm run typecheck -w @genoffice/ui`
Expected: 오류 0건.

- [ ] **Step 5: 커밋**

```bash
git add packages/ui/src packages/ui/tests/ThinkingBox.test.tsx
```

그다음 별도 명령으로:

```bash
git commit -m "feat(ui): add the shared ThinkingBox" -m "A muted live box while the model thinks (about six lines, following the newest text) that collapses to one toggle line afterwards. Plain text only; empty text draws nothing. ko/en/ja/zh/zh-TW labels, English otherwise." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 한글(HWP) 패널

**Files:**

- Modify: `apps/hwp/src/renderer/ai/transport.ts`, `apps/hwp/src/renderer/ai/AiPanel.tsx`, `apps/hwp/src/shared/ipc.ts`
- Create: `apps/hwp/tests/transport-thinking.test.ts`
- Modify: `apps/hwp/tests/ai-panel-ui.test.ts`, `apps/hwp/tests/ai-panel-codex-notice.test.ts`

**Interfaces:**

- Consumes: `toRestorableMessages`, `AgentStreamCallbacks.onThinking`, `AgentRunResult.reasoning/thinking`, `AgentLoopEvents.onThinking` (작업 3); `ChatMessage.reasoning/thinking` (작업 6); `ThinkingBox`, `thinkingLabels` (작업 7)

- [ ] **Step 1: 실패하는 테스트를 쓴다 (전송 층)**

`apps/hwp/tests/transport-thinking.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../src/renderer/ai/transport'

type Chunk = { requestId: string; type: string; text?: string; thinkingKind?: string }

describe('HWP AI transport: thinking chunks', () => {
  it('forwards them as thinking and keeps the stream open', () => {
    let listener: ((chunk: Chunk) => void) | undefined
    const aiStream = vi.fn(async () => undefined)
    const unsubscribe = vi.fn()
    ;(window as unknown as { hwpApi: unknown }).hwpApi = {
      aiStream,
      aiStreamCancel: vi.fn(),
      onAiStream: (next: (chunk: Chunk) => void) => {
        listener = next
        return unsubscribe
      },
    }
    const transport = createElectronTransport(() => ({
      projectId: 'default',
      chatId: '0123456789abcdef',
    }))
    const cb = {
      onDelta: vi.fn(),
      onThinking: vi.fn(),
      onToolCall: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    transport.stream({ system: 's', messages: [], tools: [] }, cb)
    const requestId = (aiStream.mock.calls[0] as unknown as [{ requestId: string }])[0].requestId

    listener?.({ requestId, type: 'thinking', thinkingKind: 'summary', text: 'Reading' })
    listener?.({ requestId, type: 'thinking', thinkingKind: 'reasoning', text: 'raw' })
    expect(cb.onThinking.mock.calls).toEqual([
      ['Reading', 'summary'],
      ['raw', 'reasoning'],
    ])
    expect(cb.onError).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()

    listener?.({ requestId, type: 'done' })
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 (패널)**

`apps/hwp/tests/ai-panel-ui.test.ts`의 `vi.mock('@genoffice/ui', ...)`를 바꾼다:

```ts
vi.mock('@genoffice/ui', () => ({
  ModelPicker: () => React.createElement('div', { 'data-testid': 'picker' }),
  AiComposer: () => React.createElement('div', { 'data-testid': 'composer' }),
  Markdown: ({ text }: { text: string }) => React.createElement('div', null, text),
  ThinkingBox: ({ text, live }: { text: string; live: boolean }) =>
    React.createElement('div', { 'data-testid': 'thinking', 'data-live': String(live) }, text),
  thinkingLabels: () => ({ thinking: 'Thinking…', show: 'Show', hide: 'Hide' }),
}))
```

`installApi`를 바꾼다 (시그니처와 `loadProjectChat`):

```ts
function installApi(explore: unknown, chat: unknown[] = []) {
  const api = {
    resolveProjectChat: vi.fn(async () => ({ projectId: 'default', chatId: '0123456789abcdef' })),
    getAiPublicSettings: vi.fn(async () => ({
      globalDefault: route,
      providers: [{ id: 'openai', label: 'OpenAI', status: 'connected', hasApiKey: true }],
    })),
    listAiModels: vi.fn(async () => ({ models: [model] })),
    getAiConversationRoute: vi.fn(async () => route),
    setAiConversationRoute: vi.fn(async (_identity: unknown, next: unknown) => next),
    loadProjectChat: vi.fn(async () => chat),
    getLanguage: vi.fn(async () => 'ko'),
    onAiStream: vi.fn(() => () => undefined),
    aiSnapshot: vi.fn(async () => ({ ok: true })),
    aiQuery: vi.fn(async () => explore),
  }
  ;(window as unknown as { hwpApi: unknown }).hwpApi = api
  return api
}
```

`describe` 안, `it('hides the undo button until an AI edit exists'` 앞에 추가:

```ts
it('shows a collapsed thinking box for a restored assistant message', async () => {
  installApi({ ok: false, error: 'explore failed' }, [
    { seq: 0, ts: 't', role: 'user', text: 'question' },
    { seq: 1, ts: 't', role: 'assistant', text: 'answer', thinking: 'plan the edit' },
  ])
  await render(true)
  const box = container.querySelector('[data-testid="thinking"]')
  expect(box?.textContent).toBe('plan the edit')
  expect(box?.getAttribute('data-live')).toBe('false')
})
```

`apps/hwp/tests/ai-panel-codex-notice.test.ts`에서 `vi.mock('@genoffice/ui', ...)`가 있으면 같은 두 항목(`ThinkingBox`, `thinkingLabels`)을 팩토리에 추가한다. 없으면 건드리지 않는다.

- [ ] **Step 3: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/transport-thinking.test.ts tests/ai-panel-ui.test.ts`
Expected: FAIL — 전송 층: `thinking` 조각이 오류로 처리되어 `onThinking` 미호출·`onError` 호출; 패널: `[data-testid="thinking"]` 없음.

- [ ] **Step 4: 구현한다 — 전송 층과 IPC 타입**

`apps/hwp/src/renderer/ai/transport.ts`의 `onAiStream` 처리를 바꾼다. 바꾸기 전:

```ts
        if (chunk.type === 'delta') callbacks.onDelta(chunk.text ?? '')
        else if (chunk.type === 'tool-call') {
```

바꾼 뒤:

```ts
        if (chunk.type === 'delta') callbacks.onDelta(chunk.text ?? '')
        else if (chunk.type === 'thinking') {
          if (chunk.text) {
            callbacks.onThinking?.(chunk.text, chunk.thinkingKind === 'summary' ? 'summary' : 'reasoning')
          }
        } else if (chunk.type === 'tool-call') {
```

`apps/hwp/src/shared/ipc.ts`: `ProjectChatMessage`에서 `tools?: ProjectToolActivity[]` 아래에 추가:

```ts
  reasoning?: string
  thinking?: string
```

`HwpApi.appendProjectChat`의 인자 타입에서 `tools?: ProjectToolActivity[]` 아래에 추가:

```ts
    reasoning?: string
    thinking?: string
```

- [ ] **Step 5: 구현한다 — 패널**

`apps/hwp/src/renderer/ai/AiPanel.tsx`:

1. import 두 줄을 바꾼다:

```ts
import { AgentLoop, toRestorableMessages } from '@genoffice/agent-core'
```

```ts
import { AiComposer, Markdown, ModelPicker, ThinkingBox, thinkingLabels } from '@genoffice/ui'
```

2. `ChatEntry`: 바꾸기 전 `  retrySuggestion?: string\n  tools?: ToolActivity[]\n}` → 바꾼 뒤:

```ts
  retrySuggestion?: string
  tools?: ToolActivity[]
  /** what the thinking box shows for this turn */
  thinking?: string
}
```

3. `persistMessage`를 바꾼다. 바꾸기 전:

```ts
    tools?: ToolActivity[],
    route?: AiRoute | null,
  ): void => {
```

바꾼 뒤:

```ts
    tools?: ToolActivity[],
    route?: AiRoute | null,
    thought?: { reasoning?: string | undefined; thinking?: string | undefined },
  ): void => {
```

그리고 `appendProjectChat({ ... })` 안, `...(role === 'assistant' && tools && tools.length > 0 ? { tools } : {}),` 아래에 추가:

```ts
        ...(role === 'assistant' && thought?.reasoning ? { reasoning: thought.reasoning } : {}),
        ...(role === 'assistant' && thought?.thinking ? { thinking: thought.thinking } : {}),
```

4. 루프 이벤트: `onText: (text) => {` 바로 위에 추가:

```ts
        onThinking: (thinking) => {
          setPhase('thinking')
          patchLast({ thinking })
        },
```

`onDone: ({ text, cancelled, turnLimit }) => {`를 `onDone: ({ text, cancelled, turnLimit, reasoning, thinking }) => {`로 바꾸고, 같은 핸들러의 저장 호출을 바꾼다. 바꾸기 전:

```ts
persistMessage('assistant', final, runToolsRef.current, activeRunRouteRef.current)
```

바꾼 뒤:

```ts
persistMessage('assistant', final, runToolsRef.current, activeRunRouteRef.current, {
  reasoning,
  thinking,
})
```

5. 복원 두 곳. 첫 번째(경로·대화 불러오기). 바꾸기 전:

```ts
loopRef.current?.restore(messages.map((message) => ({ role: message.role, text: message.text })))
setChat(
  messages.map((message) => ({
    role: message.role,
    text: message.text,
    tools: message.tools,
  })),
)
```

바꾼 뒤:

```ts
loopRef.current?.restore(toRestorableMessages(messages))
setChat(
  messages.map((message) => ({
    role: message.role,
    text: message.text,
    tools: message.tools,
    ...(message.thinking ? { thinking: message.thinking } : {}),
  })),
)
```

두 번째(모델을 바꾼 뒤). 바꾸기 전:

```ts
            .map((entry) => ({ role: entry.role, text: entry.text, tools: entry.tools })),
        )
        void window.hwpApi
          .loadProjectChat({ projectId: identity.projectId, chatId: identity.chatId })
          .then((messages) =>
            loopRef.current?.restore(
              messages.map((message) => ({ role: message.role, text: message.text })),
            ),
          )
```

바꾼 뒤:

```ts
            .map((entry) => ({
              role: entry.role,
              text: entry.text,
              tools: entry.tools,
              thinking: entry.thinking,
            })),
        )
        void window.hwpApi
          .loadProjectChat({ projectId: identity.projectId, chatId: identity.chatId })
          .then((messages) => loopRef.current?.restore(toRestorableMessages(messages)))
```

6. 화면: `chat.map` 안의 말풍선에서 단계 표시 조건과 상자를 바꾼다. 바꾸기 전:

```tsx
              !entry.text &&
              entry.tools?.length === 0 && (
                <div className="hwp-ai__phase">
```

바꾼 뒤:

```tsx
              !entry.text &&
              !entry.thinking &&
              entry.tools?.length === 0 && (
                <div className="hwp-ai__phase">
```

그리고 `{entry.tools?.map((tool, toolIndex) => (` 바로 위에 추가:

```tsx
{
  entry.role === 'assistant' && entry.thinking && (
    <ThinkingBox
      text={entry.thinking}
      live={Boolean(entry.streaming && !entry.text)}
      labels={thinkingLabels(lang)}
    />
  )
}
```

- [ ] **Step 6: 통과와 전체 확인**

Run: `npm run test -w @genoffice/hwp`
Expected: PASS 전체.
Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 0건.
Run: `npx eslint apps/hwp/src apps/hwp/tests`
Expected: 오류 0건.

- [ ] **Step 7: 커밋**

```bash
git add apps/hwp/src apps/hwp/tests
```

그다음 별도 명령으로:

```bash
git commit -m "feat(hwp): show, save and restore the model's thinking in the AI panel" -m "The transport forwards thinking chunks. The panel shows a ThinkingBox per turn, saves the run's reasoning and thinking with the assistant message and restores both (reasoning goes back into the model context)." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 워드(docs) 패널

**Files:**

- Modify: `apps/docs/src/renderer/ai/transport.ts`, `apps/docs/src/renderer/ai/AiPanel.tsx`
- Modify: `apps/docs/tests/ai-transport.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/docs/tests/ai-transport.test.ts`의 `describe('Docs AI transport', ...)` 안, 기존 `it` 다음에 추가:

```ts
it('forwards thinking chunks with their kind and keeps the stream open', () => {
  let listener: ((chunk: AiStreamChunk) => void) | undefined
  const aiStream = vi.fn()
  const unsubscribe = vi.fn()
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: {
      aiStream,
      aiStreamCancel: vi.fn(),
      onAiStream: (next: (chunk: AiStreamChunk) => void) => {
        listener = next
        return unsubscribe
      },
    } satisfies Partial<DesktopApi>,
  })
  const transport = createElectronTransport(() => ({ projectId: 'p', chatId: 'c' }))
  const callbacks = {
    onDelta: vi.fn(),
    onThinking: vi.fn(),
    onToolCall: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  }
  transport.stream({ system: 's', messages: [], tools: [] }, callbacks)
  const requestId = (aiStream.mock.calls[0]![0] as { requestId: string }).requestId

  listener?.({ requestId, type: 'thinking', thinkingKind: 'summary', text: 'Reading' })
  listener?.({ requestId, type: 'thinking', thinkingKind: 'reasoning', text: 'raw' })
  expect(callbacks.onThinking.mock.calls).toEqual([
    ['Reading', 'summary'],
    ['raw', 'reasoning'],
  ])
  expect(callbacks.onError).not.toHaveBeenCalled()
  expect(unsubscribe).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/docs -- tests/ai-transport.test.ts`
Expected: FAIL — `thinking` 조각이 `onError`로 감.

- [ ] **Step 3: 구현한다 — 전송 층**

`apps/docs/src/renderer/ai/transport.ts`: 바꾸기 전:

```ts
        if (chunk.type === 'delta') {
          callbacks.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'tool-call') {
```

바꾼 뒤:

```ts
        if (chunk.type === 'delta') {
          callbacks.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'thinking') {
          if (chunk.text) {
            callbacks.onThinking?.(chunk.text, chunk.thinkingKind === 'summary' ? 'summary' : 'reasoning')
          }
        } else if (chunk.type === 'tool-call') {
```

- [ ] **Step 4: 구현한다 — 패널**

`apps/docs/src/renderer/ai/AiPanel.tsx`:

1. import: `@genoffice/agent-core` 목록(파일 위 10~15줄)에 `toRestorableMessages,`를 `composeSkills,` 다음 줄에 추가하고, `@genoffice/ui` 목록에 `ThinkingBox,`와 `thinkingLabels,`를 `ModelPicker,` 다음 줄에 추가한다.
2. 패널 컴포넌트의 `const { t } = useI18n()`(`AiPanel` 함수 첫 부분, 약 230줄)을 `const { t, lang } = useI18n()`로 바꾼다. 같은 파일 아래쪽(약 1391줄)의 `const { t: tr } = useI18n()`는 다른 컴포넌트이므로 건드리지 않는다.
3. `ChatEntry`: 바꾸기 전 `  retryRoute?: AiRoute\n  streaming?: boolean` → 바꾼 뒤:

```ts
  retryRoute?: AiRoute
  /** what the thinking box shows for this turn */
  thinking?: string
  streaming?: boolean
```

4. `persistMessage`: 바꾸기 전

```ts
    attachments?: AttachmentMeta[],
    route?: AiRoute | null,
  ) => {
```

바꾼 뒤:

```ts
    attachments?: AttachmentMeta[],
    route?: AiRoute | null,
    thought?: { reasoning?: string | undefined; thinking?: string | undefined },
  ) => {
```

그리고 `appendChat({ ... })`의 `...(role === 'assistant' && route ? { ai: { requested: route } } : {}),` 아래에 추가:

```ts
        ...(role === 'assistant' && thought?.reasoning ? { reasoning: thought.reasoning } : {}),
        ...(role === 'assistant' && thought?.thinking ? { thinking: thought.thinking } : {}),
```

5. 이벤트: 바꾸기 전 `        onText: (text) => patchLastAssistant({ text }),` → 바꾼 뒤:

```ts
        onThinking: (thinking) => patchLastAssistant({ thinking }),
        onText: (text) => patchLastAssistant({ text }),
```

`onDone: ({ text, cancelled, turnLimit }) => {`를 `onDone: ({ text, cancelled, turnLimit, reasoning, thinking }) => {`로 바꾸고 저장 호출을 바꾼다. 바꾸기 전:

```ts
persistMessage('assistant', finalText, runToolsRef.current, undefined, activeRunRouteRef.current)
```

바꾼 뒤:

```ts
persistMessage('assistant', finalText, runToolsRef.current, undefined, activeRunRouteRef.current, {
  reasoning,
  thinking,
})
```

6. 복원: 바꾸기 전

```ts
loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
```

바꾼 뒤:

```ts
loopRef.current?.restore(toRestorableMessages(msgs))
```

과거 대화(`setHistoricChat(msgs.map((m) => ({ role: m.role, text: m.text, tools: ... })))`)에 칸을 추가한다. `text: m.text,` 다음 줄에:

```ts
            ...(m.thinking ? { thinking: m.thinking } : {}),
```

7. 화면. 과거 대화 말풍선: 바꾸기 전

```tsx
{
  entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />
}
{
  entry.text && <Markdown text={entry.text} />
}
```

(과거 대화 `historicChat.map` 안의 것) 바꾼 뒤:

```tsx
{
  entry.role === 'assistant' && entry.thinking && (
    <ThinkingBox text={entry.thinking} live={false} labels={thinkingLabels(lang)} />
  )
}
{
  entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />
}
{
  entry.text && <Markdown text={entry.text} />
}
```

현재 대화 말풍선: 바꾸기 전

```tsx
              {entry.role === 'assistant' && !entry.text && entry.streaming ? (
                <span className="ai-typing-row">
```

바꾼 뒤:

```tsx
              {entry.role === 'assistant' && entry.thinking && (
                <ThinkingBox
                  text={entry.thinking}
                  live={Boolean(entry.streaming && !entry.text)}
                  labels={thinkingLabels(lang)}
                />
              )}
              {entry.role === 'assistant' && !entry.text && entry.streaming ? (
                <span className="ai-typing-row">
```

- [ ] **Step 5: 통과와 전체 확인**

Run: `npm run test -w @genoffice/docs`
Expected: PASS 전체. (테스트가 `@genoffice/ui`를 부분 목(mock)으로 바꿔 둔 파일이 있어 `ThinkingBox`가 없다고 실패하면, 그 목 팩토리에 `ThinkingBox`와 `thinkingLabels`를 추가한다.)
Run: `npm run typecheck -w @genoffice/docs`
Expected: 오류 0건.
Run: `npx eslint apps/docs/src/renderer/ai apps/docs/tests/ai-transport.test.ts`
Expected: 오류 0건.

- [ ] **Step 6: 커밋**

```bash
git add apps/docs/src/renderer/ai apps/docs/tests
```

그다음 별도 명령으로:

```bash
git commit -m "feat(docs): show, save and restore the model's thinking in the AI panel" -m "Same behaviour as the HWP panel: the transport forwards thinking chunks, the panel shows a ThinkingBox per turn, saves the run's reasoning and thinking and restores both." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 파워포인트(slides) 패널

**Files:**

- Modify: `apps/slides/src/renderer/ai/transport.ts`, `apps/slides/src/renderer/ai/AiPanel.tsx`
- Modify: `apps/slides/tests/ai-transport.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/slides/tests/ai-transport.test.ts`의 `describe` 안, 기존 `it` 다음에 추가:

```ts
it('forwards thinking chunks with their kind and keeps the stream open', () => {
  let listener:
    | ((chunk: { requestId: string; type: string; text?: string; thinkingKind?: string }) => void)
    | undefined
  const start = vi.fn().mockResolvedValue(undefined)
  const unsubscribe = vi.fn()
  Object.assign(window, {
    slidesApi: {
      onAiStream: (next: typeof listener) => {
        listener = next
        return unsubscribe
      },
      aiStream: start,
      aiStreamCancel: vi.fn(),
    },
  })
  const transport = createElectronTransport(() => ({ projectId: 'p', chatId: 'c' }))
  const callbacks = {
    onDelta: vi.fn(),
    onThinking: vi.fn(),
    onToolCall: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  }
  transport.stream({ system: 's', messages: [], tools: [] }, callbacks)
  const requestId = (start.mock.calls[0]![0] as { requestId: string }).requestId

  listener?.({ requestId, type: 'thinking', thinkingKind: 'summary', text: 'Reading' })
  listener?.({ requestId, type: 'thinking', thinkingKind: 'reasoning', text: 'raw' })
  expect(callbacks.onThinking.mock.calls).toEqual([
    ['Reading', 'summary'],
    ['raw', 'reasoning'],
  ])
  expect(callbacks.onError).not.toHaveBeenCalled()
  expect(unsubscribe).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/slides -- tests/ai-transport.test.ts`
Expected: FAIL — `thinking` 조각이 `onError`로 가고 구독이 해제됨.

- [ ] **Step 3: 구현한다 — 전송 층**

`apps/slides/src/renderer/ai/transport.ts`: 바꾸기 전

```ts
        if (chunk.type === 'delta') {
          callbacks.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'tool-call') {
```

바꾼 뒤:

```ts
        if (chunk.type === 'delta') {
          callbacks.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'thinking') {
          if (chunk.text) {
            callbacks.onThinking?.(chunk.text, chunk.thinkingKind === 'summary' ? 'summary' : 'reasoning')
          }
        } else if (chunk.type === 'tool-call') {
```

(같은 파일의 `AiPanel.tsx` 약 644줄에 있는 비루프 스트림 리스너는 `delta`/`done`/`error`만 보고 나머지는 무시하므로 건드리지 않는다.)

- [ ] **Step 4: 구현한다 — 패널**

`apps/slides/src/renderer/ai/AiPanel.tsx`:

1. import: 2번째 줄을 `import { AgentLoop, composeSkills, toRestorableMessages, type AgentImage, type ToolDisplay } from '@genoffice/agent-core'`로, 35번째 줄 부근을 `import { Markdown, ModelPicker, ThinkingBox, thinkingLabels, type ModelPickerModel } from '@genoffice/ui'`로 바꾼다.
2. 패널 컴포넌트의 `const { t } = useI18n()`(`AiPanel` 함수 첫 부분, 약 259줄)을 `const { t, lang } = useI18n()`로 바꾼다. 아래쪽의 다른 `useI18n()` 호출(2155, 2238, 2381줄)은 건드리지 않는다.
3. `ChatEntry`: 바꾸기 전 `  retrySuggestion?: string\n  streaming?: boolean` → 바꾼 뒤:

```ts
  retrySuggestion?: string
  /** what the thinking box shows for this turn */
  thinking?: string
  streaming?: boolean
```

4. `persistMessage`: 마지막 매개변수 `attachments?: AttachmentMeta[],` 다음에 추가:

```ts
    thought?: { reasoning?: string | undefined; thinking?: string | undefined },
```

그리고 `appendChat({ ... })`의 `...(role === 'assistant' && activeRunRouteRef.current ? { ai: { requested: activeRunRouteRef.current } } : {}),` 블록 다음(같은 객체 안)에 추가:

```ts
        ...(role === 'assistant' && thought?.reasoning ? { reasoning: thought.reasoning } : {}),
        ...(role === 'assistant' && thought?.thinking ? { thinking: thought.thinking } : {}),
```

5. 이벤트: 바꾸기 전 `        onText: (text) => patchLastAssistant({ text }),` → 바꾼 뒤:

```ts
        onThinking: (thinking) => patchLastAssistant({ thinking }),
        onText: (text) => patchLastAssistant({ text }),
```

`onDone: ({ text, cancelled, turnLimit }) => {`를 `onDone: ({ text, cancelled, turnLimit, reasoning, thinking }) => {`로 바꾸고 저장 호출을 바꾼다. 바꾸기 전:

```ts
persistMessage('assistant', finalText, runToolsRef.current)
```

바꾼 뒤:

```ts
persistMessage('assistant', finalText, runToolsRef.current, undefined, {
  reasoning,
  thinking,
})
```

6. 복원: 바꾸기 전

```ts
loopRef.current?.restore(msgs.map((message) => ({ role: message.role, text: message.text })))
```

바꾼 뒤:

```ts
loopRef.current?.restore(toRestorableMessages(msgs))
```

그리고 `setHistoricChat(msgs.map((message) => ({ role: message.role, text: message.text, tools: ... })))`의 `text: message.text,` 다음 줄에 추가:

```ts
            ...(message.thinking ? { thinking: message.thinking } : {}),
```

7. 화면. 과거 대화 말풍선: 바꾸기 전

```tsx
{
  entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />
}
{
  entry.text && <Markdown text={entry.text} />
}
```

(`historicChat.map` 안의 것) 바꾼 뒤:

```tsx
{
  entry.role === 'assistant' && entry.thinking && (
    <ThinkingBox text={entry.thinking} live={false} labels={thinkingLabels(lang)} />
  )
}
{
  entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />
}
{
  entry.text && <Markdown text={entry.text} />
}
```

현재 대화 말풍선: 바꾸기 전

```tsx
              {entry.role === 'assistant' && !entry.text && entry.streaming ? (
                <span className="ai-typing-row">
```

바꾼 뒤:

```tsx
              {entry.role === 'assistant' && entry.thinking && (
                <ThinkingBox
                  text={entry.thinking}
                  live={Boolean(entry.streaming && !entry.text)}
                  labels={thinkingLabels(lang)}
                />
              )}
              {entry.role === 'assistant' && !entry.text && entry.streaming ? (
                <span className="ai-typing-row">
```

- [ ] **Step 5: 통과와 전체 확인**

Run: `npm run test -w @genoffice/slides`
Expected: PASS 전체.
Run: `npm run typecheck -w @genoffice/slides`
Expected: 오류 0건.
Run: `npx eslint apps/slides/src/renderer/ai apps/slides/tests/ai-transport.test.ts`
Expected: 오류 0건.

- [ ] **Step 6: 커밋**

```bash
git add apps/slides/src/renderer/ai apps/slides/tests
```

그다음 별도 명령으로:

```bash
git commit -m "feat(slides): show, save and restore the model's thinking in the AI panel" -m "Same behaviour as the HWP panel. The separate non-loop stream listener ignores thinking chunks." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: PDF 패널

**Files:**

- Modify: `apps/pdf/src/renderer/ai/transport.ts`, `apps/pdf/src/renderer/ai/AiPanel.tsx`, `apps/pdf/src/renderer/ai/model-routing.ts`, `apps/pdf/src/shared/ipc.ts`
- Create: `apps/pdf/tests/ai-transport-thinking.test.ts`
- Modify: `apps/pdf/tests/model-routing.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/pdf/tests/ai-transport-thinking.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../src/renderer/ai/transport'

type Chunk = { requestId: string; type: string; text?: string; thinkingKind?: string }

describe('PDF AI transport: thinking chunks', () => {
  it('forwards them as thinking and keeps the stream open', () => {
    let listener: ((chunk: Chunk) => void) | undefined
    const aiStream = vi.fn(async () => undefined)
    const unsubscribe = vi.fn()
    ;(window as unknown as { pdfApi: unknown }).pdfApi = {
      aiStream,
      aiStreamCancel: vi.fn(),
      onAiStream: (next: (chunk: Chunk) => void) => {
        listener = next
        return unsubscribe
      },
    }
    const transport = createElectronTransport(() => ({ projectId: 'p', chatId: 'c' }))
    const cb = {
      onDelta: vi.fn(),
      onThinking: vi.fn(),
      onToolCall: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    transport.stream({ system: 's', messages: [], tools: [] }, cb)
    const requestId = (aiStream.mock.calls[0] as unknown as [{ requestId: string }])[0].requestId

    listener?.({ requestId, type: 'thinking', thinkingKind: 'summary', text: 'Reading' })
    listener?.({ requestId, type: 'thinking', thinkingKind: 'reasoning', text: 'raw' })
    expect(cb.onThinking.mock.calls).toEqual([
      ['Reading', 'summary'],
      ['raw', 'reasoning'],
    ])
    expect(cb.onError).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()
  })
})
```

`apps/pdf/tests/model-routing.test.ts` 파일 끝에 추가:

```ts
describe('restorePdfTranscript thinking', () => {
  it('carries the thinking of restored assistant messages', () => {
    const messages = [
      { seq: 0, ts: 't', role: 'user' as const, text: 'question' },
      { seq: 1, ts: 't', role: 'assistant' as const, text: 'answer', thinking: 'plan' },
    ]
    expect(restorePdfTranscript(messages)).toEqual([
      { role: 'user', text: 'question' },
      { role: 'assistant', text: 'answer', thinking: 'plan' },
    ])
  })
})
```

(이 파일에 이미 `describe`가 import되어 있다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/pdf -- tests/ai-transport-thinking.test.ts tests/model-routing.test.ts`
Expected: FAIL — `thinking` 조각이 오류 처리됨, 복원 항목에 `thinking`이 없음.

- [ ] **Step 3: 구현한다 — 전송 층, IPC 타입, 복원 도우미**

`apps/pdf/src/renderer/ai/transport.ts`: 바꾸기 전

```ts
        if (chunk.type === 'delta') callbacks.onDelta(chunk.text ?? '')
        else if (chunk.type === 'tool-call') {
```

바꾼 뒤:

```ts
        if (chunk.type === 'delta') callbacks.onDelta(chunk.text ?? '')
        else if (chunk.type === 'thinking') {
          if (chunk.text) {
            callbacks.onThinking?.(chunk.text, chunk.thinkingKind === 'summary' ? 'summary' : 'reasoning')
          }
        } else if (chunk.type === 'tool-call') {
```

`apps/pdf/src/shared/ipc.ts`: `ProjectChatMessage`와 `AppendProjectChatArgs` 둘 다 `tools?: ProjectToolActivity[]` 줄 아래에 추가:

```ts
  reasoning?: string
  thinking?: string
```

`apps/pdf/src/renderer/ai/model-routing.ts`: `RestoredPdfChatEntry`의 첫 변형을 바꾼다.

```ts
export type RestoredPdfChatEntry =
  | {
      role: 'user' | 'assistant'
      text: string
      tools?: ProjectChatMessage['tools']
      thinking?: string
    }
  | { role: 'divider'; text: string }
```

`restorePdfTranscript`의 `entries.push({...})`를 바꾼다. 바꾸기 전:

```ts
entries.push({
  role: message.role,
  text: message.text,
  ...(message.tools ? { tools: message.tools } : {}),
})
```

바꾼 뒤:

```ts
entries.push({
  role: message.role,
  text: message.text,
  ...(message.tools ? { tools: message.tools } : {}),
  ...(message.thinking ? { thinking: message.thinking } : {}),
})
```

- [ ] **Step 4: 구현한다 — 패널**

`apps/pdf/src/renderer/ai/AiPanel.tsx` (이 패널은 이미 `const { lang, t } = useI18n()`를 쓴다):

1. import: `import { AgentLoop } from '@genoffice/agent-core'`를 `import { AgentLoop, toRestorableMessages } from '@genoffice/agent-core'`로, `@genoffice/ui` import를 `import { AiComposer, AiTypingIndicator, Markdown, ModelPicker, ThinkingBox, thinkingLabels } from '@genoffice/ui'`로 바꾼다.
2. `MessageChatEntry`: `tools?: ToolActivity[]\n}` 앞에 칸을 넣는다. 바꾸기 전 `  undelivered?: boolean\n  tools?: ToolActivity[]\n}` → 바꾼 뒤:

```ts
  undelivered?: boolean
  tools?: ToolActivity[]
  /** what the thinking box shows for this turn */
  thinking?: string
}
```

3. `persistMessage`: 바꾸기 전

```ts
    tools?: ProjectToolActivity[],
    route?: AiRoute | null,
  ): void => {
```

바꾼 뒤:

```ts
    tools?: ProjectToolActivity[],
    route?: AiRoute | null,
    thought?: { reasoning?: string | undefined; thinking?: string | undefined },
  ): void => {
```

그리고 `appendProjectChat({ ... })`의 `...(role === 'assistant' && route ? { ai: { requested: route } } : {}),` 아래에 추가:

```ts
        ...(role === 'assistant' && thought?.reasoning ? { reasoning: thought.reasoning } : {}),
        ...(role === 'assistant' && thought?.thinking ? { thinking: thought.thinking } : {}),
```

4. 이벤트: `onText: (text) => {` 바로 위에 추가:

```ts
        onThinking: (thinking) => {
          setPhase('thinking')
          patchLast({ thinking })
        },
```

`onDone: ({ text, cancelled, turnLimit }) => {`를 `onDone: ({ text, cancelled, turnLimit, reasoning, thinking }) => {`로 바꾸고 저장 호출을 바꾼다. 바꾸기 전:

```ts
persistMessage('assistant', final, runToolsRef.current, activeRunRouteRef.current)
```

바꾼 뒤:

```ts
persistMessage('assistant', final, runToolsRef.current, activeRunRouteRef.current, {
  reasoning,
  thinking,
})
```

5. 복원: 바꾸기 전

```ts
loopRef.current?.restore(messages.map((message) => ({ role: message.role, text: message.text })))
```

바꾼 뒤:

```ts
loopRef.current?.restore(toRestorableMessages(messages))
```

6. 화면: 바꾸기 전

```tsx
const hasTools = (entry.tools?.length ?? 0) > 0
if (!entry.text && !hasTools) return null
```

바꾼 뒤:

```tsx
const hasTools = (entry.tools?.length ?? 0) > 0
const hasThinking = Boolean(entry.thinking)
if (!entry.text && !hasTools && !hasThinking) return null
```

그리고 바꾸기 전 `              {hasTools && <ToolChipList tools={entry.tools!} />}` → 바꾼 뒤:

```tsx
{
  hasThinking && (
    <ThinkingBox
      text={entry.thinking!}
      live={Boolean(entry.streaming && !entry.text)}
      labels={thinkingLabels(lang)}
    />
  )
}
{
  hasTools && <ToolChipList tools={entry.tools!} />
}
```

- [ ] **Step 5: 통과와 전체 확인**

Run: `npm run test -w @genoffice/pdf`
Expected: PASS 전체.
Run: `npm run typecheck -w @genoffice/pdf`
Expected: 오류 0건.
Run: `npx eslint apps/pdf/src apps/pdf/tests`
Expected: 오류 0건.

- [ ] **Step 6: 커밋**

```bash
git add apps/pdf/src apps/pdf/tests
```

그다음 별도 명령으로:

```bash
git commit -m "feat(pdf): show, save and restore the model's thinking in the AI panel" -m "Same behaviour as the HWP panel. A streaming assistant entry that only has thinking is now drawn instead of skipped." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 엑셀(sheets) 패널

**Files:**

- Modify: `apps/sheets/src/renderer/ai/transport.ts`, `apps/sheets/src/renderer/ai/AiChatPanel.tsx`, `apps/sheets/src/renderer/App.tsx`
- Create: `apps/sheets/tests/ai-transport-thinking.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/sheets/tests/ai-transport-thinking.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../src/renderer/ai/transport'

type Chunk = { requestId: string; type: string; text?: string; thinkingKind?: string }

describe('Sheets AI transport: thinking chunks', () => {
  it('forwards them as thinking and keeps the stream open', () => {
    let listener: ((chunk: Chunk) => void) | undefined
    const aiStream = vi.fn(async () => undefined)
    const unsubscribe = vi.fn()
    ;(window as unknown as { desktopApi: unknown }).desktopApi = {
      aiStream,
      aiStreamCancel: vi.fn(async () => undefined),
      onAiStream: (next: (chunk: Chunk) => void) => {
        listener = next
        return unsubscribe
      },
    }
    const transport = createElectronTransport(() => ({ projectId: 'p', chatId: 'c' }))
    const cb = {
      onDelta: vi.fn(),
      onThinking: vi.fn(),
      onToolCall: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    transport.stream({ system: 's', messages: [], tools: [] }, cb)
    const requestId = (aiStream.mock.calls[0] as unknown as [{ requestId: string }])[0].requestId

    listener?.({ requestId, type: 'thinking', thinkingKind: 'summary', text: 'Reading' })
    listener?.({ requestId, type: 'thinking', thinkingKind: 'reasoning', text: 'raw' })
    expect(cb.onThinking.mock.calls).toEqual([
      ['Reading', 'summary'],
      ['raw', 'reasoning'],
    ])
    expect(cb.onError).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/sheets -- tests/ai-transport-thinking.test.ts`
Expected: FAIL — `thinking` 조각이 `onError`로 가고 구독이 해제됨.

- [ ] **Step 3: 구현한다 — 전송 층**

`apps/sheets/src/renderer/ai/transport.ts`: 바꾸기 전

```ts
        if (chunk.type === 'delta') {
          callbacks.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'tool-call') {
```

바꾼 뒤:

```ts
        if (chunk.type === 'delta') {
          callbacks.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'thinking') {
          if (chunk.text) {
            callbacks.onThinking?.(chunk.text, chunk.thinkingKind === 'summary' ? 'summary' : 'reasoning')
          }
        } else if (chunk.type === 'tool-call') {
```

- [ ] **Step 4: 구현한다 — 패널과 App**

`apps/sheets/src/renderer/ai/AiChatPanel.tsx`:

1. `import { Markdown } from '@genoffice/ui'`를 `import { Markdown, ThinkingBox, thinkingLabels } from '@genoffice/ui'`로 바꾼다.
2. `AiChatMessage`에 칸을 추가한다. 바꾸기 전 `  readonly streaming?: boolean | undefined\n  readonly isError?: boolean | undefined` → 바꾼 뒤:

```ts
  readonly streaming?: boolean | undefined
  /** what the thinking box shows for this turn */
  readonly thinking?: string | undefined
  readonly isError?: boolean | undefined
```

3. 패널의 `const { t } = useI18n()`(약 129줄, `readonly onCollapse` 매개변수 다음)을 `const { t, lang } = useI18n()`로 바꾼다. 아래쪽의 다른 `useI18n()`(약 604줄)은 건드리지 않는다.
4. 화면. 과거 대화: 바꾸기 전

```tsx
{
  entry.tools.length > 0 && <ToolChipList tools={entry.tools} />
}
{
  entry.text && <Markdown text={entry.text} />
}
```

(`historicChat.map` 안의 것) 바꾼 뒤:

```tsx
{
  entry.role === 'assistant' && entry.thinking && (
    <ThinkingBox text={entry.thinking} live={false} labels={thinkingLabels(lang)} />
  )
}
{
  entry.tools.length > 0 && <ToolChipList tools={entry.tools} />
}
{
  entry.text && <Markdown text={entry.text} />
}
```

현재 대화: 바꾸기 전

```tsx
              <>
                {entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
                {entry.text ? (
```

바꾼 뒤:

```tsx
              <>
                {entry.thinking && (
                  <ThinkingBox
                    text={entry.thinking}
                    live={Boolean(entry.streaming && !entry.text)}
                    labels={thinkingLabels(lang)}
                  />
                )}
                {entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
                {entry.text ? (
```

`apps/sheets/src/renderer/App.tsx`:

1. `import { AgentLoop, composeSkills, type AgentImage } from '@genoffice/agent-core'`를 `import { AgentLoop, composeSkills, toRestorableMessages, type AgentImage } from '@genoffice/agent-core'`로 바꾼다.
2. `persistChatMessage`의 `tools?` 매개변수 다음(닫는 `) => {` 앞)에 추가:

```ts
    thought?: { reasoning?: string | undefined; thinking?: string | undefined },
```

그리고 `.appendChat({ ... })`의 `...(role === 'assistant' && route ? { ai: { requested: route } } : {}),` 아래에 추가:

```ts
        ...(role === 'assistant' && thought?.reasoning ? { reasoning: thought.reasoning } : {}),
        ...(role === 'assistant' && thought?.thinking ? { thinking: thought.thinking } : {}),
```

3. 루프 이벤트: `onText: (text) => {` 바로 위에 추가:

```ts
        onThinking: (thinking) => {
          patchLastAssistant((entry) => ({ ...entry, thinking }))
        },
```

`onDone: ({ text, cancelled, turnLimit }) => {`를 `onDone: ({ text, cancelled, turnLimit, reasoning, thinking }) => {`로 바꾸고 저장 호출을 바꾼다. 바꾸기 전:

```ts
persistChatMessage('assistant', finalText, runToolsRef.current)
```

바꾼 뒤:

```ts
persistChatMessage('assistant', finalText, runToolsRef.current, {
  reasoning,
  thinking,
})
```

4. 복원: 과거 대화 매핑에 칸을 추가한다. 바꾸기 전

```ts
          msgs.map((m) => ({
            role: m.role,
            text: m.text,
            tools:
```

바꾼 뒤:

```ts
          msgs.map((m) => ({
            role: m.role,
            text: m.text,
            ...(m.thinking ? { thinking: m.thinking } : {}),
            tools:
```

그리고 바꾸기 전

```ts
agentLoopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
```

바꾼 뒤:

```ts
agentLoopRef.current?.restore(toRestorableMessages(msgs))
```

- [ ] **Step 5: 통과와 전체 확인**

Run: `npm run test -w @genoffice/sheets`
Expected: 새 테스트 PASS. 이 작업의 변경과 무관한 기존 실패(Windows `EPERM fsync` 3건)가 있으면 이름을 기록하고 이 작업의 실패로 세지 않는다.
Run: `npm run typecheck -w @genoffice/sheets`
Expected: 오류 0건.
Run: `npx eslint apps/sheets/src/renderer apps/sheets/tests/ai-transport-thinking.test.ts`
Expected: 오류 0건.

- [ ] **Step 6: 커밋**

```bash
git add apps/sheets/src/renderer apps/sheets/tests
```

그다음 별도 명령으로:

```bash
git commit -m "feat(sheets): show, save and restore the model's thinking in the AI panel" -m "Same behaviour as the HWP panel; the loop lives in App, the panel draws the ThinkingBox." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: 실제 키로 확인하고 문서화

이 작업은 새 제품 코드를 거의 쓰지 않고 확인과 문서를 한다. 확인에서 결함이 나오면 해당 코드를 고치되, 먼저 그 결함을 재현하는 실패 테스트를 쓴다 (RED → GREEN). 키는 사용자 환경 변수에만 있고, 드라이버는 그 값을 출력하지 않는다.

**Files:**

- Create (gitignored): `scripts/drivers/driver.ai-thinking.mjs`
- Modify: `README.md`, `MODIFICATIONS.md`, `docs/superpowers/specs/2026-10-02-ai-thinking-stream-design.md` (상태), 이 계획의 맨 아래 수용 로그

- [ ] **Step 1: 전체 빌드와 관문**

Run: `npm run build:all`
Expected: 전 모듈 빌드 성공.
Run: `npm run lint`
Expected: 오류 0건 (경고는 기존 것만).
Run: `npm run typecheck`
Expected: 오류 0건.
Run: `npm run format:check`
Expected: "No changed files to format." 이외의 지적이 없음. 지적이 있으면 해당 파일에 `npx prettier --write`.
Run: `npm run test`
Expected: PASS. 이 브랜치와 무관한 기존 실패(sheets의 Windows `EPERM fsync`)는 이름을 기록한다.

- [ ] **Step 2: 확인 드라이버를 쓴다**

`scripts/drivers/driver.ai-thinking.mjs`는 gitignore되어 있다 (`git check-ignore -q scripts/drivers/driver.ai-thinking.mjs`가 성공해야 한다). 내용:

```js
// Local acceptance driver (gitignored): live thinking box on a real model.
//   node scripts/drivers/driver.ai-thinking.mjs --module=hwp --route=deepseek [--reopen] [<path\to\Open GenOffice.exe>]
// --module hwp|docs · --route deepseek|codex · --reopen (hwp only): second launch on the same profile+file
// Uses the machine's real sign-ins and the GENOFFICE_SEED_DEEPSEEK_API_KEY variable; never prints a key.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(resolve('D:/genoffice/package.json'))
const { _electron: electron } = require('playwright-core')
const arg = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=')[1] ?? fallback
const MODULE = arg('module', 'hwp')
const ROUTE = arg('route', 'deepseek')
const REOPEN = process.argv.includes('--reopen')
const packagedExe = process.argv.slice(2).find((a) => !a.startsWith('--'))
const OUT = 'D:/genoffice/scripts/drivers/out/thinking'
const SHELL_DIR = 'D:/genoffice/apps/shell'
const RHWP = `D:/genoffice/apps/hwp/native/rhwp/${process.platform}-${process.arch}/rhwp${process.platform === 'win32' ? '.exe' : ''}`
await mkdir(OUT, { recursive: true })

const profile = await mkdtemp(join(tmpdir(), 'genoffice-thinking-'))
await writeFile(join(profile, 'app-settings.json'), JSON.stringify({ onboardingSeen: true }))
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
let doc = null
if (MODULE === 'hwp') {
  doc = join(OUT, `thinking-${Date.now()}.hwpx`)
  const made = spawnSync(
    RHWP,
    ['scaffold', 'D:/genoffice/apps/hwp/tests/fixtures/scaffold-basic.json', '-o', doc, '--json'],
    { encoding: 'utf8' },
  )
  if (made.status !== 0) throw new Error('scaffold failed')
}

async function launch() {
  const base = { ...env, GENOFFICE_LANG: 'ko' }
  if (packagedExe) {
    if (!existsSync(packagedExe)) throw new Error(`packaged app not found: ${packagedExe}`)
    return electron.launch({
      executablePath: packagedExe,
      args: [...(doc ? [doc] : []), '--disable-gpu'],
      env: base,
    })
  }
  return electron.launch({
    executablePath: require('electron'),
    args: [SHELL_DIR, ...(doc ? [doc] : []), '--disable-gpu'],
    env: { ...base, GENOFFICE_USER_DATA: profile },
  })
}

async function findPanelPage(app, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (
        (await page
          .locator('.ai-input-box textarea')
          .count()
          .catch(() => 0)) > 0
      )
        return page
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('no window with the AI composer appeared')
}

async function pickModel(page, route) {
  const wanted = route === 'codex' ? /gpt-5\.6-luna|luna/i : /deepseek-flash/i
  const trigger = page.locator('.model-picker__trigger').first()
  await trigger.waitFor({ timeout: 60_000 })
  if (wanted.test((await trigger.textContent()) ?? '')) return
  await trigger.click()
  await page.locator('[role="option"]', { hasText: wanted }).first().click({ timeout: 30_000 })
}

/** send and sample the panel until the turn settles */
async function ask(page, text) {
  const composer = page.locator('.ai-input-box textarea').first()
  await composer.fill(text)
  for (let i = 0; i < 20; i++) {
    await composer.press('Enter')
    if ((await page.locator('.ai-msg-user, .hwp-ai__msg--user').count()) > 0) break
    await new Promise((r) => setTimeout(r, 1500))
  }
  const started = Date.now()
  const samples = []
  let quietSince = Date.now()
  let last = ''
  while (Date.now() - started < 360_000) {
    const sample = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.thinking-box__body')]
      const thinking = boxes.map((b) => b.textContent ?? '').join('')
      const answers = [...document.querySelectorAll('.ai-msg-assistant, .hwp-ai__msg--assistant')]
      const answer =
        answers.map((a) => (a.textContent ?? '').length).reduce((a, b) => a + b, 0) -
        thinking.length
      return {
        thinking: thinking.length,
        answer,
        live: document.querySelectorAll('.thinking-box--live').length,
        toggles: document.querySelectorAll('.thinking-box__toggle').length,
      }
    })
    samples.push({ ms: Date.now() - started, ...sample })
    const key = `${sample.thinking}/${sample.answer}`
    if (key !== last) {
      last = key
      quietSince = Date.now()
    }
    if (samples.length > 8 && sample.live === 0 && Date.now() - quietSince > 7_000) break
    await new Promise((r) => setTimeout(r, 250))
  }
  const distinct = (field) => new Set(samples.map((s) => s[field])).size
  const firstWith = (field) => samples.find((s) => s[field] > 0)?.ms ?? null
  const text_ = await page.evaluate(() =>
    (document.querySelector('.ai-chat, .hwp-ai__chat')?.textContent ?? '').slice(-400),
  )
  return {
    seconds: Math.round((Date.now() - started) / 1000),
    distinctThinkingLengths: distinct('thinking'),
    distinctAnswerLengths: distinct('answer'),
    firstThinkingMs: firstWith('thinking'),
    firstAnswerMs: firstWith('answer'),
    sawLiveBox: samples.some((s) => s.live > 0),
    collapsedToggles: samples.at(-1)?.toggles ?? 0,
    tail: text_,
  }
}

const result = {
  module: MODULE,
  route: ROUTE,
  seeded: null,
  turn1: null,
  turn2: null,
  expand: null,
  reopened: null,
  error: null,
}
let app = await launch()
try {
  const home = await app.firstWindow()
  await home.waitForLoadState('domcontentloaded')
  if (!doc) {
    await home
      .locator('.quick-card', { hasText: MODULE === 'docs' ? /\.docx$/ : /\.hwp$/ })
      .first()
      .click({ timeout: 30_000 })
  }
  const page = await findPanelPage(app)
  if (ROUTE === 'deepseek') {
    // the seed runs after app ready; wait until the settings report a connected DeepSeek
    const api = MODULE === 'hwp' ? 'hwpApi' : 'desktop'
    for (let i = 0; i < 60 && result.seeded !== true; i++) {
      result.seeded = await page
        .evaluate(async (name) => {
          const s = await window[name].getAiPublicSettings()
          return s.providers.some((p) => p.id === 'deepseek' && p.status === 'connected')
        }, api)
        .catch(() => false)
      if (!result.seeded) await new Promise((r) => setTimeout(r, 1000))
    }
    if (!result.seeded) throw new Error('DeepSeek is not connected — is the seed variable set?')
  }
  await pickModel(page, ROUTE)
  result.turn1 = await ask(
    page,
    MODULE === 'hwp'
      ? '이 문서에서 "사업"이라는 단어를 모두 "프로젝트"로 바꿔줘. 바꾼 뒤 한 문장으로 알려줘.'
      : '첫 문단에 "안녕하세요, 테스트입니다."라고 써줘. 끝나면 한 문장으로 알려줘.',
  )
  await page.screenshot({ path: join(OUT, `${MODULE}-${ROUTE}-1.png`) })
  const toggle = page.locator('.thinking-box__toggle').first()
  if (await toggle.count()) {
    await toggle.click()
    result.expand = { opened: (await page.locator('.thinking-box__body--full').count()) > 0 }
    await page.screenshot({ path: join(OUT, `${MODULE}-${ROUTE}-expanded.png`) })
  }
  result.turn2 = await ask(
    page,
    MODULE === 'hwp'
      ? '방금 바꾼 단어를 다시 "사업"으로 되돌려줘. 한 문장으로 알려줘.'
      : '방금 쓴 문장을 "반갑습니다."로 바꿔줘. 한 문장으로 알려줘.',
  )
  await page.screenshot({ path: join(OUT, `${MODULE}-${ROUTE}-2.png`) })
} catch (err) {
  result.error = err instanceof Error ? err.message : String(err)
} finally {
  await app
    .evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    .catch(() => {})
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 20_000))])
  try {
    app.process().kill()
  } catch {
    /* gone */
  }
}

if (REOPEN && MODULE === 'hwp' && !result.error) {
  app = await launch()
  try {
    const home = await app.firstWindow()
    await home.waitForLoadState('domcontentloaded')
    const page = await findPanelPage(app)
    await page.locator('.hwp-ai__msg--assistant').first().waitFor({ timeout: 30_000 })
    result.reopened = { restoredToggles: await page.locator('.thinking-box__toggle').count() }
    await pickModel(page, ROUTE)
    result.reopened.followUp = await ask(page, '문서에 문단이 몇 개인지 한 문장으로 알려줘.')
    await page.screenshot({ path: join(OUT, `${MODULE}-${ROUTE}-reopened.png`) })
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  } finally {
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 20_000))])
    try {
      app.process().kill()
    } catch {
      /* gone */
    }
  }
}

console.log('RESULT:', JSON.stringify(result, null, 2))
const noError = (turn) => turn && !/HTTP 4\d\d|error/i.test(turn.tail ?? '')
process.exit(!result.error && noError(result.turn1) && noError(result.turn2) ? 0 : 1)
```

Run: `node --check scripts/drivers/driver.ai-thinking.mjs`
Expected: 구문 오류 없음.

- [ ] **Step 3: DeepSeek — 한글 (개발 셸)**

Run: `node scripts/drivers/driver.ai-thinking.mjs --module=hwp --route=deepseek --reopen`
Expected: 종료 코드 0, 그리고 결과에서

- `seeded: true`
- `turn1`과 `turn2`: `sawLiveBox: true`, `distinctThinkingLengths >= 3`, `distinctAnswerLengths >= 3` (실시간으로 자랐다), `firstThinkingMs`가 `firstAnswerMs`보다 작음, `collapsedToggles >= 1` (끝난 뒤 접힘), `tail`에 "HTTP 400" 없음
- `expand.opened: true`
- `reopened.restoredToggles >= 1` (다시 연 대화에 접힌 상자가 복원됨), `reopened.followUp` 오류 없음

스크린샷 `scripts/drivers/out/thinking/hwp-deepseek-*.png`를 열어 눈으로 확인한다 (생각 중 상자, 접힌 줄, 펼친 모습).
쉬운 요청이라 DeepSeek이 생각을 거의 하지 않으면 `distinctThinkingLengths`가 작을 수 있다. 그럴 때는 요청을 "문서의 표에서 항목별 금액 합계를 계산해 둘째 문단 뒤에 한 문장으로 써줘"처럼 추론이 필요한 것으로 바꿔 다시 돌리고, 원장에 그 사실을 적는다.

- [ ] **Step 4: DeepSeek — 워드 (개발 셸)**

Run: `node scripts/drivers/driver.ai-thinking.mjs --module=docs --route=deepseek`
Expected: 종료 코드 0, `seeded: true`, 두 차례 모두 `sawLiveBox`/`collapsedToggles` 기대는 Step 3과 같다. 도구를 여러 번 이어 쓴 차례에서 "HTTP 400"이 없다.
드라이버가 워드의 창이나 선택자를 찾지 못하면, 그 모듈 창의 DOM(`.ai-input-box textarea`, `.ai-msg-assistant`)에 맞게 드라이버를 고치고 원장에 적는다. 제품 코드는 고치지 않는다.

- [ ] **Step 5: Codex — 생각 요약**

Run: `node scripts/drivers/driver.ai-thinking.mjs --module=hwp --route=codex`
Expected: 종료 코드 0, `turn1.sawLiveBox`가 `true` (Codex의 생각 요약이 같은 상자에 보임).

**5b. `sawLiveBox`가 `false`이면** (Codex가 요약을 보내지 않음): Codex의 `turn/start`에 `summary` 설정이 필요한지 본다. `packages/ai-provider/src/codex-app-server.ts`의 `turn/start` 요청에서 `summary` 칸이 없으면, 요청 매개변수를 만드는 함수를 분리해(`export function codexTurnStartParams(threadId: string, input: unknown[], outputSchema: unknown)`) `summary: 'auto'`를 넣는다. 먼저 `packages/ai-provider/tests/codex-app-server.test.ts`에 그 함수가 `summary: 'auto'`와 기존 `threadId`/`input`/`outputSchema`를 돌려주는 실패 테스트를 쓰고(RED), 구현하고(GREEN), `streamCodexAppServer`가 그 함수를 쓰게 한 뒤 Step 5를 다시 실행한다. 그래도 요약이 오지 않으면 원장에 "Codex 0.159.3은 이 설정에서 요약을 보내지 않음"을 적고 성공 기준 4를 "해당 없음(서버가 보내지 않음)"으로 사용자에게 알린다.

- [ ] **Step 6: 키가 어디에도 남지 않았는지 확인한다**

Run: `git grep -n "sk-" -- . ':!*.lock' ':!package-lock.json' | head`
Expected: 이 브랜치가 추가한 줄에 실제 키 모양 문자열이 없음 (테스트의 `sk-seed-test-…` 가짜 값만).
확인 방법: 키 앞 6글자를 직접 쓰지 말고, 환경 변수 길이(35)와 같은 길이의 `sk-` 문자열이 파일에 있는지 `git grep -nE "sk-[A-Za-z0-9]{32}" -- . ':!package-lock.json'`로 본다.
Expected: 일치 없음.
`scripts/drivers/out/thinking/*.png`와 드라이버 출력에 키가 없음을 눈으로 확인한다 (드라이버는 키를 읽지 않는다).

- [ ] **Step 7: 문서**

`README.md`: AI 기능을 설명하는 목록에서 Codex를 언급하는 줄 근처(`grep -n "Codex" README.md`로 찾는다)에 항목을 추가한다.

```markdown
- The AI panels show what the model is thinking in a collapsible "Thinking" box — live while it thinks, one line afterwards. Codex shows its reasoning summaries; DeepSeek (`deepseek-flash`, `deepseek-v4-pro`) shows its reasoning and gets it back on the next request, so tool-heavy edits keep their chain of thought.
```

`MODIFICATIONS.md` 끝에 절을 추가한다.

```markdown
## AI thinking display and DeepSeek V4

- **Thinking box.** `@genoffice/ui` gains `ThinkingBox`; all five AI panels show the model's thinking live and collapse it when the answer starts. The thinking is saved with the assistant message (`reasoning` and `thinking`, each capped at 32,000 characters) and restored when a document reopens.
- **Two kinds of thinking.** Raw reasoning (DeepSeek `reasoning_content`) is sent back to DeepSeek on later requests; reasoning summaries (Codex) are display-only.
- **DeepSeek.** The model list is `deepseek-flash` and `deepseek-v4-pro` (the retired `deepseek-chat` / `deepseek-reasoner` names in stored routes are read as `deepseek-flash`). Requests run in thinking mode without `temperature`; one retry with thinking disabled covers a server that rejects missing `reasoning_content`.
- **Test builds.** `GENOFFICE_SEED_DEEPSEEK_API_KEY` pre-loads a DeepSeek key through the normal verify-and-encrypt path when the profile has none.
```

스펙의 `- 상태: 설계 승인, 구현 전`을 `- 상태: 구현 완료 (날짜) — 계획 docs/superpowers/plans/2026-10-02-ai-thinking-stream.md`로 바꾼다.

이 계획 맨 아래에 수용 로그를 만든다 (아래 형식으로, 실제 결과로 채운다).

```markdown
## 수용 로그

| 항목                                                               | 결과 | 비고                                                                  |
| ------------------------------------------------------------------ | ---- | --------------------------------------------------------------------- |
| 한글 · DeepSeek (실시간 상자, 접힘, 펼침, 두 번째 요청, 다시 열기) |      |                                                                       |
| 워드 · DeepSeek                                                    |      |                                                                       |
| 한글 · Codex 생각 요약                                             |      |                                                                       |
| 설치본(exe) 한글 · DeepSeek                                        |      |                                                                       |
| 게이트: lint · typecheck · format · 전체 테스트                    |      |                                                                       |
| 미검증                                                             | —    | 파워포인트·엑셀·PDF 패널은 자동 테스트와 타입 검사까지만 (R7). macOS. |
```

Run: `npx prettier --write README.md MODIFICATIONS.md docs/superpowers/specs/2026-10-02-ai-thinking-stream-design.md docs/superpowers/plans/2026-10-02-ai-thinking-stream.md`
Expected: 파일 갱신, 오류 없음.

- [ ] **Step 8: 설치본 확인**

Run: `npm run dist:win`
Expected: `apps/shell/release/OpenGenOfficeSetup-v0.4.0-x64.exe`가 새 시각으로 만들어짐.
Run: `node scripts/drivers/driver.ai-thinking.mjs --module=hwp --route=deepseek "D:/genoffice/apps/shell/release/win-unpacked/Open GenOffice.exe"`
Expected: 종료 코드 0, Step 3과 같은 기대. (설치본은 `%APPDATA%\Open GenOffice\` 프로필을 쓰므로, 키가 없으면 시드가 저장하고 있으면 건드리지 않는다.)

- [ ] **Step 9: 수용 로그를 채우고 커밋**

수용 로그의 빈 칸을 실제 결과(통과/실패, 숫자)로 채운다. 그다음:

```bash
git add README.md MODIFICATIONS.md docs/superpowers/specs/2026-10-02-ai-thinking-stream-design.md docs/superpowers/plans/2026-10-02-ai-thinking-stream.md
```

그다음 별도 명령으로:

```bash
git commit -m "docs: thinking display and DeepSeek V4 — notes and acceptance log" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Step 5b나 드라이버 보정으로 제품 코드를 고쳤다면, 그 수정은 자기 테스트와 함께 이 커밋 앞에 별도 커밋으로 들어가 있어야 한다.

## 사용자 눈 확인 목록 (R7: 자동 확인이 닿지 않는 곳)

실행자는 마지막 보고에 이 목록을 그대로 싣는다.

1. **파워포인트·엑셀·PDF:** 새 문서를 열고 AI 패널에서 모델을 `deepseek-flash`로 골라 "표를 하나 만들어 줘"처럼 도구를 쓰는 요청을 한다. 생각 과정 상자가 생겼다가 답변이 시작되면 한 줄로 접히는지, 접힌 줄을 누르면 펼쳐지는지 본다.
2. **Codex 기본 모델:** 같은 요청을 Codex로 한다. 생각 요약이 보이면 같은 상자에 나온다 (서버가 보내지 않으면 "생각 중" 표시만 보인다).
3. **다시 열기:** 파일을 저장하고 앱을 닫았다 다시 열어, 이전 AI 답변 위에 접힌 "생각 과정 보기" 줄이 있고 이어서 요청해도 오류가 없는지 본다.
4. **키 정리:** 테스트가 끝나면 Windows 사용자 환경 변수 `GENOFFICE_SEED_DEEPSEEK_API_KEY`를 지우고(`[Environment]::SetEnvironmentVariable('GENOFFICE_SEED_DEEPSEEK_API_KEY', $null, 'User')`), 저장된 키는 설정 › AI에서 DeepSeek 키를 지운다.
