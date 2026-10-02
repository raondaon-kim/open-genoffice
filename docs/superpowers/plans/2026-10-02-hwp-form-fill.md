# 양식으로 새 문서 (한글 양식 채우기) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 가진 hwp/hwpx 양식으로 "새 문서"를 만들어(원본은 바뀌지 않음) AI가 칸과 본문을 채우게 한다.

**Architecture:**

- **열기:** 셸이 양식 파일을 읽어 바이트만 한글 탭에 넘기는 새 열기 방식(`form`)을 만든다. 탭은 원본 경로를 모르므로 저장하면 항상 "다른 이름으로 저장"이다.
- **AI 쪽 변경 네 가지**
  - 양식 지도 도구(`form_map`)와 그 재료인 `paragraphs` 쿼리(엔진 `dump` 파싱)
  - 저장 왕복 검사 실패의 허용 판정 (`explain` 요약 비교)
  - 표 삭제 연산
  - 차례 한도와 끝맺음 안내

**Tech Stack:** TypeScript, React 19, Electron IPC, vitest, rhwp CLI 0.8.6(동봉), 기존 패키지(`@genoffice/agent-core`, `@genoffice/ui`).

**Spec:** `docs/superpowers/specs/2026-10-02-hwp-form-fill-design.md`

## Global Constraints

- 원본 양식 파일은 어떤 경로로도 저장 대상이 되지 않는다. `form` 열기 방식은 경로를 담지 않는다.
- 양식 크기 상한은 50 MB(`50 * 1024 * 1024`)다. 확장자는 `.hwp`·`.hwpx`만 받는다.
- **웹에서 받은 양식(서울시·프리폼)은 저장소·설치본·테스트 픽스처에 넣지 않는다.** 실제 확인용 파일은 `D:\tmp\forms`에만 있다.
- 저장 왕복 검사(`--verify`) 실패의 허용은 §4.3 규칙만 따른다. 판정에 필요한 `explain`이 실패하면 허용하지 않는다.
- `form_map`과 `paragraphs`의 문서 유래 글은 기존 `⟦문서 내용:nonce⟧` 울타리(`wrapText`)로 감싼다.
- 한글 패널 `maxTurns`는 20이다.
- 기본 저장 이름은 `${양식 이름}_작성${원래 확장자}`이고 파일 이름만 허용한다 (경로 구분자 금지).
- 테스트는 먼저 실패하는 것을 쓴다 (RED → GREEN). 린트·타입 검사가 모든 커밋의 관문이다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 넣는다. `git commit`은 다른 명령과 묶지 않고 단독으로 실행하며, 본문은 `-m`을 여러 번 써서 나눈다.
- `prettier --write`는 그 작업에서 바꾼 파일에만 쓴다 (폴더 단위로 쓰면 무관한 파일이 바뀐다).
- 실제 Codex 계정으로 `account/logout`이나 API 키 로그인을 호출하지 않는다. `~/.codex/auth.json`을 읽지 않는다. DeepSeek 키 값은 출력하지 않는다.
- 설치는 `D:\Programs\Open GenOffice`(`/S /D=`)로 한다.

## Review Focus

1. **양식 탭에서 저장한 뒤 다시 저장:** 첫 저장은 "다른 이름으로 저장"이고, 이후 저장은 고른 경로에 덮어써야 한다. 원본에는 끝까지 쓰지 않는다. → 작업 3에서 `formCopyNames`와 `safeDefaultSaveName` 테스트로 고정하고, 경로 흐름은 실제 확인(작업 9)에서 원본 SHA-256 비교로 확인.
2. **이름에 경로 문자가 섞인 양식** (`..\\x.hwp`, `a/b.hwpx`) → 기본 저장 이름이 파일 이름만 남아야 한다. → 작업 3 `safeDefaultSaveName` 테스트.
3. **검증 실패 허용이 실제 손상을 통과시킴:** 누름틀이 사라지거나 엉뚱한 표 크기가 바뀐 결과는 거부해야 한다. → 작업 4 판정 테스트(누름틀 이름 변화, 행 추가가 없는데 표 크기 변화, 문단 수 변화, explain 실패).
4. **표가 수십 개이고 문단이 수백 개인 양식:** `form_map` 출력이 상한을 넘지 않고 다음 부분을 받을 방법을 알려야 한다. → 작업 7 상한 테스트.
5. **일부 쿼리 실패** (예: `dump` 파싱 실패): `form_map`이 나머지를 돌려주고 빠진 부분을 표시해야 한다. → 작업 7 `unavailable` 테스트.

## 사전 점검 (Pre-flight)

| 생산 → 소비 | 넘기는 것                                                                                           | 확인                                        |
| ----------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1 → 2       | `queueHwpForm(webContentsId, { fileName, data })` (hwp-main)                                        | 작업 2의 탭 관리자가 호출. 이름과 형태 일치 |
| 1 → 3       | `HwpOpenIntent`의 `{ mode: 'form'; fileName; data }`                                                | 작업 3의 App이 소비                         |
| 3 내부      | `formCopyNames`, `safeDefaultSaveName` (`apps/hwp/src/shared/form-names.ts`)                        | 렌더러와 메인이 같은 함수를 쓴다            |
| 4 → 5       | `AiEditResult.layoutTolerant`, `EditJournalEntry.verify`                                            | 작업 5의 `summarizeEdit`이 읽는다           |
| 6 → 7       | 쿼리 `paragraphs` → 봉투 `{ paragraphs: [{section, paragraph, preview, length, empty, hasTable}] }` | 작업 7의 `form_map`이 소비                  |

## 미리 내린 결정 (Ruling)

- **R1.** 메뉴 항목은 넣지 않는다 (스펙 §4.1 갱신). 셸의 새 문서 메뉴에는 한글 항목 자체가 없다.
- **R2.** `form_map` 입력은 스펙의 `page` 대신 `paragraphsFrom`(문단 번호부터)이다. `dump`가 쪽 번호를 주지 않는다. 비용: 쪽 단위로 나눠 읽을 수 없다.
- **R3.** 양식 탭의 안내와 탭 아래 이름은 한글 앱의 기존 문구처럼 영어이다 (`New document from a form — the original file stays unchanged`, `<양식> (new)`). 셸 탭 제목은 셸 문자열로 현지화한다.
- **R4.** 끝맺음 안내(턴 한도·빈 응답)는 대화 기록에 저장하지 않는다. 모델 글이 있을 때만 저장한다. 비용: 다시 연 대화에 안내가 보이지 않는다.
- **R5.** 실제 확인용 결재문서본문은 저장소에 넣지 못하므로, 검증 실패 경로의 실바이너리 확인은 작업 9의 실제 확인으로 대신한다 (스펙 §4.3-7).
- **R6.** 양식 파일 오류(크기 초과, 확장자, 읽기 실패) 대화상자 문구는 셸 다른 대화상자처럼 영어 한 줄이다.

## 파일 구조

| 파일                                                                                                                                                                                                                                                                                                               | 책임                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `apps/hwp/src/main/hwp-intents.ts` (신규)                                                                                                                                                                                                                                                                          | 탭별 열기 방식 보관 (경로·빈 문서·양식) |
| `apps/shell/src/main/hwp-form-open.ts` (신규)                                                                                                                                                                                                                                                                      | 양식 파일 검사·읽기                     |
| `apps/hwp/src/shared/form-names.ts` (신규)                                                                                                                                                                                                                                                                         | 양식 탭 이름·기본 저장 이름             |
| `apps/hwp/src/main/layout-tolerance.ts` (신규)                                                                                                                                                                                                                                                                     | 저장 왕복 검사 실패 허용 판정           |
| `apps/hwp/src/main/rhwp-paragraphs.ts` (신규)                                                                                                                                                                                                                                                                      | `dump` 텍스트 → 문단 목록               |
| `apps/hwp/src/renderer/ai/run-notice.ts` (신규)                                                                                                                                                                                                                                                                    | 실행 끝 안내 문구                       |
| 기존: `hwp-main.ts`, `ai-edit-chain.ts`, `rhwp-edit-ops.ts`, `rhwp-queries.ts`, `rhwp-cli.ts`, `ai-contract.ts`, `ipc.ts`, `preload/index.ts`, `App.tsx`, `tools/read.ts`, `tools/edit.ts`, `hwp-skill.ts`, `AiPanel.tsx`, 셸 `index.ts`·`tab-manager.ts`·`preload/index.ts`·`home-api.ts`·`strings.ts`·`Home.tsx` | 연결                                    |

---

### Task 1: 한글 모듈의 열기 방식 보관소와 `form` 방식

**Files:**

- Create: `apps/hwp/src/main/hwp-intents.ts`, `apps/hwp/tests/hwp-intents.test.ts`
- Modify: `apps/hwp/src/shared/ipc.ts` (`HwpOpenIntent`), `apps/hwp/src/main/hwp-main.ts`

**Interfaces:**

- Produces:
  - `HwpOpenIntent = { mode: 'open'; path: string } | { mode: 'blank' } | { mode: 'form'; fileName: string; data: ArrayBuffer }`
  - `class HwpIntentStore { queuePath(id, path); markBlank(id); queueForm(id, form); consume(id): HwpOpenIntent | null; forget(id) }`
  - `queueHwpForm(webContentsId: number, form: { fileName: string; data: ArrayBuffer }): void` (hwp-main에서 내보냄)

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `apps/hwp/tests/hwp-intents.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { HwpIntentStore } from '../src/main/hwp-intents'

const bytes = (...values: number[]) => new Uint8Array(values).buffer

describe('HwpIntentStore', () => {
  it('hands out a queued path once', () => {
    const store = new HwpIntentStore()
    store.queuePath(1, 'C:/docs/a.hwpx')
    expect(store.consume(1)).toEqual({ mode: 'open', path: 'C:/docs/a.hwpx' })
    expect(store.consume(1)).toBeNull()
  })

  it('hands out a blank document once', () => {
    const store = new HwpIntentStore()
    store.markBlank(2)
    expect(store.consume(2)).toEqual({ mode: 'blank' })
    expect(store.consume(2)).toBeNull()
  })

  it('hands out a form copy with its bytes and name but never a path', () => {
    const store = new HwpIntentStore()
    store.queueForm(3, { fileName: '결재문서본문.hwpx', data: bytes(1, 2, 3) })
    const intent = store.consume(3)
    expect(intent).toMatchObject({ mode: 'form', fileName: '결재문서본문.hwpx' })
    expect(intent).not.toHaveProperty('path')
    expect(Array.from(new Uint8Array((intent as { data: ArrayBuffer }).data))).toEqual([1, 2, 3])
    expect(store.consume(3)).toBeNull()
  })

  it('a form wins over anything else queued for the same view, and forget clears all', () => {
    const store = new HwpIntentStore()
    store.markBlank(4)
    store.queueForm(4, { fileName: 'f.hwp', data: bytes(9) })
    expect(store.consume(4)).toMatchObject({ mode: 'form' })
    store.queuePath(5, 'C:/x.hwp')
    store.markBlank(5)
    store.queueForm(5, { fileName: 'g.hwp', data: bytes(1) })
    store.forget(5)
    expect(store.consume(5)).toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/hwp-intents.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/hwp-intents"`.

- [ ] **Step 3: 구현한다**

`apps/hwp/src/main/hwp-intents.ts`:

```ts
import type { HwpOpenIntent } from '../shared/ipc'

export interface HwpFormIntent {
  /** the form's file name (no directory) — the tab never learns the form's path */
  fileName: string
  data: ArrayBuffer
}

/**
 * What each hwp view should open, queued at tab creation and consumed once by
 * the renderer after mount (avoids did-finish-load races). A form copy wins
 * over a blank flag or a path queued for the same view.
 */
export class HwpIntentStore {
  private readonly paths = new Map<number, string>()
  private readonly blanks = new Set<number>()
  private readonly forms = new Map<number, HwpFormIntent>()

  queuePath(id: number, path: string): void {
    this.paths.set(id, path)
  }

  markBlank(id: number): void {
    this.blanks.add(id)
  }

  queueForm(id: number, form: HwpFormIntent): void {
    this.forms.set(id, { fileName: form.fileName, data: form.data })
  }

  consume(id: number): HwpOpenIntent | null {
    const form = this.forms.get(id)
    const blank = this.blanks.has(id)
    const path = this.paths.get(id)
    this.forget(id)
    if (form) return { mode: 'form', fileName: form.fileName, data: form.data }
    if (blank) return { mode: 'blank' }
    return path ? { mode: 'open', path } : null
  }

  forget(id: number): void {
    this.paths.delete(id)
    this.blanks.delete(id)
    this.forms.delete(id)
  }
}
```

`apps/hwp/src/shared/ipc.ts`의 `HwpOpenIntent`를 바꾼다:

```ts
export type HwpOpenIntent =
  | { mode: 'open'; path: string }
  | { mode: 'blank' }
  /** a copy of a form file: bytes and name only — the tab cannot save over the form */
  | { mode: 'form'; fileName: string; data: ArrayBuffer }
```

`apps/hwp/src/main/hwp-main.ts`:

1. import 목록 끝에 `import { HwpIntentStore } from './hwp-intents'`를 추가한다.
2. 두 선언(`const pendingByWc = new Map<number, string>()`와 그 위 주석, `const blankByWc = new Set<number>()`와 그 위 주석)을 다음 한 줄과 주석으로 바꾼다.

```ts
/** What each view should open; the renderer consumes it after mount (avoids did-finish-load races) */
const intents = new HwpIntentStore()
```

3. `markHwpNewBlank`의 본문을 `intents.markBlank(webContentsId)`로 바꾸고, 그 아래에 추가한다.

```ts
/** Open a COPY of a form in this view: bytes and name only, no path is granted. */
export function queueHwpForm(
  webContentsId: number,
  form: { fileName: string; data: ArrayBuffer },
): void {
  intents.queueForm(webContentsId, form)
}
```

4. `consumePending` 핸들러 본문을 `return intents.consume(e.sender.id)`로 바꾼다.
5. `grantAndTrack`의 `pendingByWc.set(wcId, openPath)`를 `intents.queuePath(wcId, openPath)`로 바꾼다. `destroyed` 처리의 `pendingByWc.delete(wcId)`와 `blankByWc.delete(wcId)` 두 줄을 `intents.forget(wcId)`로 바꾼다.

- [ ] **Step 4: 통과와 전체 확인**

Run: `npm run test -w @genoffice/hwp -- tests/hwp-intents.test.ts`
Expected: PASS (4 tests).
Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 0건 (`App.tsx`는 `open`이 아니면 빈 문서로 가므로 `form` 추가로 타입 오류가 나지 않는다. `form` 처리는 작업 3).
Run: `npm run test -w @genoffice/hwp`
Expected: PASS 전체.

- [ ] **Step 5: 커밋**

```bash
npx prettier --write apps/hwp/src/main/hwp-intents.ts apps/hwp/tests/hwp-intents.test.ts apps/hwp/src/shared/ipc.ts apps/hwp/src/main/hwp-main.ts
npx eslint apps/hwp/src/main/hwp-intents.ts apps/hwp/tests/hwp-intents.test.ts apps/hwp/src/shared/ipc.ts apps/hwp/src/main/hwp-main.ts
git add apps/hwp/src/main/hwp-intents.ts apps/hwp/tests/hwp-intents.test.ts apps/hwp/src/shared/ipc.ts apps/hwp/src/main/hwp-main.ts
```

그다음 단독으로:

```bash
git commit -m "feat(hwp): a 'form' open intent that hands a tab a copy of a form" -m "HwpIntentStore keeps what each view should open (path, blank, form copy). A form copy carries bytes and a file name only, so the tab can never save over the form." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 홈 "양식으로 새 문서" 카드와 양식 탭 열기

**Files:**

- Create: `apps/shell/src/main/hwp-form-open.ts`, `apps/shell/tests/hwp-form-open.test.ts`
- Modify: `apps/shell/src/main/tab-manager.ts`, `apps/shell/tests/tab-manager.test.ts`, `apps/shell/src/main/index.ts`, `apps/shell/src/preload/index.ts`, `apps/shell/src/shared/home-api.ts`, `apps/shell/src/renderer/src/strings.ts`, `apps/shell/src/renderer/src/Home.tsx`

**Interfaces:**

- Consumes: `queueHwpForm` (작업 1)
- Produces: `loadFormFile(path, deps)`, `TabManager.openHwpFormTab(form, title)`, `HOME_CHANNELS.newHwpFromForm = 'home:new-hwp-from-form'`, `aiOffice.newHwpFromForm(opts?)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/shell/tests/hwp-form-open.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { loadFormFile, MAX_FORM_BYTES } from '../src/main/hwp-form-open'

const deps = (size: number, bytes = Buffer.from([1, 2, 3])) => ({
  stat: vi.fn(async () => ({ size })),
  readFile: vi.fn(async () => bytes),
})

describe('loadFormFile', () => {
  it('reads an .hwp/.hwpx form into a name and bytes', async () => {
    const d = deps(3)
    const form = await loadFormFile('D:\\양식\\결재문서본문.hwpx', d)
    expect(form).toMatchObject({ ok: true, fileName: '결재문서본문.hwpx' })
    expect(Array.from(new Uint8Array((form as { data: ArrayBuffer }).data))).toEqual([1, 2, 3])
    expect((await loadFormFile('/forms/품의서.HWP', deps(3))).ok).toBe(true)
  })

  it('refuses other extensions without reading', async () => {
    const d = deps(3)
    expect(await loadFormFile('C:/x/report.docx', d)).toMatchObject({ ok: false })
    expect(d.readFile).not.toHaveBeenCalled()
  })

  it('refuses a form over 50 MB without reading', async () => {
    const d = deps(MAX_FORM_BYTES + 1)
    const form = await loadFormFile('C:/x/big.hwpx', d)
    expect(form).toMatchObject({ ok: false })
    expect((form as { error: string }).error).toMatch(/50 MB/)
    expect(d.readFile).not.toHaveBeenCalled()
  })

  it('reports a file that cannot be read', async () => {
    const form = await loadFormFile('C:/x/gone.hwp', {
      stat: async () => {
        throw new Error('ENOENT')
      },
      readFile: async () => Buffer.alloc(0),
    })
    expect(form).toMatchObject({ ok: false })
  })
})
```

`apps/shell/tests/tab-manager.test.ts`에서 `vi.mock('../../slides/src/main/slides-main', …)` 블록 바로 뒤에 추가:

```ts
const createHwpView = vi.fn(() => makeFakeView())
const queueHwpForm = vi.fn()
const markHwpNewBlank = vi.fn()

vi.mock('../../hwp/src/main/hwp-main', () => ({
  createHwpView: (...args: unknown[]) => createHwpView(...(args as [])),
  hwpIsDirty: () => false,
  markHwpNewBlank: (...args: unknown[]) => markHwpNewBlank(...args),
  queueHwpForm: (...args: unknown[]) => queueHwpForm(...args),
  requestHwpClose: () => Promise.resolve(true),
}))
```

같은 파일 끝에 추가:

```ts
describe('openHwpFormTab', () => {
  it('opens an untitled hwp tab that receives a copy of the form, never its path', () => {
    const data = new Uint8Array([7]).buffer
    manager.openHwpFormTab({ fileName: '품의서.hwp', data }, '품의서 (새 문서)')
    const view = lastCreatedView(createHwpView)
    expect(createHwpView).toHaveBeenCalledWith()
    expect(queueHwpForm).toHaveBeenCalledWith(view.webContents.id, { fileName: '품의서.hwp', data })
    expect(markHwpNewBlank).not.toHaveBeenCalled()
    expect(manager.list().at(-1)).toMatchObject({
      kind: 'hwp',
      title: '품의서 (새 문서)',
      active: true,
    })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/shell -- tests/hwp-form-open.test.ts tests/tab-manager.test.ts`
Expected: FAIL — `hwp-form-open` 모듈 없음, `openHwpFormTab is not a function`.

- [ ] **Step 3: 구현한다 — 파일 검사와 탭**

`apps/shell/src/main/hwp-form-open.ts`:

```ts
import { basename } from 'node:path'

export const MAX_FORM_BYTES = 50 * 1024 * 1024

export interface FormFileDeps {
  stat(path: string): Promise<{ size: number }>
  readFile(path: string): Promise<Buffer>
}

export type FormFileResult =
  { ok: true; fileName: string; data: ArrayBuffer } | { ok: false; error: string }

/** read a user's form file for "New document from a form" (the tab gets the bytes, not the path) */
export async function loadFormFile(path: string, deps: FormFileDeps): Promise<FormFileResult> {
  const fileName = basename(path.replace(/\\/g, '/'))
  if (!/\.(hwp|hwpx)$/i.test(fileName)) {
    return { ok: false, error: 'Choose a Hangul form (.hwp or .hwpx).' }
  }
  try {
    const { size } = await deps.stat(path)
    if (size > MAX_FORM_BYTES) {
      return { ok: false, error: 'This form is larger than 50 MB and cannot be opened.' }
    }
    const buf = await deps.readFile(path)
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    return { ok: true, fileName, data }
  } catch {
    return { ok: false, error: 'The form could not be read.' }
  }
}
```

`apps/shell/src/main/tab-manager.ts`:

- hwp-main import 목록에 `queueHwpForm,`를 `markHwpNewBlank,` 다음 줄에 추가한다.
- `openHwpTab` 메서드 바로 아래에 추가:

```ts
  /** "New document from a form": an untitled hwp tab that opens a COPY of the form */
  openHwpFormTab(form: { fileName: string; data: ArrayBuffer }, title: string): string {
    const view = createHwpView()
    queueHwpForm(view.webContents.id, { fileName: form.fileName, data: form.data })
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.tabs.push({ id, kind: 'hwp', view, title })
    this.activateTab(id)
    return id
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test -w @genoffice/shell -- tests/hwp-form-open.test.ts tests/tab-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: 구현한다 — 채널, preload, 문자열, 홈 카드, 메인 핸들러**

`apps/shell/src/shared/home-api.ts`:

- `HOME_CHANNELS`의 `newHwp: 'home:new-hwp',` 아래에 `newHwpFromForm: 'home:new-hwp-from-form',`를 추가한다.
- API 인터페이스의 `newHwp(opts?: { projectId?: string }): Promise<void>` 아래에 추가:

```ts
  /** pick a Hangul form file and open a copy of it as a new, untitled document */
  newHwpFromForm(opts?: { projectId?: string }): Promise<void>
```

`apps/shell/src/preload/index.ts`의 `async newHwp(opts) { … }` 블록 아래에 추가:

```ts
  async newHwpFromForm(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newHwpFromForm, opts)
  },
```

문자열은 19개 언어 사전에 모두 들어가야 한다 (`defineStrings`가 키 집합을 강제한다). 이 스크립트를 `D:\tmp\claude\…\scratchpad\t2-strings.cjs`처럼 저장소 밖에 저장하고 저장소 루트에서 실행한다 (Write 도구로 쓴다 — 셸 heredoc은 역슬래시를 망가뜨린다):

```js
const fs = require('fs')
const LABELS = {
  ko: ['양식으로 새 한글 문서', '양식 파일 (.hwp/.hwpx)', '{name} (새 문서)'],
  en: ['HWP from a form', 'Form file (.hwp/.hwpx)', '{name} (new)'],
  ja: ['フォームから HWP', 'フォームファイル (.hwp/.hwpx)', '{name}（新規）'],
  zh: ['从表单新建 HWP', '表单文件 (.hwp/.hwpx)', '{name}（新建）'],
  'zh-TW': ['從表單新建 HWP', '表單檔案 (.hwp/.hwpx)', '{name}（新建）'],
}
const label = (lang) => LABELS[lang] ?? LABELS.en
const q = (s) => `'${s.replace(/'/g, "\\'")}'`
function addAfter(path, anchorKey, make) {
  const lines = fs.readFileSync(path, 'utf8').split('\n')
  let lang = null
  let added = 0
  const out = []
  for (const line of lines) {
    const block = /^ {2}(?:'([\w-]+)'|([\w-]+)): \{$/.exec(line)
    if (block) lang = block[1] ?? block[2]
    out.push(line)
    if (lang && new RegExp(`^ {4}${anchorKey}: `).test(line)) {
      out.push(...make(label(lang)))
      added++
    }
  }
  if (added !== 19) throw new Error(`${path}: expected 19 languages, patched ${added}`)
  fs.writeFileSync(path, out.join('\n'))
}
addAfter('apps/shell/src/renderer/src/strings.ts', 'newHwp', ([title, sub]) => [
  `    newHwpFromForm: ${q(title)},`,
  `    newHwpFromFormSub: ${q(sub)},`,
])
addAfter('apps/shell/src/main/index.ts', 'untitledHwp', ([, , tab]) => [
  `    untitledFromForm: ${q(tab)},`,
])
console.log('ok')
```

Run: `node <스크립트 경로>`
Expected: `ok` (언어 19개씩 두 파일).

`apps/shell/src/renderer/src/Home.tsx`:

- `const handleNewHwp = () => { … }` 블록 아래에 추가:

```tsx
const handleNewHwpFromForm = () => {
  void window.aiOffice.newHwpFromForm(
    selectedProjectId ? { projectId: selectedProjectId } : undefined,
  )
}
```

- `NEW_ITEMS`를 바꾸고(항목마다 `id`), 카드의 `key`를 `item.id`로 바꾼다:

```tsx
const NEW_ITEMS = [
  { id: 'docx', ext: 'docx', title: t('newDoc'), sub: '.docx', action: handleNewDoc },
  { id: 'xlsx', ext: 'xlsx', title: t('newSheet'), sub: '.xlsx', action: handleNewSheet },
  { id: 'pptx', ext: 'pptx', title: t('newSlide'), sub: '.pptx', action: handleNewSlide },
  { id: 'hwp', ext: 'hwp', title: t('newHwp'), sub: '.hwp', action: handleNewHwp },
  {
    id: 'hwp-form',
    ext: 'hwp',
    title: t('newHwpFromForm'),
    sub: t('newHwpFromFormSub'),
    action: handleNewHwpFromForm,
  },
]
```

바꾸기 전 `<button key={item.ext} className="quick-card"` → 바꾼 뒤 `<button key={item.id} className="quick-card"`.

`apps/shell/src/main/index.ts`:

- 파일 위 import에 추가: `import { readFile, stat } from 'node:fs/promises'`, `import { loadFormFile } from './hwp-form-open'`
- `ipcMain.handle(HOME_CHANNELS.newHwp, …)` 블록 바로 아래에 추가:

```ts
ipcMain.handle(HOME_CHANNELS.newHwpFromForm, async (event, opts?: { projectId?: string }) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? shellWindow
  if (!win) return
  const picked = await dialog.showOpenDialog(win, {
    title: tm('dlgOpenTitle'),
    filters: [{ name: tm('filterHwp'), extensions: ['hwp', 'hwpx'] }],
    properties: ['openFile'],
  })
  if (picked.canceled || !picked.filePaths[0]) return
  const form = await loadFormFile(picked.filePaths[0], { stat, readFile })
  if (!form.ok) {
    await dialog.showMessageBox(win, { type: 'warning', message: form.error })
    return
  }
  if (opts?.projectId && opts.projectId !== 'default') {
    pendingNewFileProject.set('hwp', opts.projectId)
  }
  const name = form.fileName.replace(/\.(hwp|hwpx)$/i, '')
  tabManager?.openHwpFormTab(form, tm('untitledFromForm', { name }))
})
```

- [ ] **Step 6: 전체 확인**

Run: `npm run test -w @genoffice/shell`
Expected: PASS 전체 (strings 테스트 포함).
Run: `npm run typecheck -w @genoffice/shell`
Expected: 오류 0건.

- [ ] **Step 7: 커밋**

```bash
F="apps/shell/src/main/hwp-form-open.ts apps/shell/tests/hwp-form-open.test.ts apps/shell/src/main/tab-manager.ts apps/shell/tests/tab-manager.test.ts apps/shell/src/main/index.ts apps/shell/src/preload/index.ts apps/shell/src/shared/home-api.ts apps/shell/src/renderer/src/strings.ts apps/shell/src/renderer/src/Home.tsx"
npx prettier --write $F
npx eslint $F
git add $F
```

그다음 단독으로:

```bash
git commit -m "feat(shell): 'HWP from a form' card opens a copy of a form as a new document" -m "Home gets a card that picks an .hwp/.hwpx form (50 MB cap), reads it in main and opens an untitled hwp tab with the bytes only. The tab title is the form name marked as new." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 양식 탭 시작과 다른 이름으로 저장의 기본 이름

**Files:**

- Create: `apps/hwp/src/shared/form-names.ts`, `apps/hwp/tests/form-names.test.ts`
- Modify: `apps/hwp/src/renderer/App.tsx`, `apps/hwp/src/main/hwp-main.ts` (saveAs), `apps/hwp/src/shared/ipc.ts` (`saveAs`), `apps/hwp/src/preload/index.ts`

**Interfaces:**

- Consumes: `HwpOpenIntent` form 방식 (작업 1)
- Produces: `formCopyNames(fileName): { tabName: string; saveName: string }`, `safeDefaultSaveName(value: unknown): string`, `HwpApi.saveAs(defaultName?: string)`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `apps/hwp/tests/form-names.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { formCopyNames, safeDefaultSaveName } from '../src/shared/form-names'

describe('formCopyNames', () => {
  it('names the tab and the default save file after the form, keeping its extension', () => {
    expect(formCopyNames('결재문서본문.hwpx')).toEqual({
      tabName: '결재문서본문 (new)',
      saveName: '결재문서본문_작성.hwpx',
    })
    expect(formCopyNames('품의서.HWP')).toEqual({
      tabName: '품의서 (new)',
      saveName: '품의서_작성.HWP',
    })
  })

  it('keeps only the file name when the given name carries a path', () => {
    expect(formCopyNames('..\\..\\x.hwp').saveName).toBe('x_작성.hwp')
    expect(formCopyNames('a/b/c.hwpx').saveName).toBe('c_작성.hwpx')
  })
})

describe('safeDefaultSaveName', () => {
  it('accepts a plain .hwp/.hwpx file name', () => {
    expect(safeDefaultSaveName('품의서_작성.hwp')).toBe('품의서_작성.hwp')
  })

  it('falls back to untitled.hwp for anything else', () => {
    for (const bad of [
      undefined,
      5,
      '',
      'x.docx',
      '../x.hwp',
      'a\\b.hwp',
      'C:x.hwp',
      'a'.repeat(250) + '.hwp',
    ]) {
      expect(safeDefaultSaveName(bad)).toBe('untitled.hwp')
    }
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/form-names.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다**

`apps/hwp/src/shared/form-names.ts`:

```ts
const baseName = (name: string): string => name.split(/[\\/]/).pop() ?? name

/** names for a document started from a form: the tab label and the Save As default */
export function formCopyNames(fileName: string): { tabName: string; saveName: string } {
  const base = baseName(fileName)
  const match = /^(.*?)(\.(?:hwp|hwpx))$/i.exec(base)
  const stem = match ? match[1]! : base
  const ext = match ? match[2]! : '.hwp'
  return { tabName: `${stem} (new)`, saveName: `${stem}_작성${ext}` }
}

/** a renderer-supplied Save As default: a bare .hwp/.hwpx file name, else untitled.hwp */
export function safeDefaultSaveName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return 'untitled.hwp'
  if (/[\\/:]/.test(value) || value.startsWith('.')) return 'untitled.hwp'
  return /\.(hwp|hwpx)$/i.test(value) ? value : 'untitled.hwp'
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/form-names.test.ts`
Expected: PASS.

- [ ] **Step 5: 연결한다**

`apps/hwp/src/shared/ipc.ts`의 `saveAs(): Promise<…>`를 바꾼다:

```ts
  /** ask main for a destination path for an untitled document (Save As); grants the returned path for this view */
  saveAs(defaultName?: string): Promise<SaveHwpResult & { path?: string; canceled?: boolean }>
```

`apps/hwp/src/preload/index.ts`: `saveAs: () => ipcRenderer.invoke(HWP_CHANNELS.saveAs),` → `saveAs: (defaultName) => ipcRenderer.invoke(HWP_CHANNELS.saveAs, defaultName),`

`apps/hwp/src/main/hwp-main.ts`:

- import에 `import { safeDefaultSaveName } from '../shared/form-names'`를 추가한다.
- saveAs 핸들러: `async (e): Promise<…> => {` → `async (e, defaultName: unknown): Promise<…> => {`, 그리고 `defaultPath: 'untitled.hwp',` → `defaultPath: safeDefaultSaveName(defaultName),`

`apps/hwp/src/renderer/App.tsx`:

- import에 `import { formCopyNames } from '../shared/form-names'`를 추가한다.
- `const filePathRef = useRef<string | null>(null)` 아래에 추가:

```tsx
/** set when this tab started from a form: Save As proposes "<form>_작성.<ext>" */
const formNameRef = useRef<string | null>(null)
```

- 시작 처리에서 `if (intent.mode === 'open') { … } else { …빈 문서… }`를 다음처럼 바꾼다 (`open` 분기와 빈 문서 분기의 본문은 그대로 둔다):

```tsx
if (intent.mode === 'open') {
  // …기존 open 분기 그대로…
} else if (intent.mode === 'form') {
  // a COPY of a form: no path, so saving always asks for a new file
  filePathRef.current = null
  formNameRef.current = intent.fileName
  setDocName(formCopyNames(intent.fileName).tabName)
  setAiPath(null)
  const result = await editor.loadFile(new Uint8Array(intent.data), intent.fileName)
  if (disposed) return
  console.info(`[hwp] opened a copy of ${intent.fileName}: ${result.pageCount} page(s)`)
  setPages(result.pageCount)
} else {
  // …기존 빈 문서 분기 그대로…
}
setStatus(
  intent.mode === 'form' ? 'New document from a form — the original file stays unchanged' : '',
)
setPhase('ready')
```

(기존의 `setStatus('')` 한 줄은 위 `setStatus(…)`로 바뀐다.)

- `saveNow`: `const picked = await window.hwpApi.saveAs()` →

```tsx
const picked = await window.hwpApi.saveAs(
  formNameRef.current ? formCopyNames(formNameRef.current).saveName : undefined,
)
```

- [ ] **Step 6: 전체 확인**

Run: `npm run test -w @genoffice/hwp`
Expected: PASS 전체.
Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 0건.

- [ ] **Step 7: 커밋**

```bash
F="apps/hwp/src/shared/form-names.ts apps/hwp/tests/form-names.test.ts apps/hwp/src/renderer/App.tsx apps/hwp/src/main/hwp-main.ts apps/hwp/src/shared/ipc.ts apps/hwp/src/preload/index.ts"
npx prettier --write $F
npx eslint $F
git add $F
```

그다음 단독으로:

```bash
git commit -m "feat(hwp): a tab started from a form opens the copy and saves under a new name" -m "The form intent loads the bytes with no path, so the first save is always Save As; the dialog proposes '<form>_작성.<ext>' (a bare file name, validated again in main)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 저장 왕복 검사 실패의 허용 판정

**Files:**

- Create: `apps/hwp/src/main/layout-tolerance.ts`, `apps/hwp/tests/layout-tolerance.test.ts`
- Modify: `apps/hwp/src/main/ai-edit-chain.ts`, `apps/hwp/src/shared/ai-contract.ts`, `apps/hwp/tests/ai-edit-chain.test.ts`, `apps/hwp/tests/rhwp-cli.contract.test.ts`

**Interfaces:**

- Produces:
  - `interface DocSummary { fields: string[]; tables: Array<{ rows: number; cols: number }>; paragraphCount: number; pageCount: number }`
  - `summaryOf(envelope: RhwpEnvelope | null): DocSummary | null`
  - `judgeLayoutTolerance(ops: string[], before: DocSummary, after: DocSummary): { ok: true } | { ok: false; reason: string }`
  - `EditJournalEntry.verify?: 'layout-tolerant'`
  - `AiEditResult`(ok)의 `layoutTolerant?: { pagesBefore: number; pagesAfter: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (판정)** — `apps/hwp/tests/layout-tolerance.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { judgeLayoutTolerance, summaryOf } from '../src/main/layout-tolerance'

const doc = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over })
function base() {
  return {
    fields: ['발신기관명', '수신', '결재제목'],
    tables: [
      { rows: 6, cols: 3 },
      { rows: 1, cols: 1 },
    ],
    paragraphCount: 9,
    pageCount: 1,
  }
}

describe('summaryOf', () => {
  it('reads field names, table sizes and counts from an explain envelope', () => {
    expect(
      summaryOf({
        schemaVersion: '1.0',
        fields: ['a', 'b'],
        tables: [{ index: 0, rows: 2, cols: 3, hasMergedCells: false }],
        paragraphCount: 4,
        pageCount: 2,
      }),
    ).toEqual({
      fields: ['a', 'b'],
      tables: [{ rows: 2, cols: 3 }],
      paragraphCount: 4,
      pageCount: 2,
    })
  })

  it('returns null when a field it relies on is missing', () => {
    expect(summaryOf(null)).toBeNull()
    expect(summaryOf({ schemaVersion: '1.0', fields: [], tables: [] })).toBeNull()
  })
})

describe('judgeLayoutTolerance', () => {
  it('accepts an in-place edit that leaves the summary unchanged (page count may move)', () => {
    expect(
      judgeLayoutTolerance(
        ['replace_phrase', 'set_cell', 'fill_fields'],
        doc(),
        doc({ pageCount: 2 }),
      ),
    ).toEqual({ ok: true })
  })

  it('refuses when field names change', () => {
    const r = judgeLayoutTolerance(['fill_fields'], doc(), doc({ fields: ['발신기관명', '수신'] }))
    expect(r).toMatchObject({ ok: false })
    expect((r as { reason: string }).reason).toMatch(/field/i)
  })

  it('refuses a table size change unless the batch changes table structure', () => {
    const grown = doc({
      tables: [
        { rows: 7, cols: 3 },
        { rows: 1, cols: 1 },
      ],
    })
    expect(judgeLayoutTolerance(['set_cell'], doc(), grown)).toMatchObject({ ok: false })
    expect(judgeLayoutTolerance(['insert_row'], doc(), grown)).toEqual({ ok: true })
  })

  it('checks the table count against inserted and deleted tables', () => {
    const fewer = doc({ tables: [{ rows: 6, cols: 3 }], paragraphCount: 8 })
    expect(judgeLayoutTolerance(['delete_table'], doc(), fewer)).toEqual({ ok: true })
    expect(judgeLayoutTolerance(['insert_row'], doc(), fewer)).toMatchObject({ ok: false })
  })

  it('refuses a paragraph count change unless the batch adds or removes paragraphs', () => {
    const shorter = doc({ paragraphCount: 8 })
    expect(judgeLayoutTolerance(['set_paragraph_text'], doc(), shorter)).toMatchObject({
      ok: false,
    })
    expect(judgeLayoutTolerance(['delete_paragraph'], doc(), shorter)).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/layout-tolerance.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다 (판정)** — `apps/hwp/src/main/layout-tolerance.ts`

```ts
import type { RhwpEnvelope } from '../shared/ai-contract'

/**
 * `rhwp edit --verify` re-reads the saved file and compares it with the
 * in-memory document. Some Hancom-authored forms fail that round-trip check on
 * every edit, even a no-op one, because their stored line-layout values differ
 * from the engine's (spec §4.3). For those, compare the documents' explain
 * summaries instead: the edit must have changed only what its kind can change.
 */

export interface DocSummary {
  fields: string[]
  tables: Array<{ rows: number; cols: number }>
  paragraphCount: number
  pageCount: number
}

export type ToleranceVerdict = { ok: true } | { ok: false; reason: string }

const TABLE_SHAPE_OPS = new Set([
  'insert_row',
  'insert_col',
  'delete_row',
  'delete_col',
  'merge_cells',
  'split_cell',
  'insert_table',
  'delete_table',
])
const PARAGRAPH_COUNT_OPS = new Set([
  'insert_paragraph_after',
  'delete_paragraph',
  'insert_table',
  'delete_table',
  'insert_page_break',
  'insert_column_break',
  'insert_footnote',
  'insert_endnote',
])

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

export function summaryOf(envelope: RhwpEnvelope | null): DocSummary | null {
  if (!envelope) return null
  const { fields, tables, paragraphCount, pageCount } = envelope
  if (!Array.isArray(fields) || !fields.every((f) => typeof f === 'string')) return null
  if (!Array.isArray(tables) || !isInt(paragraphCount) || !isInt(pageCount)) return null
  const shapes: Array<{ rows: number; cols: number }> = []
  for (const table of tables) {
    const t = table as { rows?: unknown; cols?: unknown }
    if (!isInt(t.rows) || !isInt(t.cols)) return null
    shapes.push({ rows: t.rows, cols: t.cols })
  }
  return { fields: fields as string[], tables: shapes, paragraphCount, pageCount }
}

export function judgeLayoutTolerance(
  ops: string[],
  before: DocSummary,
  after: DocSummary,
): ToleranceVerdict {
  if (before.fields.join('\u0000') !== after.fields.join('\u0000')) {
    return { ok: false, reason: 'the form field names changed' }
  }
  if (ops.some((op) => TABLE_SHAPE_OPS.has(op))) {
    const inserted = ops.filter((op) => op === 'insert_table').length
    const deleted = ops.filter((op) => op === 'delete_table').length
    if (after.tables.length !== before.tables.length + inserted - deleted) {
      return { ok: false, reason: 'the number of tables changed unexpectedly' }
    }
  } else {
    const shape = (s: DocSummary) => s.tables.map((t) => `${t.rows}x${t.cols}`).join(',')
    if (shape(before) !== shape(after)) {
      return { ok: false, reason: 'a table changed size although no table structure was edited' }
    }
  }
  if (
    !ops.some((op) => PARAGRAPH_COUNT_OPS.has(op)) &&
    before.paragraphCount !== after.paragraphCount
  ) {
    return {
      ok: false,
      reason: 'the paragraph count changed although no paragraph was added or removed',
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/layout-tolerance.test.ts`
Expected: PASS.

- [ ] **Step 5: 실패하는 테스트를 쓴다 (체인)** — `apps/hwp/tests/ai-edit-chain.test.ts` 파일 끝에 추가

```ts
describe('round-trip check failure on a form that always fails it', () => {
  const explainOf = (paragraphCount: number) => ({
    exitCode: 0 as const,
    envelope: {
      schemaVersion: '1.0',
      fields: ['제목'],
      tables: [{ rows: 2, cols: 2 }],
      paragraphCount,
      pageCount: 1,
    },
    stderr: '',
  })
  function verifyFails(paragraphsAfter: number) {
    const calls: string[][] = []
    const run: RunRhwpFn = async (_bin, args) => {
      calls.push([...args])
      if (args[0] === 'explain') return explainOf(args[1] === snapshot ? 9 : paragraphsAfter)
      if (args[0] === 'ir-diff') {
        return { exitCode: 3, envelope: { schemaVersion: '1.0', diffCount: 22 }, stderr: '' }
      }
      const output = args[args.indexOf('-o') + 1]!
      writeFileSync(output, `${readFileSync(args[2]!, 'utf8')}+${args[1]}`)
      return {
        exitCode: 3,
        envelope: {
          schemaVersion: '1.0',
          changedPages: [0],
          verify: { diffCount: 22, identical: false },
        },
        stderr: '',
      }
    }
    return { run, calls }
  }

  it('accepts the edit when the document summary matches the edit kind, and records it', async () => {
    const { run } = verifyFails(9)
    const result = await runEditChain({
      rhwpPath: 'rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      ops: [{ op: 'replace_phrase', find: '붙임', replace: '첨부' }],
      run,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layoutTolerant).toEqual({ pagesBefore: 1, pagesAfter: 1 })
    expect(result.journal.at(-1)).toMatchObject({ verify: 'layout-tolerant' })
    expect(Buffer.from(result.data).toString()).toBe('ORIGINAL+replace-text')
  })

  it('refuses when the summary changed in a way the edit kind cannot explain', async () => {
    const { run } = verifyFails(8)
    const result = await runEditChain({
      rhwpPath: 'rhwp',
      snapshotPath: snapshot,
      workDir: dir,
      ops: [{ op: 'replace_phrase', find: '붙임', replace: '첨부' }],
      run,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/paragraph count changed/)
    expect(readdirSync(dir)).toEqual(['snap.hwpx'])
  })
})
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/ai-edit-chain.test.ts`
Expected: FAIL — 첫 테스트는 `ok: false`(지금은 exit 3을 바로 거부), 둘째는 오류 문구 불일치.

- [ ] **Step 7: 구현한다 (체인)**

`apps/hwp/src/shared/ai-contract.ts`:

- `EditJournalEntry`의 `noop?: boolean` 아래에 추가:

```ts
  /** the engine's save round-trip check failed (a property of some forms) and the explain summary was checked instead */
  verify?: 'layout-tolerant'
```

- `AiEditResult`의 성공 변형에서 `journal: EditJournalEntry[]` 위에 추가:

```ts
      /** set when the round-trip check failed and the summary check accepted the edit */
      layoutTolerant?: { pagesBefore: number; pagesAfter: number }
```

`apps/hwp/src/main/ai-edit-chain.ts`:

- import에 `import { judgeLayoutTolerance, summaryOf } from './layout-tolerance'`를 추가한다.
- `let current = params.snapshotPath` 아래에 `let layoutTolerant: { pagesBefore: number; pagesAfter: number } | undefined`를 추가한다.
- 반복문 안 `if (result.exitCode !== 0) {` 블록의 맨 앞에 추가한다 (기존 `tolerate` 처리보다 먼저):

```ts
if (last && result.exitCode === 3 && existsSync(output)) {
  const verdict = await acceptRoundTripFailure(run, params, output)
  if (verdict.ok) {
    layoutTolerant = verdict.pages
    journal.push({ ...base, verify: 'layout-tolerant' })
    for (const page of pagesOf(result.envelope)) changed.add(page)
    current = output
    continue
  }
  return fail(step, `${describeRhwpFailure(result)} — ${verdict.reason}`, result)
}
```

- 성공 반환 객체의 `journal,` 앞에 `...(layoutTolerant ? { layoutTolerant } : {}),`를 추가한다.
- 파일 끝에 추가:

```ts
async function acceptRoundTripFailure(
  run: RunRhwpFn,
  params: EditChainParams,
  output: string,
): Promise<
  { ok: true; pages: { pagesBefore: number; pagesAfter: number } } | { ok: false; reason: string }
> {
  try {
    const [before, after] = await Promise.all([
      run(params.rhwpPath, ['explain', params.snapshotPath, '--json']),
      run(params.rhwpPath, ['explain', output, '--json']),
    ])
    const a = before.exitCode === 0 ? summaryOf(before.envelope) : null
    const b = after.exitCode === 0 ? summaryOf(after.envelope) : null
    if (!a || !b) return { ok: false, reason: 'the document summary could not be read' }
    const ops = (params.ops as Array<{ op: string }>).map((op) => op.op)
    const verdict = judgeLayoutTolerance(ops, a, b)
    return verdict.ok
      ? { ok: true, pages: { pagesBefore: a.pageCount, pagesAfter: b.pageCount } }
      : verdict
  } catch {
    return { ok: false, reason: 'the document summary could not be read' }
  }
}
```

- [ ] **Step 8: 실바이너리 계약 테스트를 추가한다** — `apps/hwp/tests/rhwp-cli.contract.test.ts`의 `describe.skipIf(!HAVE_BIN)(…)` 안 맨 끝에 추가

```ts
it('explain exposes the summary the round-trip tolerance relies on, and it moves with the edit kind', async () => {
  const before = summaryOf(await envelope('explain', doc, '--json'))
  expect(before).not.toBeNull()
  expect(before!.tables.length).toBeGreaterThan(0)
  const grown = at('summary-row.hwpx')
  expect((await edit(doc, grown, 'insert-row', '--table', '0', '--row', '0')).exitCode).toBe(0)
  const afterRow = summaryOf(await envelope('explain', grown, '--json'))!
  expect(afterRow.tables[0]!.rows).toBe(before!.tables[0]!.rows + 1)
  expect(afterRow.paragraphCount).toBe(before!.paragraphCount)
  const shorter = at('summary-para.hwpx')
  expect(
    (await edit(doc, shorter, 'delete-paragraph', '--section', '0', '--para', '1')).exitCode,
  ).toBe(0)
  const afterPara = summaryOf(await envelope('explain', shorter, '--json'))!
  expect(afterPara.paragraphCount).toBe(before!.paragraphCount - 1)
  expect(judgeLayoutTolerance(['delete_paragraph'], before!, afterPara)).toEqual({ ok: true })
  expect(judgeLayoutTolerance(['set_paragraph_text'], before!, afterPara)).toMatchObject({
    ok: false,
  })
})
```

파일 위 import에 `import { judgeLayoutTolerance, summaryOf } from '../src/main/layout-tolerance'`를 추가한다.

- [ ] **Step 9: 통과와 전체 확인**

Run: `npm run test -w @genoffice/hwp`
Expected: PASS 전체 (계약 테스트 포함).
Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 0건.

- [ ] **Step 10: 커밋**

```bash
F="apps/hwp/src/main/layout-tolerance.ts apps/hwp/tests/layout-tolerance.test.ts apps/hwp/src/main/ai-edit-chain.ts apps/hwp/src/shared/ai-contract.ts apps/hwp/tests/ai-edit-chain.test.ts apps/hwp/tests/rhwp-cli.contract.test.ts"
npx prettier --write $F
npx eslint $F
git add $F
```

그다음 단독으로:

```bash
git commit -m "feat(hwp): accept an edit on a form that always fails the engine's round-trip check" -m "Some Hancom-authored forms fail rhwp's --verify on every edit, even a no-op one. When the last step exits 3, compare the explain summaries instead: field names, table sizes and paragraph count must change only as the edit kinds allow." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 표 삭제 연산과 거부 안내

**Files:**

- Modify: `apps/hwp/src/shared/ai-contract.ts` (`EditOp`), `apps/hwp/src/main/rhwp-edit-ops.ts`, `apps/hwp/src/main/ai-edit-chain.ts` (`describeRhwpFailure`), `apps/hwp/src/renderer/ai/tools/edit.ts` (`TABLE_OPS`, 설명, `summarizeEdit`)
- Test: `apps/hwp/tests/rhwp-edit-ops.test.ts`, `apps/hwp/tests/ai-edit-chain.test.ts`, `apps/hwp/tests/tools-edit.test.ts`

**Interfaces:**

- Consumes: `layoutTolerant` (작업 4)
- Produces: `EditOp`의 `{ op: 'delete_table'; table: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/hwp/tests/rhwp-edit-ops.test.ts` 파일 끝에 추가:

```ts
describe('delete_table', () => {
  it('compiles to rhwp edit delete-table --table N', () => {
    expect(compileEditOps([{ op: 'delete_table', table: 2 }])).toEqual({
      ok: true,
      steps: [{ opIndex: 0, command: 'delete-table', flags: ['--table', '2'] }],
    })
  })

  it('rejects a missing or negative table index', () => {
    expect(compileEditOps([{ op: 'delete_table' }])).toMatchObject({ ok: false, index: 0 })
    expect(compileEditOps([{ op: 'delete_table', table: -1 }])).toMatchObject({
      ok: false,
      index: 0,
    })
  })
})
```

(이 파일 위에 `compileEditOps` import가 이미 있다.)

`apps/hwp/tests/ai-edit-chain.test.ts` 파일 끝에 추가:

```ts
describe('describeRhwpFailure hints', () => {
  it('tells the model to delete the whole table when the only row is removed', () => {
    const text = describeRhwpFailure({
      exitCode: 1,
      envelope: null,
      stderr: '오류: 행 삭제 실패 - 렌더링 오류: 최소 1행은 유지해야 합니다',
    })
    expect(text).toMatch(/delete_table/)
  })

  it('tells the model to empty the text when the last paragraph of a section is removed', () => {
    const text = describeRhwpFailure({
      exitCode: 1,
      envelope: null,
      stderr: '오류: 문단 삭제 실패 - 렌더링 오류: 구역의 마지막 문단은 삭제할 수 없습니다',
    })
    expect(text).toMatch(/set_paragraph_text/)
  })
})
```

이 파일 위 import `import { runEditChain } from '../src/main/ai-edit-chain'`를 `import { describeRhwpFailure, runEditChain } from '../src/main/ai-edit-chain'`로 바꾼다.

`apps/hwp/tests/tools-edit.test.ts` 파일 끝에 추가:

```ts
describe('edit_table delete_table and the round-trip note', () => {
  it('passes delete_table through and reports a tolerated round-trip check', async () => {
    const api = fakeApi({}, (request) => ({
      ...(okEdit(request) as Extract<AiEditResult, { ok: true }>),
      layoutTolerant: { pagesBefore: 1, pagesAfter: 1 },
    }))
    const ctx = ctxWith(api, fakeEditor())
    const result = await editTools.execute(
      ctx,
      call('edit_table', { ops: [{ op: 'delete_table', table: 1 }] }),
    )
    expect(result.isError).toBeUndefined()
    expect(api.edits[0]!.ops).toEqual([{ op: 'delete_table', table: 1 }])
    expect(result.output).toMatch(/round-trip check/)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/rhwp-edit-ops.test.ts tests/ai-edit-chain.test.ts tests/tools-edit.test.ts`
Expected: FAIL — `unknown op "delete_table"`, 안내 문구 없음, `edit_table`이 `delete_table`을 거부.

- [ ] **Step 3: 구현한다**

`apps/hwp/src/shared/ai-contract.ts`의 `EditOp`에서 `| { op: 'insert_table'; … }` 줄 아래에 `| { op: 'delete_table'; table: number }`를 추가한다.

`apps/hwp/src/main/rhwp-edit-ops.ts`의 `COMPILERS`에서 `insert_table:` 항목 아래에 추가:

```ts
  delete_table: (raw) => [{ command: 'delete-table', flags: ['--table', n(index(raw, 'table'))] }],
```

`apps/hwp/src/main/ai-edit-chain.ts`의 `describeRhwpFailure` `default:` 분기를 바꾼다:

```ts
    default: {
      const detail = (result.stderr.trim() || JSON.stringify(result.envelope ?? {})).slice(0, 800)
      const hint = /최소 1행/.test(result.stderr)
        ? ' — this is the table\'s only row: remove the whole table with delete_table instead.'
        : /마지막 문단은 삭제할 수 없/.test(result.stderr)
          ? ' — the last paragraph of a section cannot be removed: empty it with set_paragraph_text and an empty text instead.'
          : ''
      return `rhwp edit failed: ${detail}${hint}`
    }
```

`apps/hwp/src/renderer/ai/tools/edit.ts`:

- `TABLE_OPS` 배열 끝(`'insert_table',` 뒤)에 `'delete_table',`를 추가한다.
- `edit_table` 설명 끝의 `insert_table {section, paragraph, rows, cols} — new empty table at that paragraph.` 뒤에 ` delete_table {table} — remove a whole table (also the way to remove a one-row table).`를 붙인다.
- `summarizeEdit`의 반환 배열에서 `...lines,` 뒤에 추가:

```ts
    result.layoutTolerant
      ? `The engine's save round-trip check always fails on this document, so the edit was checked against the document summary instead (form fields, table sizes and paragraph count are as expected; pages ${result.layoutTolerant.pagesBefore} → ${result.layoutTolerant.pagesAfter}).`
      : '',
```

- [ ] **Step 4: 통과와 전체 확인**

Run: `npm run test -w @genoffice/hwp`
Expected: PASS 전체.
Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 0건.

- [ ] **Step 5: 커밋**

```bash
F="apps/hwp/src/shared/ai-contract.ts apps/hwp/src/main/rhwp-edit-ops.ts apps/hwp/src/main/ai-edit-chain.ts apps/hwp/src/renderer/ai/tools/edit.ts apps/hwp/tests/rhwp-edit-ops.test.ts apps/hwp/tests/ai-edit-chain.test.ts apps/hwp/tests/tools-edit.test.ts"
npx prettier --write $F
npx eslint $F
git add $F
```

그다음 단독으로:

```bash
git commit -m "feat(hwp): delete whole tables and explain the engine's two removal refusals" -m "edit_table gains delete_table (rhwp edit delete-table). Removing a table's only row or a section's last paragraph now tells the model what to use instead. Tolerated round-trip checks are reported in the edit summary." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `paragraphs` 쿼리 (엔진 `dump` 파싱)

**Files:**

- Create: `apps/hwp/src/main/rhwp-paragraphs.ts`, `apps/hwp/tests/rhwp-paragraphs.test.ts`
- Modify: `apps/hwp/src/shared/ai-contract.ts` (`AI_QUERY_NAMES`, `RhwpResult`), `apps/hwp/src/main/rhwp-cli.ts` (`keepStdout`), `apps/hwp/src/main/rhwp-queries.ts`, `apps/hwp/src/main/hwp-main.ts` (ai-query), `apps/hwp/tests/rhwp-cli.test.ts`, `apps/hwp/tests/rhwp-cli.contract.test.ts`

**Interfaces:**

- Produces: 쿼리 `paragraphs` → 봉투 `{ schemaVersion: '1.0', paragraphs: Array<{ section: number; paragraph: number; preview: string; length: number; empty: boolean; hasTable: boolean }>, untrustedContent: true, untrustedFields: ['paragraphs[].preview'] }`; `parseDumpParagraphs(stdout: string)`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `apps/hwp/tests/rhwp-paragraphs.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { parseDumpParagraphs } from '../src/main/rhwp-paragraphs'

const DUMP = [
  '=== 구역 0 ===',
  '--- 문단 0.0 --- cc=25, text_len=0, controls=3 [구역나누기]',
  '  텍스트: (빈 문단)',
  '  [2] 표: 1행×2열, 셀=2, 쪽나눔=RowBreak',
  '--- 문단 0.1 --- cc=38, text_len=21, controls=2 ',
  '  텍스트: "보고서 제목 (HY헤드라인M+굵게28)"',
  '  [CS] pos=0 id=13',
  '--- 문단 0.2 --- cc=86, text_len=85, controls=0 ',
  '  텍스트: "          1. 우리 관리부 보고서 작성시 부서별 ..."',
  '--- 문단 1.0 --- cc=2, text_len=1, controls=0 ',
  '  텍스트: "\\"인용\\""',
].join('\n')

describe('parseDumpParagraphs', () => {
  it('reads coordinates, preview, length, emptiness and tables per body paragraph', () => {
    expect(parseDumpParagraphs(DUMP)).toEqual([
      { section: 0, paragraph: 0, preview: '', length: 0, empty: true, hasTable: true },
      {
        section: 0,
        paragraph: 1,
        preview: '보고서 제목 (HY헤드라인M+굵게28)',
        length: 21,
        empty: false,
        hasTable: false,
      },
      {
        section: 0,
        paragraph: 2,
        preview: '1. 우리 관리부 보고서 작성시 부서별 ...',
        length: 85,
        empty: false,
        hasTable: false,
      },
      { section: 1, paragraph: 0, preview: '"인용"', length: 1, empty: false, hasTable: false },
    ])
  })

  it('treats a whitespace-only paragraph as empty and returns [] for no paragraphs', () => {
    expect(
      parseDumpParagraphs('--- 문단 0.0 --- cc=4, text_len=3, controls=0\n  텍스트: "   "'),
    ).toEqual([{ section: 0, paragraph: 0, preview: '', length: 3, empty: true, hasTable: false }])
    expect(parseDumpParagraphs('nothing here')).toEqual([])
  })
})

describe('paragraphsResult', () => {
  it('turns dump stdout into a fenced-field envelope and drops the raw text', () => {
    const result = paragraphsResult({ exitCode: 0, envelope: null, stderr: '', stdout: DUMP })
    expect(result).not.toHaveProperty('stdout')
    expect(result.exitCode).toBe(0)
    expect(result.envelope).toMatchObject({
      schemaVersion: '1.0',
      untrustedContent: true,
      untrustedFields: ['paragraphs[].preview'],
    })
    expect((result.envelope!.paragraphs as unknown[]).length).toBe(4)
  })

  it('passes an engine failure through without an envelope', () => {
    expect(paragraphsResult({ exitCode: 1, envelope: null, stderr: 'boom', stdout: 'x' })).toEqual({
      exitCode: 1,
      envelope: null,
      stderr: 'boom',
    })
  })
})
```

import 줄은 `import { paragraphsResult, parseDumpParagraphs } from '../src/main/rhwp-paragraphs'`이다.

`apps/hwp/tests/rhwp-cli.test.ts`의 `describe('runRhwp', …)` 안 끝에 추가:

```ts
it('returns raw stdout only when asked to keep it', async () => {
  const text = '--- 문단 0.0 --- cc=1, text_len=0, controls=0\n'
  const kept = await runRhwp('/bin/rhwp', ['dump', 'a.hwpx'], {
    spawnImpl: spawnWith(fakeProcess(text, '', 0)),
    keepStdout: true,
  })
  expect(kept).toMatchObject({ exitCode: 0, envelope: null, stdout: text })
  const dropped = await runRhwp('/bin/rhwp', ['dump', 'a.hwpx'], {
    spawnImpl: spawnWith(fakeProcess(text, '', 0)),
  })
  expect(dropped).not.toHaveProperty('stdout')
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/rhwp-paragraphs.test.ts tests/rhwp-cli.test.ts`
Expected: FAIL — 모듈 없음, `stdout` 없음.

- [ ] **Step 3: 구현한다** — `apps/hwp/src/main/rhwp-paragraphs.ts`

```ts
import type { RhwpResult } from '../shared/ai-contract'

/**
 * `rhwp dump` (text, no --json) lists every body paragraph as
 *   --- 문단 S.P --- cc=…, text_len=N, controls=…
 *     텍스트: "…"            (or "텍스트: (빈 문단)")
 *     [k] 표: …              (a table anchored in this paragraph)
 * The text is cut at about 50 characters with "...", so it is a preview; N is
 * the full length. Pinned against rhwp 0.8.6 by the contract test.
 */

export interface DumpParagraph {
  section: number
  paragraph: number
  preview: string
  length: number
  empty: boolean
  hasTable: boolean
}

const HEADER = /^--- 문단 (\d+)\.(\d+) --- .*?text_len=(\d+)/
const TEXT = /^ {2}텍스트: (.*)$/
const TABLE = /^ {2}\[\d+\] 표:/

function unquote(raw: string): string {
  if (raw === '(빈 문단)') return ''
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw
}

export function parseDumpParagraphs(stdout: string): DumpParagraph[] {
  const out: DumpParagraph[] = []
  let current: DumpParagraph | null = null
  for (const line of stdout.split(/\r?\n/)) {
    const header = HEADER.exec(line)
    if (header) {
      current = {
        section: Number(header[1]),
        paragraph: Number(header[2]),
        preview: '',
        length: Number(header[3]),
        empty: true,
        hasTable: false,
      }
      out.push(current)
      continue
    }
    if (!current) continue
    const text = TEXT.exec(line)
    if (text) {
      const value = unquote(text[1]!).trim()
      current.preview = value
      current.empty = value.length === 0
      continue
    }
    if (TABLE.test(line)) current.hasTable = true
  }
  return out
}

/** the `paragraphs` query result main hands the renderer: an envelope, never the raw dump */
export function paragraphsResult(dumped: RhwpResult): RhwpResult {
  if (dumped.exitCode !== 0) {
    return { exitCode: dumped.exitCode, envelope: null, stderr: dumped.stderr }
  }
  return {
    exitCode: 0,
    stderr: '',
    envelope: {
      schemaVersion: '1.0',
      paragraphs: parseDumpParagraphs(dumped.stdout ?? ''),
      untrustedContent: true,
      untrustedFields: ['paragraphs[].preview'],
    },
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

(이 단계는 Step 5의 `keepStdout`·`stdout?` 추가 뒤에 함께 확인한다.)

- [ ] **Step 5: 연결한다**

`apps/hwp/src/shared/ai-contract.ts`:

- `AI_QUERY_NAMES` 끝(`'inspect_injection',` 뒤)에 `'paragraphs',`를 추가한다.
- `RhwpResult`의 `stderr: string` 아래에 추가:

```ts
  /** raw stdout, only when the runner was asked to keep it (commands without --json, e.g. dump) */
  stdout?: string
```

`apps/hwp/src/main/rhwp-cli.ts`:

- `RunRhwpOptions`에 `keepStdout?: boolean`를 추가한다 (설명 주석: `/** also return raw stdout (dump has no --json) */`).
- `resolve({ exitCode: code, envelope: parseEnvelope(stdout), stderr })`를 다음으로 바꾼다:

```ts
resolve({
  exitCode: code,
  envelope: parseEnvelope(stdout),
  stderr,
  ...(options.keepStdout ? { stdout } : {}),
})
```

`apps/hwp/src/main/rhwp-queries.ts`의 `BUILDERS`에서 `word_count:` 항목 아래에 추가:

```ts
  paragraphs: (args, path) => {
    checkAllowed(args, [])
    // dump has no --json; main turns its text into an envelope (rhwp-paragraphs.ts)
    return ['dump', path]
  },
```

`apps/hwp/src/main/hwp-main.ts`:

- import에 `import { paragraphsResult } from './rhwp-paragraphs'`를 추가한다.
- ai-query 핸들러의 `return { ok: true, result: await runRhwp(bin.path, built.args) }`를 바꾼다:

```ts
if (request.tool === 'paragraphs') {
  const dumped = await runRhwp(bin.path, built.args, { keepStdout: true })
  return { ok: true, result: paragraphsResult(dumped) }
}
return { ok: true, result: await runRhwp(bin.path, built.args) }
```

Run: `npm run test -w @genoffice/hwp -- tests/rhwp-paragraphs.test.ts tests/rhwp-cli.test.ts`
Expected: PASS.

`apps/hwp/tests/rhwp-cli.contract.test.ts`의 `describe.skipIf(…)` 안 끝에 추가:

```ts
it('dump lists body paragraphs with the same coordinates search reports', async () => {
  const dumped = await runRhwp(BIN, ['dump', doc], { keepStdout: true })
  expect(dumped.exitCode).toBe(0)
  const paragraphs = parseDumpParagraphs(dumped.stdout ?? '')
  expect(paragraphs.length).toBeGreaterThan(3)
  const [hit] = await search(doc, '마지막 문단')
  const same = paragraphs.find((p) => p.section === hit!.section && p.paragraph === hit!.paragraph)
  expect(same?.preview).toContain('마지막 문단')
  expect(paragraphs.some((p) => p.hasTable)).toBe(true)
})
```

이 파일 import에 `import { parseDumpParagraphs } from '../src/main/rhwp-paragraphs'`를 추가한다.

- [ ] **Step 6: 전체 확인**

Run: `npm run test -w @genoffice/hwp`
Expected: PASS 전체 (`rhwp-queries.test.ts`가 모든 쿼리 이름에 빌더가 있는지 본다면 `paragraphs`도 통과).
Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 0건.

- [ ] **Step 7: 커밋**

```bash
F="apps/hwp/src/main/rhwp-paragraphs.ts apps/hwp/tests/rhwp-paragraphs.test.ts apps/hwp/src/shared/ai-contract.ts apps/hwp/src/main/rhwp-cli.ts apps/hwp/src/main/rhwp-queries.ts apps/hwp/src/main/hwp-main.ts apps/hwp/tests/rhwp-cli.test.ts apps/hwp/tests/rhwp-cli.contract.test.ts"
npx prettier --write $F
npx eslint $F
git add $F
```

그다음 단독으로:

```bash
git commit -m "feat(hwp): a 'paragraphs' query lists body paragraphs from rhwp dump" -m "dump has no --json, so main parses its text into an envelope of coordinates, a preview (dump cuts text at ~50 characters), the full length, emptiness and whether a table is anchored there." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 양식 지도 도구 `form_map`

**Files:**

- Modify: `apps/hwp/src/renderer/ai/tools/read.ts`, `apps/hwp/src/renderer/ai/hwp-skill.ts`
- Test: `apps/hwp/tests/tools-read.test.ts`, `apps/hwp/tests/hwp-skill.test.ts`

**Interfaces:**

- Consumes: 쿼리 `fields`, `export_tables`, `paragraphs` (작업 6)
- Produces: 도구 `form_map { paragraphsFrom?: number }` → `{ summary, fields, tables, paragraphs, tablesTruncated, nextParagraphsFrom?, unavailable? }`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `apps/hwp/tests/tools-read.test.ts` 파일 끝에 추가

```ts
describe('form_map', () => {
  const fields = env({
    fields: [
      {
        name: '발신기관명',
        guide: '',
        value: '서울대공원',
        location: { section: 0, paragraph: 1 },
      },
      { name: '수신', guide: '수신처', value: '', location: { section: 0, paragraph: 2 } },
    ],
    untrustedFields: ['fields[].name', 'fields[].value', 'fields[].guide'],
  })
  const tables = env({
    tables: [
      {
        index: 0,
        section: 0,
        paragraph: 4,
        control: 0,
        rows: 2,
        cols: 2,
        cells: [
          { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: '항목' },
          { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: '' },
          { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: '금액' },
          { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: ' ' },
        ],
      },
    ],
  })
  const paragraphs = env({
    paragraphs: [
      {
        section: 0,
        paragraph: 0,
        preview: '보고서 제목',
        length: 6,
        empty: false,
        hasTable: false,
      },
      { section: 0, paragraph: 1, preview: '', length: 0, empty: true, hasTable: true },
    ],
  })

  it('maps fields, table cells and body paragraphs in one call, fenced, with a summary', async () => {
    const api = fakeApi({ fields, export_tables: tables, paragraphs })
    const result = await readTools.execute(ctxWith(api), call('form_map'))
    expect(result.isError).toBeUndefined()
    const out = JSON.parse(result.output)
    expect(out.summary).toMatch(/2 form field\(s\) \(1 empty\)/)
    expect(out.summary).toMatch(/1 table\(s\) \(2 empty cell\(s\)\)/)
    expect(out.summary).toMatch(/2 body paragraph\(s\) \(1 empty\)/)
    expect(unwrap(out.fields[0].name)).toBe('발신기관명')
    expect(out.fields[1]).toMatchObject({ empty: true })
    expect(out.tables[0].cells[1]).toMatchObject({ row: 0, col: 1, empty: true })
    expect(unwrap(out.tables[0].cells[0].text)).toBe('항목')
    expect(out.paragraphs[0]).toMatchObject({ section: 0, paragraph: 0, length: 6 })
    expect(unwrap(out.paragraphs[0].preview)).toBe('보고서 제목')
    expect(out.tables[0].cells[0].text).toMatch(FENCE)
    expect(out).not.toHaveProperty('unavailable')
  })

  it('reports the parts it could not read and returns the rest', async () => {
    const api = fakeApi({ fields, export_tables: tables, paragraphs: { error: 'dump failed' } })
    const out = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
    expect(out.unavailable).toEqual(['paragraphs'])
    expect(out.fields).toHaveLength(2)
  })

  it('caps the paragraph list and says where to continue', async () => {
    const many = env({
      paragraphs: Array.from({ length: 450 }, (_, i) => ({
        section: 0,
        paragraph: i,
        preview: `문단 ${i}`,
        length: 5,
        empty: false,
        hasTable: false,
      })),
    })
    const api = fakeApi({ fields, export_tables: tables, paragraphs: [many, many] })
    const first = JSON.parse((await readTools.execute(ctxWith(api), call('form_map'))).output)
    expect(first.paragraphs).toHaveLength(300)
    expect(first.nextParagraphsFrom).toBe(300)
    const second = JSON.parse(
      (await readTools.execute(ctxWith(api), call('form_map', { paragraphsFrom: 300 }))).output,
    )
    expect(second.paragraphs[0].paragraph).toBe(300)
    expect(second.paragraphs).toHaveLength(150)
    expect(second).not.toHaveProperty('nextParagraphsFrom')
  })
})
```

`apps/hwp/tests/hwp-skill.test.ts`:

- 정렬된 `EXPECTED` 배열에서 `'find',` 다음 줄에 `'form_map',`를 넣는다.
- 테스트 이름 `exposes exactly the 14 tools of the spec`을 `exposes exactly the 15 tools`로 바꾼다.
- `describe('hwp skill', …)` 안 끝에 추가:

```ts
it('steers form filling to form_map first', () => {
  expect(SYSTEM_PROMPT).toMatch(/call form_map ONCE first/)
  expect(SYSTEM_PROMPT).toMatch(/delete_table/)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/tools-read.test.ts tests/hwp-skill.test.ts`
Expected: FAIL — `Unknown read tool: form_map`, 시스템 프롬프트에 `form_map` 없음.

- [ ] **Step 3: 구현한다**

`apps/hwp/src/renderer/ai/tools/read.ts`:

- 상수 아래에 `export const FORM_MAP_PARAGRAPHS_CAP = 300`을 추가한다.
- `tools` 배열 끝(`get_document_state` 정의 뒤)에 추가:

```ts
  {
    name: 'form_map',
    description:
      'Map a form in ONE call: every form field (누름틀: name, guide, value, empty?), every table with each cell (row, col, text, empty?) and every body paragraph (section, paragraph, a short preview, full length, empty?, hasTable). Use it first when filling a form or a document with blanks, instead of calling find/read_table per cell. Paragraph previews are cut by the engine — use find or read_pages for the full text. Long documents return up to 300 paragraphs; continue with paragraphsFrom.',
    inputSchema: {
      type: 'object',
      properties: {
        paragraphsFrom: { type: 'integer', description: 'Index in the paragraph list to continue from' },
      },
    },
  },
```

- `documentState` 함수 아래에 추가:

```ts
async function formMap(ctx: HwpAiContext, input: Rec): Promise<ToolExecution> {
  const from = intArg(input, 'paragraphsFrom', { min: 0, fallback: 0 })
  const unavailable: string[] = []
  const part = async (name: 'fields' | 'export_tables' | 'paragraphs', label: string) => {
    try {
      return (await runQuery(ctx, name)).envelope
    } catch {
      unavailable.push(label)
      return null
    }
  }
  // one after another: each runQuery may send the snapshot first
  const fieldsEnv = await part('fields', 'fields')
  const tablesEnv = await part('export_tables', 'tables')
  const paragraphsEnv = await part('paragraphs', 'paragraphs')
  const nonce = newNonce()
  const blank = (text: string) => text.trim().length === 0
  const fields = arr(fieldsEnv?.fields).map((f) => ({
    name: wrapText(str(f.name), nonce),
    guide: wrapText(str(f.guide), nonce),
    value: wrapText(str(f.value), nonce),
    empty: blank(str(f.value)),
  }))
  let cellBudget = TABLE_CELLS_CAP
  let tablesTruncated = false
  const tables = arr(tablesEnv?.tables).map((t) => {
    const cells = arr(t.cells)
    const kept = cells.slice(0, Math.max(0, cellBudget))
    cellBudget -= kept.length
    if (kept.length < cells.length) tablesTruncated = true
    return {
      index: t.index,
      rows: t.rows,
      cols: t.cols,
      cells: kept.map((c) => ({
        row: c.row,
        col: c.col,
        text: wrapText(str(c.text), nonce),
        empty: blank(str(c.text)),
      })),
    }
  })
  const allParagraphs = arr(paragraphsEnv?.paragraphs)
  const page = allParagraphs.slice(from, from + FORM_MAP_PARAGRAPHS_CAP)
  const paragraphs = page.map((p) => ({
    section: p.section,
    paragraph: p.paragraph,
    preview: wrapText(str(p.preview), nonce),
    length: p.length,
    empty: p.empty === true,
    hasTable: p.hasTable === true,
  }))
  const emptyCells = tables.reduce((n, t) => n + t.cells.filter((c) => c.empty).length, 0)
  const summary = [
    `${fields.length} form field(s) (${fields.filter((f) => f.empty).length} empty)`,
    `${tables.length} table(s) (${emptyCells} empty cell(s))`,
    `${allParagraphs.length} body paragraph(s) (${allParagraphs.filter((p) => p.empty === true).length} empty)`,
  ].join(', ')
  const next = from + FORM_MAP_PARAGRAPHS_CAP
  return {
    output: JSON.stringify({
      summary,
      fields,
      tables,
      tablesTruncated,
      paragraphs,
      ...(next < allParagraphs.length ? { nextParagraphsFrom: next } : {}),
      ...(unavailable.length ? { unavailable } : {}),
    }),
    summary: `form map: ${fields.length} field(s), ${tables.length} table(s), ${allParagraphs.length} paragraph(s)`,
  }
}
```

- `execute`의 `switch`에 `case 'form_map': return formMap(ctx, input)`를 `get_document_state` 앞에 추가한다.

`apps/hwp/src/renderer/ai/hwp-skill.ts`의 `SYSTEM_PROMPT`에서 `4. Forms (누름틀): …` 줄을 바꾼다:

```
4. Forms and documents with blanks: call form_map ONCE first (fields, every table cell, every body paragraph) instead of find/read_table per cell. Fill 누름틀 with fill_fields (exact names; "이름[1]" is the second field of a repeated name) and table cells with ONE edit_table batch of set_cell ops. Remove guidance tables a form tells you to delete with edit_table delete_table.
```

- [ ] **Step 4: 통과와 전체 확인**

Run: `npm run test -w @genoffice/hwp`
Expected: PASS 전체.
Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 0건.

- [ ] **Step 5: 커밋**

```bash
F="apps/hwp/src/renderer/ai/tools/read.ts apps/hwp/src/renderer/ai/hwp-skill.ts apps/hwp/tests/tools-read.test.ts apps/hwp/tests/hwp-skill.test.ts"
npx prettier --write $F
npx eslint $F
git add $F
```

그다음 단독으로:

```bash
git commit -m "feat(hwp): form_map maps a form's fields, table cells and paragraphs in one call" -m "Filling a form used to cost one find/read_table per cell and ran into the turn limit. form_map returns everything fenced, with emptiness flags, caps and a continue cursor, and the system prompt sends form work there first." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 차례 한도 20과 끝맺음 안내

**Files:**

- Create: `apps/hwp/src/renderer/ai/run-notice.ts`, `apps/hwp/tests/run-notice.test.ts`
- Modify: `apps/hwp/src/renderer/ai/hwp-skill.ts` (`HWP_MAX_TURNS`), `apps/hwp/src/renderer/ai/AiPanel.tsx`

**Interfaces:**

- Produces: `HWP_MAX_TURNS = 20`, `runEndText(end: { text: string; cancelled: boolean; turnLimit: boolean; mutations: number }, lang: 'ko' | 'en'): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `apps/hwp/tests/run-notice.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { HWP_MAX_TURNS } from '../src/renderer/ai/hwp-skill'
import { runEndText } from '../src/renderer/ai/run-notice'

const end = (over: Partial<Parameters<typeof runEndText>[0]> = {}) => ({
  text: '',
  cancelled: false,
  turnLimit: false,
  mutations: 0,
  ...over,
})

describe('run end text', () => {
  it('allows 20 turns', () => {
    expect(HWP_MAX_TURNS).toBe(20)
  })

  it('keeps the model text when there is one', () => {
    expect(runEndText(end({ text: '채웠습니다.' }), 'ko')).toBe('채웠습니다.')
  })

  it('explains a turn-limit stop with the number of applied edits and how to continue', () => {
    const ko = runEndText(end({ text: '진행 중', turnLimit: true, mutations: 3 }), 'ko')
    expect(ko).toMatch(/^진행 중\n\n/)
    expect(ko).toMatch(/3건/)
    expect(ko).toMatch(/'계속'/)
    expect(runEndText(end({ turnLimit: true, mutations: 1 }), 'en')).toMatch(
      /1 edit\(s\).*"continue"/,
    )
  })

  it('replaces "No reply." with what happened', () => {
    expect(runEndText(end({ mutations: 2 }), 'ko')).toMatch(/설명 없이.*2건.*되돌리/)
    expect(runEndText(end({ mutations: 0 }), 'ko')).toMatch(/답 없이/)
    expect(runEndText(end({ mutations: 0 }), 'en')).toMatch(/without an answer/)
  })

  it('a stop shows the partial text or "Stopped."', () => {
    expect(runEndText(end({ cancelled: true }), 'en')).toBe('Stopped.')
    expect(runEndText(end({ cancelled: true }), 'ko')).toBe('중지했습니다.')
    expect(runEndText(end({ cancelled: true, text: '부분' }), 'ko')).toBe('부분')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -w @genoffice/hwp -- tests/run-notice.test.ts`
Expected: FAIL — 모듈 없음, `HWP_MAX_TURNS` 없음.

- [ ] **Step 3: 구현한다**

`apps/hwp/src/renderer/ai/hwp-skill.ts`의 `AGENT_TOOLS` 선언 아래에 추가:

```ts
/** form filling takes several read/edit rounds; form_map keeps the real count low */
export const HWP_MAX_TURNS = 20
```

`apps/hwp/src/renderer/ai/run-notice.ts`:

```ts
export interface RunEnd {
  /** the model's text for the final turn */
  text: string
  cancelled: boolean
  turnLimit: boolean
  /** tools of this run that changed the document */
  mutations: number
}

/** what the panel shows when a run ends (never persisted when the model said nothing) */
export function runEndText(end: RunEnd, lang: 'ko' | 'en'): string {
  const ko = lang === 'ko'
  if (end.cancelled) return end.text || (ko ? '중지했습니다.' : 'Stopped.')
  if (end.turnLimit) {
    const note = ko
      ? `작업이 길어져 여기서 멈췄습니다. 지금까지 적용한 편집 ${end.mutations}건. '계속'이라고 입력하면 이어서 진행합니다.`
      : `This took too many steps, so it stopped here after ${end.mutations} edit(s). Type "continue" to go on.`
    return [end.text, note].filter(Boolean).join('\n\n')
  }
  if (end.text) return end.text
  if (end.mutations > 0) {
    return ko
      ? `모델이 설명 없이 끝냈습니다. 적용한 편집 ${end.mutations}건은 ⌘Z 또는 'AI 편집 되돌리기'로 되돌릴 수 있습니다.`
      : `The model finished without a summary. Its ${end.mutations} edit(s) can be undone with ⌘Z or "Undo AI edit".`
  }
  return ko
    ? '모델이 답 없이 끝냈습니다. 다시 요청하거나 다른 모델을 골라 보세요.'
    : 'The model ended without an answer. Ask again or pick another model.'
}
```

`apps/hwp/src/renderer/ai/AiPanel.tsx`:

1. import: `import { createHwpSkill } from './hwp-skill'` 줄을 `import { createHwpSkill, HWP_MAX_TURNS } from './hwp-skill'`로 바꾸고(실제 import 줄 모양에 맞춘다), `import { runEndText } from './run-notice'`를 추가한다.
2. `const [lang, setLang] = useState<'en' | 'ko'>('en')` 아래에 추가:

```tsx
// the loop is built once; its callbacks read the current language through a ref
const langRef = useRef(lang)
langRef.current = lang
const mutationsRef = useRef(0)
```

3. `new AgentLoop({` 옵션에서 `skill: createHwpSkill(ctxRef.current),` 아래에 `maxTurns: HWP_MAX_TURNS,`를 추가한다.
4. `onToolExecuted` 핸들러 첫 줄 `setPhase('working')` 아래에 `if (execution.mutated) mutationsRef.current++`를 추가한다.
5. `onDone` 본문을 바꾼다. 바꾸기 전:

```tsx
          const final = turnLimit
            ? [text, 'Turn limit reached.'].filter(Boolean).join('\n\n')
            : text || (cancelled ? 'Stopped.' : '')
          patchLast((last) => ({
            streaming: false,
            text: final || (last.tools?.length ? last.text : 'No reply.'),
          }))
          setBusy(false)
          if (final && !cancelled) {
```

바꾼 뒤:

```tsx
          const final = runEndText(
            { text, cancelled, turnLimit, mutations: mutationsRef.current },
            langRef.current,
          )
          patchLast({ streaming: false, text: final })
          setBusy(false)
          // notices are display-only: only a run where the model wrote something is saved
          if (text && !cancelled) {
```

(그 아래 `persistMessage('assistant', final, …)` 호출은 그대로 둔다.)

6. 실행을 시작할 때 도구 기록을 비우는 줄 `runToolsRef.current = []` 아래에 `mutationsRef.current = 0`을 추가한다.

- [ ] **Step 4: 통과와 전체 확인**

Run: `npm run test -w @genoffice/hwp`
Expected: PASS 전체.
Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 0건.

- [ ] **Step 5: 커밋**

```bash
F="apps/hwp/src/renderer/ai/run-notice.ts apps/hwp/tests/run-notice.test.ts apps/hwp/src/renderer/ai/hwp-skill.ts apps/hwp/src/renderer/ai/AiPanel.tsx"
npx prettier --write $F
npx eslint $F
git add $F
```

그다음 단독으로:

```bash
git commit -m "feat(hwp): 20 turns for the Hangul assistant and a clear note when a run ends early" -m "A turn-limit stop says how many edits were applied and how to continue; an empty final turn says whether there are edits to undo, instead of 'No reply.'. Notices are not saved to the transcript." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 실제 양식으로 확인하고 문서화

결함이 나오면 먼저 그것을 재현하는 실패 테스트를 쓰고 고친다 (RED → GREEN). 양식 파일은 `D:\tmp\forms`에만 있고 저장소에 넣지 않는다.

**Files:**

- Modify (gitignored): `scripts/drivers/driver.hwp-form-fill.mjs` — 홈 카드 경로 추가
- Modify: `README.md`, `MODIFICATIONS.md`, 스펙 상태, 이 계획 맨 아래 수용 로그

- [ ] **Step 1: 전체 관문**

Run: `npm run build:all`
Expected: 성공.
Run: `npm run typecheck`
Expected: 오류 0건.
Run: `npm run lint`
Expected: 오류 0건.
Run: `npm run format:check`
Expected: 지적 없음.
Run: 패키지별 테스트 (`for w in agent-core ai-provider project-store ui docs shell slides pdf hwp sheets; do npm run test -w @genoffice/$w; done`)
Expected: 모두 통과. 엑셀의 기존 Windows `EPERM fsync` 3건은 이름을 기록한다.

- [ ] **Step 2: 드라이버에 홈 카드 경로를 더한다**

`scripts/drivers/driver.hwp-form-fill.mjs`에 `--via-home` 옵션을 추가한다.

- 이 옵션이면 앱을 문서 없이 띄운다.
- 메인 프로세스의 `dialog.showOpenDialog`를 양식 경로를 돌려주도록 바꾼다: `app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, SRC)`.
- 홈에서 `.quick-card` 중 제목이 `양식으로 새 한글 문서`인 카드를 누른다.
- 저장 확인 때는 `dialog.showSaveDialog`를 `{ canceled: false, filePath: <OUT>/<tag>-saved.<ext> }`로 바꾼다.
- 결과에 다음을 넣는다.
  - 원본 SHA-256 (실행 전과 후)
  - 저장 대화상자가 제안한 `defaultPath` (`showSaveDialog` 대체 함수가 받은 인자에서 꺼낸다)
  - 저장 파일의 형식

```js
await app.evaluate(({ dialog }, out) => {
  dialog.showSaveDialog = async (_win, options) => {
    globalThis.__lastSaveDefault = (options ?? _win)?.defaultPath ?? null
    return { canceled: false, filePath: out }
  }
}, savedPath)
// … 저장 뒤
result.saveDefault = await app.evaluate(() => globalThis.__lastSaveDefault)
```

- [ ] **Step 3: 실제 양식 확인 (개발 셸)**

§1의 6개 양식에 같은 요청을 다시 돌린다. 요청 문구는 이 세션의 2026-10-02 확인과 같다.

- 서울시 3종(결재문서본문, 약식보고서, 보고서(계획서))은 `--route=codex`와 `--route=deepseek` 둘 다 돌린다.
- HWP 3.0 3종(품의서, 자동차 매매계약서, 공문)은 DeepSeek으로 돌린다.
- 결재문서본문 하나는 `--via-home`으로 돌린다.

Expected (스펙 §2 성공 기준)

1. `--via-home` 실행에서 원본 SHA-256이 전후 같고, 저장 대화상자 기본 이름이 `결재문서본문_작성.hwpx`이며, 저장 파일이 HWPX다.
2. 결재문서본문: 본문 문구 교체가 적용된다 (편집 요약에 `round-trip check` 줄).
3. 약식보고서: 안내용 표가 지워진다 (`delete_table`).
4. 보고서(계획서) 3쪽: Codex와 DeepSeek 모두 편집이 1건 이상이다. 끝 문구가 "No reply."가 아니다.
5. HWP 3.0 3종: 지금처럼 채워지고 HWP5로 저장된다.

각 실행의 결과(도구 수, 소요 초, 바뀐 줄 수)를 수용 로그 표에 적는다.

- [ ] **Step 4: 문서**

`README.md`에서 한글 모듈 항목(`- Adds a Hangul (`.hwp`/`.hwpx`) module …`) 아래에 추가:

```markdown
- "HWP from a form" on Home opens a copy of any .hwp/.hwpx form you have as a new, untitled document (the form itself is never written to), and the assistant fills it: `form_map` reads every field, table cell and paragraph in one call, `delete_table` removes guidance tables, and forms whose layout the engine cannot round-trip exactly are checked by their field/table/paragraph summary instead.
```

`MODIFICATIONS.md`의 변경 목록에서 thinking box 항목 아래에 추가:

```markdown
- "HWP from a form": Home card → copy of a user form as an untitled Hangul tab (bytes only, 50 MB cap, Save As proposes `<form>_작성`); `form_map` (fields, table cells, paragraphs from `rhwp dump`), `delete_table`, a summary check for forms that fail the engine's save round-trip check, 20 assistant turns and clear end-of-run notes;
```

스펙의 `- 상태: 설계 승인, 구현 전`을 `- 상태: 구현 완료 (날짜) — 계획 docs/superpowers/plans/2026-10-02-hwp-form-fill.md`로 바꾼다.

이 계획 맨 아래에 수용 로그를 만든다.

```markdown
## 수용 로그

| 양식 | 모델 | 도구 수 | 초  | 바뀐 줄 | 결과 | 비고 |
| ---- | ---- | ------- | --- | ------- | ---- | ---- |
```

(실행마다 한 줄. 마지막에 관문 결과와 미검증 항목: macOS, 한컴오피스로 결과 파일 열어 보기는 사용자 눈 확인.)

Run: `npx prettier --write README.md MODIFICATIONS.md docs/superpowers/specs/2026-10-02-hwp-form-fill-design.md docs/superpowers/plans/2026-10-02-hwp-form-fill.md`

- [ ] **Step 5: 설치본 확인**

Run: `npm run dist:win`
Expected: 새 설치 파일.
설치: PowerShell에서 `Start-Process -FilePath 'D:\genoffice\apps\shell\release\OpenGenOffice-…-x64.exe' -ArgumentList '/S','/D=D:\Programs\Open GenOffice' -Wait` (실제 파일 이름으로).
Run: `node scripts/drivers/driver.hwp-form-fill.mjs --via-home --tag=pkg-seoul1 --file=D:/tmp/forms/seoul-1.hwpx --prompt='…결재문서본문 요청…' "D:/Programs/Open GenOffice/Open GenOffice.exe"`
Expected: Step 3의 기준 1·2와 같다.

- [ ] **Step 6: 커밋**

```bash
git add README.md MODIFICATIONS.md docs/superpowers/specs/2026-10-02-hwp-form-fill-design.md docs/superpowers/plans/2026-10-02-hwp-form-fill.md
```

그다음 단독으로:

```bash
git commit -m "docs: HWP from a form — notes and acceptance log" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 사용자 눈 확인 목록

1. 홈의 "양식으로 새 한글 문서" 카드로 내 양식을 열고, AI로 채운 뒤 저장합니다. 저장 대화상자에 `양식이름_작성`이 제안되는지, 원본 양식 파일이 그대로인지 확인해 주세요.
2. 결재문서본문처럼 엔진 검사를 통과하지 못하는 양식에서 AI가 편집한 결과 파일을 **한컴오피스로 열어**, 결재란·칸 배치가 원본과 같게 보이는지 확인해 주세요.
3. 표가 많은 양식에서 AI 패널의 도구 목록에 `form_map`이 먼저 나오고, 칸마다 `find`를 부르지 않는지 봐 주세요.
