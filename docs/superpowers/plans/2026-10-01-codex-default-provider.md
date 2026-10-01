# Codex CLI 기본 AI 구현 계획 (Phase 3 · M1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공식 `codex-app-server`를 설치본에 동봉하고 업스트림 Codex 브리지를 포팅해, ChatGPT 로그인(Codex)을 5개 모듈 공통 기본 AI(`gpt-5.6-luna`)로 만들고 설정 화면에서 로그인·로그아웃·상태를 다루게 한다.

**Architecture:** 메인 프로세스가 동봉된 `codex-app-server --listen stdio://`를 JSON-RPC로 구동한다(업스트림 `codex-app-server.ts`). 대화는 `ai-routing-ipc`에서 codex만 브리지로 분기하고(렌더러 번들에 Node 모듈이 들어가지 않게), 계정은 `account/*` RPC로 관리한다 — 로그인 정보는 Codex가 `~/.codex`에 보관하고 앱은 읽지 않는다. `AiSettingsService`는 Genspark와 같은 특수 분기로 codex를 "로그인 = 구성됨"으로 다룬다.

**Tech Stack:** Electron 41 메인/프리로드/렌더러, TypeScript, vitest 4, electron-builder 26, 공식 Codex `rust-v0.159.3` app-server(Apache-2.0), 업스트림 `genspark-ai/genoffice@676bf4d5`(Apache-2.0).

**Spec:** `docs/superpowers/specs/2026-10-01-codex-multi-provider-design.md` (§5가 M1)

## Global Constraints

- Codex 동봉 버전 `rust-v0.159.3`, 자산과 SHA256(스펙 §2 그대로):
  - win32-x64 `codex-app-server-x86_64-pc-windows-msvc.exe.zip` `abfb74a8765c870674a3ea94b873b861b041dc6e3963f7433cb5b66c300abd64`
  - darwin-arm64 `codex-app-server-aarch64-apple-darwin.tar.gz` `40edf61c2c6b3429541e010409f6934c29327b4d3b03df5265cbf21b35ddbc83`
  - darwin-x64 `codex-app-server-x86_64-apple-darwin.tar.gz` `aa723f184f50d2502820fb89bc70a8dc1f7c92d894dd3f13d27684916ca52049`
- 단독 바이너리 실행 인자 `['--listen','stdio://']`, 전체 CLI(`codex`)는 `['app-server','--listen','stdio://']`.
- 실행 파일 해석 순서: 사용자 지정 경로 → 동봉본 → 업스트림 자동 탐지(관리 경로) → VS Code 확장 `~/.vscode/extensions/openai.chatgpt-*/bin/<plat>/codex[.exe]` → PATH.
- 새 설치 기본 라우트 `{ providerId: 'codex', modelId: 'gpt-5.6-luna' }`. 기존 설정 파일의 `globalDefault`는 바꾸지 않는다. 계정 목록에 `gpt-5.6-luna`가 없을 때만 기본 라우트를 계정 `isDefault` 모델로 바꾼다.
- 로그인 RPC: `account/login/start {type:'chatgpt'}` → `{loginId, authUrl}`; `{type:'chatgptDeviceCode'}` → `{loginId, verificationUrl, userCode}`; `{type:'apiKey', apiKey}`; 완료 알림 `account/login/completed`; `account/login/cancel {loginId}`; `account/logout`; 상태 `account/read {refreshToken:false}` → `{account:{type,email,planType}|null, requiresOpenaiAuth}`.
- **실제 바이너리에 `account/logout`, `account/login/start {type:'apiKey'}`를 호출하는 테스트·드라이버·스크립트를 만들지 않는다.** 계약 테스트의 로그인 시작은 `chatgpt`/`chatgptDeviceCode` 시작 직후 `cancel`만 허용(2026-10-01 스파이크에서 `account/logout` 호출로 실제 로그아웃 사고가 났다).
- 앱은 `~/.codex/auth.json`을 열지 않는다. 렌더러로 가는 계정 정보는 `email`, `planType`, 계정 유형, 바이너리 경로·출처·버전뿐이다.
- `child_process`를 쓰는 모듈(`codex-app-server.ts`, `codex-account.ts`)은 `@genoffice/ai-provider`의 루트 `index.ts`에서 export하지 않는다(렌더러 6곳이 루트를 import한다). 하위 경로 `@genoffice/ai-provider/codex-app-server`로만 노출.
- 코드 스타일: Prettier(semi:false, singleQuote, trailingComma all, printWidth 100), 코드 주석 영어. 커밋 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 테스트를 `| grep`으로 파이프한 `&&` 체인 뒤에 커밋·병합을 잇지 않는다.

## Review Focus

1. Codex 미로그인 상태로 앱을 처음 켠 사용자(새 설치 기본이 codex) — 모델 선택기가 비어도 패널이 막히지 않고 "설정 › AI에서 Codex에 로그인" 안내가 보여야 한다 → Task 5 `assertRouteAvailable` 테스트.
2. 로그인 창을 열어 둔 채 브라우저를 닫거나 10분 방치 — 로그인 대기가 끝나고 카드가 "로그인 필요"로 돌아와야 한다 → Task 3 타임아웃 테스트.
3. 사용자 지정 경로에 존재하지 않는 파일/폴더를 넣음 — 동봉본으로 조용히 바뀌지 말고 오류가 카드에 보여야 한다 → Task 2 해석 테스트.
4. 기존 사용자(설정 파일에 genspark/openai 기본값) — 업데이트 후에도 기본 모델이 그대로여야 한다 → Task 5 테스트.
5. Codex 프로세스가 대화 중 죽음(작업 관리자 종료) — 해당 턴은 오류로 끝나고 다음 요청은 새 프로세스로 회복돼야 한다 → Task 2 (업스트림 `fail` 경로) 테스트.

---

## 파일 구조

| 파일                                                                                                                                                        | 책임                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `tools/fetch-codex.mjs` (신규)                                                                                                                              | 고정 버전 app-server 자산 다운로드·SHA256 검증·압축 해제 → `apps/shell/native/codex/<platform>-<arch>/`, LICENSE/NOTICE |
| `packages/ai-provider/src/watchdog.ts` (업스트림 복사)                                                                                                      | 스트림 유휴/연결 타임아웃                                                                                               |
| `packages/ai-provider/src/protocols/shared.ts` (신규, 업스트림 일부)                                                                                        | `StreamCallbacks`(확장), 도구 예산, `parseToolInput`                                                                    |
| `packages/ai-provider/src/codex-app-server.ts` (업스트림 복사 + 수정)                                                                                       | app-server 클라이언트 풀, 턴, 모델 목록, 실행 파일 해석, `withCodexRpc`                                                 |
| `packages/ai-provider/src/codex-account.ts` (신규)                                                                                                          | 계정 RPC(상태·로그인·취소·로그아웃) + `CodexAccountMonitor` 캐시                                                        |
| `packages/ai-provider/src/{types,providers,stream,index}.ts` (수정)                                                                                         | `codex` id·프로토콜·인증·`cliPath`, 메타, `StreamCallbacks` 이전                                                        |
| `apps/docs/src/shared/ipc.ts` (수정)                                                                                                                        | `PUBLIC_AI_PROVIDER_IDS` + `codex`, `PublicAiProvider.planType?`                                                        |
| `apps/docs/src/main/codex-provider.ts` (신규)                                                                                                               | 프로세스 전역 Codex 공급자(모니터·모델 목록·`cliPath` 보관)·계정 컨트롤러                                               |
| `apps/docs/src/main/{ai-settings-service,ai-catalog-cache,ai-routing-ipc}.ts` (수정)                                                                        | codex 분기, 기본 라우트, 카탈로그, 대화 디스패치                                                                        |
| `apps/{docs,sheets,slides,pdf}/src/main/*-main.ts` (수정)                                                                                                   | 설정 서비스에 codex 공급자 주입, 종료 시 정리                                                                           |
| `apps/shell/src/main/codex-ipc.ts` (신규)                                                                                                                   | `codex:*` IPC(외부 브라우저 열기·확인 대화상자)                                                                         |
| `apps/shell/src/preload/index.ts`, `apps/shell/src/shared/home-api.ts` (수정)                                                                               | Codex API 노출                                                                                                          |
| `apps/shell/src/renderer/src/settings/{codex-card.ts,CodexCard.tsx,AiSettingsModal.tsx,ai-settings-api.ts}`                                                 | 카드 상태 모델(순수)·컴포넌트·모달 배치                                                                                 |
| `apps/shell/electron-builder.cjs`, `.gitignore`, `package.json`, `apps/shell/package.json`, `.github/workflows/ci.yml`, `tools/gen-third-party-notices.mjs` | 패키징·빌드·고지                                                                                                        |
| 테스트                                                                                                                                                      | Task마다 명시                                                                                                           |

---

### Task 1: Codex app-server 동봉 (fetch·패키징·고지)

**Files:**

- Create: `tools/fetch-codex.mjs`
- Modify: `.gitignore`, `package.json`(루트 스크립트), `apps/shell/package.json`(`build:codex`, `build`), `apps/shell/electron-builder.cjs`(mac·win `extraResources`), `apps/shell/tests/updater.test.ts`, `tools/gen-third-party-notices.mjs`, `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `apps/shell/native/codex/<platform>-<arch>/codex-app-server[.exe]`, 같은 폴더의 `LICENSE`·`NOTICE`·`.codex-version`; 설치본 `resources/native/codex-app-server[.exe]`.

- [ ] **Step 1: fetch 스크립트 작성**

`tools/fetch-codex.mjs`:

```js
#!/usr/bin/env node
/**
 * Fetch the official Codex app-server binary (openai/codex, Apache-2.0) at the
 * pinned release, verify it against the SHA-256 recorded below, and unpack it to
 * apps/shell/native/codex/<platform>-<arch>/codex-app-server[.exe] (gitignored),
 * with the project's LICENSE and NOTICE next to it for the installer notices.
 *
 *   node tools/fetch-codex.mjs [--force]
 *
 * The standalone app-server is the only Codex piece the app runs (stdio JSON-RPC:
 * chat turns, model list, account sign-in). Bump VERSION and the digests together;
 * the digests come from the GitHub release API (`assets[].digest`).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const FORCE = process.argv.includes('--force')
const VERSION = '0.159.3'
const TAG = `rust-v${VERSION}`

const ASSETS = {
  'win32-x64': {
    file: 'codex-app-server-x86_64-pc-windows-msvc.exe.zip',
    sha256: 'abfb74a8765c870674a3ea94b873b861b041dc6e3963f7433cb5b66c300abd64',
    exe: 'codex-app-server.exe',
  },
  'darwin-arm64': {
    file: 'codex-app-server-aarch64-apple-darwin.tar.gz',
    sha256: '40edf61c2c6b3429541e010409f6934c29327b4d3b03df5265cbf21b35ddbc83',
    exe: 'codex-app-server',
  },
  'darwin-x64': {
    file: 'codex-app-server-x86_64-apple-darwin.tar.gz',
    sha256: 'aa723f184f50d2502820fb89bc70a8dc1f7c92d894dd3f13d27684916ca52049',
    exe: 'codex-app-server',
  },
}

const target = `${process.platform}-${process.arch}`
const asset = ASSETS[target]
if (!asset) {
  console.error(`codex: no pinned app-server asset for ${target}`)
  process.exit(1)
}

const outDir = join(ROOT, 'apps', 'shell', 'native', 'codex', target)
const exePath = join(outDir, asset.exe)
const stampFile = join(outDir, '.codex-version')
const stamp = JSON.stringify({ version: VERSION, target, sha256: asset.sha256 })
if (
  !FORCE &&
  existsSync(exePath) &&
  existsSync(stampFile) &&
  readFileSync(stampFile, 'utf8') === stamp
) {
  console.log(`codex: up to date (${TAG}, ${target}), skipping — pass --force to refetch`)
  process.exit(0)
}

async function download(url, { optional = false } = {}) {
  const res = await fetch(url, { redirect: 'follow' })
  if (optional && res.status === 404) return null
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** the archives hold one platform-suffixed binary (codex-app-server-<triple>[.exe]) */
function pickBinary(names) {
  const found = names.filter((name) => /^codex-app-server(-[\w-]+)?(\.exe)?$/.test(name))
  if (found.length !== 1)
    throw new Error(`expected one codex-app-server binary, found: ${names.join(', ')}`)
  return found[0]
}

try {
  console.log(`codex: fetching ${asset.file} (${TAG})`)
  const archive = await download(
    `https://github.com/openai/codex/releases/download/${TAG}/${asset.file}`,
  )
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== asset.sha256) {
    throw new Error(`SHA-256 mismatch for ${asset.file}: expected ${asset.sha256}, got ${actual}`)
  }
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  if (asset.file.endsWith('.zip')) {
    const JSZip = require('jszip')
    const zip = await JSZip.loadAsync(archive)
    const files = Object.values(zip.files).filter((entry) => !entry.dir)
    const name = pickBinary(files.map((entry) => entry.name.split('/').pop()))
    const entry = files.find((candidate) => candidate.name.split('/').pop() === name)
    writeFileSync(exePath, await entry.async('nodebuffer'))
  } else {
    const work = mkdtempSync(join(tmpdir(), 'genoffice-codex-'))
    try {
      const archivePath = join(work, asset.file)
      writeFileSync(archivePath, archive)
      const tar = spawnSync('tar', ['-xzf', archivePath, '-C', work], { stdio: 'inherit' })
      if (tar.status !== 0) throw new Error(`tar failed (${tar.status ?? tar.signal})`)
      const name = pickBinary(readdirSync(work).filter((entry) => entry !== asset.file))
      renameSync(join(work, name), exePath)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }
  if (process.platform !== 'win32') chmodSync(exePath, 0o755)
  const raw = `https://raw.githubusercontent.com/openai/codex/${TAG}/`
  writeFileSync(join(outDir, 'LICENSE'), await download(`${raw}LICENSE`))
  const notice = await download(`${raw}NOTICE`, { optional: true })
  if (notice) writeFileSync(join(outDir, 'NOTICE'), notice)
  const check = spawnSync(exePath, ['--help'], { encoding: 'utf8' })
  if (check.status !== 0)
    throw new Error(`${asset.exe} --help exited ${check.status}: ${check.stderr}`)
  writeFileSync(stampFile, stamp)
  console.log(`codex: ${TAG} app-server → ${exePath}`)
} catch (err) {
  console.error(`codex: fetch failed — ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
```

- [ ] **Step 2: 스크립트·무시 규칙**

`.gitignore`의 `/apps/hwp/native/` 아래에 `/apps/shell/native/` 추가.

루트 `package.json` `scripts`에 `"fetch:codex": "node tools/fetch-codex.mjs",` 추가(`fetch:rhwp-cli` 다음 줄).

`apps/shell/package.json` `scripts`:

```json
    "build:codex": "node ../../tools/fetch-codex.mjs",
    "build": "npm run build:codex && electron-vite build",
```

(`dist:win`/`dist:mac`는 루트에서 `build:all`을 먼저 돌리므로 그대로 둔다.)

- [ ] **Step 3: 실행·확인**

Run: `npm run fetch:codex`
Expected: `codex: rust-v0.159.3 app-server → …\apps\shell\native\codex\win32-x64\codex-app-server.exe`, 같은 폴더에 `LICENSE`, `NOTICE`, `.codex-version`. 두 번째 실행은 `up to date … skipping`.

- [ ] **Step 4: 패키징 — 실패 테스트 먼저**

`apps/shell/tests/updater.test.ts`의 `uses an isolated app identity…` 테스트에서 `config.win` 기대값의 `extraResources` 배열 끝에 추가:

```ts
        { from: 'native/codex/win32-x64/codex-app-server.exe', to: 'native/codex-app-server.exe' },
```

`ships the self-hosted HWP studio …` 테스트의 `config.mac` `arrayContaining` 배열에 추가:

```ts
        { from: 'native/codex/darwin-arm64/codex-app-server', to: 'native/codex-app-server' },
```

Run: `npm test -w @genoffice/shell` → 2건 FAIL(새 항목 없음).

- [ ] **Step 5: `electron-builder.cjs`**

`mac.extraResources` 끝에:

```js
      {
        // tools/fetch-codex.mjs — the official Codex app-server (stdio JSON-RPC)
        from: 'native/codex/darwin-arm64/codex-app-server',
        to: 'native/codex-app-server',
      },
```

`win.extraResources` 끝에:

```js
      {
        from: 'native/codex/win32-x64/codex-app-server.exe',
        to: 'native/codex-app-server.exe',
      },
```

Run: `npm test -w @genoffice/shell` → PASS(135). `node -e "const m=require('./apps/shell/build/verify-extra-resources.js');m.default({packager:{config:require('./apps/shell/electron-builder.cjs'),projectDir:'apps/shell'},electronPlatformName:'win32'});console.log('ok')"` → `ok`.

- [ ] **Step 6: 고지·CI**

`tools/gen-third-party-notices.mjs`의 스튜디오 고지 블록(`const studioNotices = …` 단락) 뒤, `const dest = …` 앞에:

```js
// The bundled Codex app-server (tools/fetch-codex.mjs) ships its upstream LICENSE/NOTICE.
const codexDir = join(ROOT, `apps/shell/native/codex/${process.platform}-${process.arch}`)
if (existsSync(join(codexDir, 'LICENSE'))) {
  out += hr('5. OpenAI Codex app-server (openai/codex, Apache-2.0)')
  out += readFileSync(join(codexDir, 'LICENSE'), 'utf8').trim() + '\n'
  if (existsSync(join(codexDir, 'NOTICE')))
    out += '\n' + readFileSync(join(codexDir, 'NOTICE'), 'utf8').trim() + '\n'
} else {
  console.warn(`${codexDir}/LICENSE not found — run npm run fetch:codex first`)
}
```

`.github/workflows/ci.yml`의 `Fetch rhwp CLI` 단계 뒤에:

```yaml
- name: Fetch Codex app-server (bundled AI backend)
  # Exercises tools/fetch-codex.mjs: pinned release asset + SHA-256 check.
  run: npm run fetch:codex
```

Run: `npm run notices` → 출력에 경고 없음, `apps/shell/build/THIRD-PARTY-NOTICES.txt`에 `5. OpenAI Codex app-server` 절.

- [ ] **Step 7: 커밋**

```bash
git add tools/fetch-codex.mjs .gitignore package.json apps/shell/package.json apps/shell/electron-builder.cjs apps/shell/tests/updater.test.ts tools/gen-third-party-notices.mjs .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
shell: bundle the official Codex app-server as a verified native resource

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 업스트림 Codex 브리지 포팅 + 실행 파일 해석 확장

**Files:**

- Create (업스트림 복사): `packages/ai-provider/src/watchdog.ts`, `packages/ai-provider/src/codex-app-server.ts`, `packages/ai-provider/tests/codex-app-server.test.ts`, `packages/ai-provider/tests/codex-stdout-lines.test.ts`
- Create: `packages/ai-provider/src/protocols/shared.ts`, `packages/ai-provider/tests/codex-resolution.test.ts`
- Modify: `packages/ai-provider/src/types.ts`, `packages/ai-provider/src/stream.ts:26-30`, `packages/ai-provider/package.json`(`exports`)

**Interfaces:**

- Produces (`@genoffice/ai-provider/codex-app-server`):
  - 업스트림 그대로: `streamCodexAppServer(config, system, messages, tools, maxTokens, cb): Promise<void>`, `chatCodexAppServer(config, system, user, signal): Promise<AiChatResponse>`, `listCodexModels(cliPath?): Promise<CodexModelCatalog>`, `shutdownCodexAppServers(): void`, `type RpcMessage`.
  - 신규: `type CodexBinarySource = 'custom' | 'bundled' | 'managed' | 'vscode' | 'path'`, `interface ResolvedCodexBinary { path: string; source: CodexBinarySource }`, `resolveCodexBinary(configuredPath?, options?): Promise<ResolvedCodexBinary>`, `setBundledCodexPath(path: string | undefined): void`, `codexAppServerLaunchArgs(cliPath?: string): string[]`, `interface CodexRpc { request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>; onNotification(listener: (message: RpcMessage) => void): () => void; readonly userAgent: string }`, `withCodexRpc<T>(cliPath: string | undefined, action: (rpc: CodexRpc) => Promise<T>): Promise<T>`.
- Produces (`types.ts`): `AiProviderConfig.cliPath?: string | undefined`, `interface CodexModelCatalog { models: string[]; defaultModel: string }`.
- Produces (`protocols/shared.ts`): `StreamCallbacks { onDelta; onToolCall; signal; onReasoningDelta?; onStopReason?; onActivity?; sessionId? }`, `MAX_TOOL_JSON_CHARS`, `MAX_STREAM_TOOL_CALLS`, `throwIfToolJsonOverBudget`, `throwIfToolCountOverBudget`, `parseToolInput`, `isPlainObject`.

- [ ] **Step 1: 업스트림 원격 확인**

Run: `git remote get-url upstream || git remote add upstream https://github.com/genspark-ai/genoffice.git; git fetch upstream; git cat-file -t 676bf4d5`
Expected: `commit`.

- [ ] **Step 2: 업스트림 파일 복사**

```bash
git show 676bf4d5:packages/ai-provider/src/watchdog.ts > packages/ai-provider/src/watchdog.ts
git show 676bf4d5:packages/ai-provider/src/codex-app-server.ts > packages/ai-provider/src/codex-app-server.ts
git show 676bf4d5:packages/ai-provider/tests/codex-app-server.test.ts > packages/ai-provider/tests/codex-app-server.test.ts
git show 676bf4d5:packages/ai-provider/tests/codex-stdout-lines.test.ts > packages/ai-provider/tests/codex-stdout-lines.test.ts
```

각 파일 맨 위(첫 import 앞)에 출처 주석 한 줄을 넣는다:

```ts
// Ported from genspark-ai/genoffice@676bf4d5 (Apache-2.0); see docs/upstream-provenance.md.
```

- [ ] **Step 3: `protocols/shared.ts` (업스트림의 필요한 부분만)**

`packages/ai-provider/src/protocols/shared.ts`:

```ts
// Subset of genspark-ai/genoffice@676bf4d5 packages/ai-provider/src/protocols/shared.ts (Apache-2.0):
// the stream callback contract and tool-call budgets the Codex bridge depends on.
import type { AgentToolCall } from '@genoffice/agent-core'

/**
 * Max chars buffered for one streamed tool call's arguments; a provider that keeps
 * streaming fragments without finishing would otherwise grow the buffer unbounded.
 */
export const MAX_TOOL_JSON_CHARS = 512_000

export function throwIfToolJsonOverBudget(jsonLength: number, provider: string): void {
  if (jsonLength > MAX_TOOL_JSON_CHARS) {
    throw new Error(
      `Tool call arguments exceeded the ${provider} buffer limit (${jsonLength} chars, cap ${MAX_TOOL_JSON_CHARS}); ` +
        'the provider kept streaming argument fragments without finishing. Ask for the output in several smaller parts.',
    )
  }
}

/** Max tool calls started per streamed turn. */
export const MAX_STREAM_TOOL_CALLS = 100

export function throwIfToolCountOverBudget(count: number, provider: string): void {
  if (count > MAX_STREAM_TOOL_CALLS) {
    throw new Error(
      `Too many streamed tool calls (${count}, cap ${MAX_STREAM_TOOL_CALLS}) for ${provider}; ` +
        'the provider kept starting tool calls without finishing the turn.',
    )
  }
}

export interface StreamCallbacks {
  onDelta: (text: string) => void
  onToolCall: (call: AgentToolCall) => void
  /** raw model reasoning deltas (reasoning_content) */
  onReasoningDelta?: (text: string) => void
  /** normalized stop reason ('max_tokens' when the output was cut off by the token limit) */
  onStopReason?: (reason: string) => void
  /** bytes arrived on the wire (keepalive for the stream watchdog) */
  onActivity?: () => void
  /** Stable conversation id for providers with native sessions (Codex threads). */
  sessionId?: string
  signal: AbortSignal
}

/**
 * Models occasionally emit unescaped " inside string values (e.g. English quotes in Chinese copy).
 * Single-pass scan: a " inside a string whose next non-whitespace char is not structural gets escaped.
 */
function repairUnescapedQuotes(json: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < json.length; i++) {
    const c = json[i]!
    if (!inStr) {
      if (c === '"') inStr = true
      out += c
      continue
    }
    if (c === '\\') {
      out += c + (json[++i] ?? '')
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < json.length && ' \n\r\t'.includes(json[j]!)) j++
      const next = json[j]
      if (next === undefined || ',}]:'.includes(next)) {
        inStr = false
        out += c
      } else {
        out += '\\"'
      }
      continue
    }
    out += c
  }
  return out
}

export function parseToolInput(json: string): { input: Record<string, unknown>; error?: string } {
  if (!json.trim()) return { input: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    try {
      parsed = JSON.parse(repairUnescapedQuotes(json))
    } catch {
      const msg = e instanceof Error ? e.message : String(e)
      return { input: {}, error: `${msg}; raw: ${json.slice(0, 500)}` }
    }
  }
  if (!isPlainObject(parsed)) {
    return { input: {}, error: `tool input must be a JSON object; raw: ${json.slice(0, 500)}` }
  }
  return { input: parsed }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

`packages/ai-provider/src/stream.ts`의 `export interface StreamCallbacks { … }`(26~30행) 블록을 삭제하고 그 자리에:

```ts
import type { StreamCallbacks } from './protocols/shared'
export type { StreamCallbacks } from './protocols/shared'
```

(같은 파일 상단 import 묶음으로 옮겨도 된다. `index.ts`의 `export type { StreamCallbacks } from './stream'`은 그대로 동작한다.)

- [ ] **Step 4: 타입**

`packages/ai-provider/src/types.ts`의 `AiProviderConfig`에 필드 추가:

```ts
  /** Codex only: custom codex/codex-app-server executable; empty uses the bundled binary */
  cliPath?: string | undefined
```

같은 파일 끝에:

```ts
/** live model list of the signed-in Codex account (app-server model/list) */
export interface CodexModelCatalog {
  models: string[]
  defaultModel: string
}
```

`packages/ai-provider/package.json`의 `exports`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./codex-app-server": "./src/codex-app-server.ts",
    "./codex-account": "./src/codex-account.ts"
  },
```

(`codex-account.ts`는 Task 3에서 만든다. 지금 경로만 미리 연다.)

- [ ] **Step 5: 업스트림 테스트가 그대로 통과하는지 확인**

Run: `cd packages/ai-provider && npx vitest run tests/codex-app-server.test.ts tests/codex-stdout-lines.test.ts` 와 `npx tsc --noEmit`
Expected: 두 파일 PASS, 타입 오류 0. 실패하면 누락된 의존(업스트림 `types.ts`의 필드 등)을 이 Task 범위에서 최소로 추가한다 — 업스트림 동작을 바꾸지 않는다.

- [ ] **Step 6: 새 동작 테스트 작성**

`packages/ai-provider/tests/codex-resolution.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chatCodexAppServer,
  codexAppServerLaunchArgs,
  resolveCodexBinary,
  setBundledCodexPath,
} from '../src/codex-app-server'

const dirs: string[] = []
async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  setBundledCodexPath(undefined)
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('resolveCodexBinary', () => {
  it('uses an existing custom path first and reports it as custom', async () => {
    const dir = await scratch('codex-custom-')
    const custom = join(dir, 'codex.exe')
    await writeFile(custom, '')
    setBundledCodexPath(join(dir, 'bundled.exe'))
    await expect(resolveCodexBinary(custom, { platform: 'win32', env: {} })).resolves.toEqual({
      path: custom,
      source: 'custom',
    })
  })

  it('fails loudly for a custom path that does not exist instead of silently using another Codex', async () => {
    const dir = await scratch('codex-missing-')
    const bundled = join(dir, 'codex-app-server.exe')
    await writeFile(bundled, '')
    setBundledCodexPath(bundled)
    await expect(
      resolveCodexBinary(join(dir, 'nope', 'codex.exe'), { platform: 'win32', env: {} }),
    ).rejects.toThrow(/Codex executable not found: .*nope/)
  })

  it('prefers the bundled app-server over desktop, VS Code and PATH installs', async () => {
    const dir = await scratch('codex-bundled-')
    const bundled = join(dir, 'codex-app-server.exe')
    await writeFile(bundled, '')
    const onPath = join(dir, 'pathbin')
    await mkdir(onPath)
    await writeFile(join(onPath, 'codex.exe'), '')
    setBundledCodexPath(bundled)
    await expect(
      resolveCodexBinary('', { platform: 'win32', env: { PATH: onPath } }),
    ).resolves.toEqual({ path: bundled, source: 'bundled' })
  })

  it('finds the newest VS Code extension codex when nothing is bundled', async () => {
    const home = await scratch('codex-home-')
    const ext = join(home, '.vscode', 'extensions')
    for (const version of ['26.917.62051', '26.928.31416']) {
      const bin = join(ext, `openai.chatgpt-${version}-win32-x64`, 'bin', 'windows-x86_64')
      await mkdir(bin, { recursive: true })
      await writeFile(join(bin, 'codex.exe'), '')
    }
    await mkdir(join(ext, 'ms-python.python-2026.1.0'), { recursive: true })
    await expect(
      resolveCodexBinary('', {
        platform: 'win32',
        env: { USERPROFILE: home },
        managedInstallRoot: join(home, 'none'),
      }),
    ).resolves.toEqual({
      path: join(
        ext,
        'openai.chatgpt-26.928.31416-win32-x64',
        'bin',
        'windows-x86_64',
        'codex.exe',
      ),
      source: 'vscode',
    })
  })

  it('explains what to do when no Codex can be found', async () => {
    const home = await scratch('codex-empty-')
    await expect(
      resolveCodexBinary('', {
        platform: 'win32',
        env: { USERPROFILE: home },
        managedInstallRoot: join(home, 'none'),
      }),
    ).rejects.toThrow(/Codex/)
  })
})

describe('codexAppServerLaunchArgs', () => {
  it('runs the standalone app-server directly and the full CLI through its subcommand', () => {
    expect(codexAppServerLaunchArgs('C:\\x\\codex-app-server.exe')).toEqual([
      '--listen',
      'stdio://',
    ])
    expect(codexAppServerLaunchArgs('/opt/codex/codex-app-server')).toEqual([
      '--listen',
      'stdio://',
    ])
    expect(codexAppServerLaunchArgs('/usr/local/bin/codex')).toEqual([
      'app-server',
      '--listen',
      'stdio://',
    ])
    expect(codexAppServerLaunchArgs()).toEqual(['app-server', '--listen', 'stdio://'])
  })
})

describe('process failure', () => {
  it('fails the request when the app-server process dies and starts a fresh one next time', async () => {
    // node rejects the unknown `app-server` script argument and exits at once — a
    // stand-in for a Codex process that crashes or is killed mid-conversation
    const config = { apiKey: '', model: '', cliPath: process.execPath }
    const signal = new AbortController().signal
    await expect(chatCodexAppServer(config, 'sys', 'hi', signal)).rejects.toThrow(
      /Codex app-server exited/,
    )
    // a stale closed client would answer "is not running"; a fresh spawn exits again
    await expect(chatCodexAppServer(config, 'sys', 'hi', signal)).rejects.toThrow(
      /Codex app-server exited/,
    )
  }, 20_000)
})
```

Run: `cd packages/ai-provider && npx vitest run tests/codex-resolution.test.ts`
Expected: FAIL — `resolveCodexBinary`/`setBundledCodexPath` export 없음, 실행 인자 기대 불일치.

- [ ] **Step 7: `codex-app-server.ts` 수정 (업스트림 복사본 위에서)**

(a) `interface CodexCliResolutionOptions`를 다음으로 교체:

```ts
interface CodexCliResolutionOptions {
  /** Override used by tests and portable distributions with the desktop bin tree elsewhere. */
  managedInstallRoot?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  platform?: NodeJS.Platform | undefined
  /** Overrides the process-wide bundled binary (setBundledCodexPath). */
  bundledPath?: string | undefined
}

export type CodexBinarySource = 'custom' | 'bundled' | 'managed' | 'vscode' | 'path'

export interface ResolvedCodexBinary {
  path: string
  source: CodexBinarySource
}

/** The app ships its own tested codex-app-server; main sets its path once at startup. */
let bundledCodexPath: string | undefined

export function setBundledCodexPath(path: string | undefined): void {
  bundledCodexPath = path?.trim() || undefined
}

function versionKey(name: string): number[] {
  return (/-(\d+)\.(\d+)\.(\d+)/.exec(name)?.slice(1) ?? ['0', '0', '0']).map(Number)
}

/** The VS Code Codex extension (openai.chatgpt) carries a full codex CLI under bin/<platform>/. */
async function newestVsCodeCodex(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const home = env.USERPROFILE ?? env.HOME
  if (!home) return null
  const root = join(home, '.vscode', 'extensions')
  const entries = (await readdir(root).catch(() => [] as string[])).filter((name) =>
    /^openai\.chatgpt-\d/.test(name),
  )
  entries.sort((a, b) => {
    const [x, y] = [versionKey(a), versionKey(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i]! - x[i]!
    return b.localeCompare(a)
  })
  const executable = platform === 'win32' ? 'codex.exe' : 'codex'
  for (const entry of entries) {
    const bin = join(root, entry, 'bin')
    for (const sub of await readdir(bin).catch(() => [] as string[])) {
      const candidate = join(bin, sub, executable)
      if (await fileExists(candidate)) return candidate
    }
  }
  return null
}
```

(b) 업스트림 `resolveCodexCliPath` 함수 전체를 다음 두 함수로 교체:

```ts
/**
 * Resolve which Codex to run, in order: a custom path the user set (which must
 * exist — a typo must not silently switch to another install), the bundled
 * app-server, the desktop-managed install (a saved path inside that tree is
 * treated as automatic and upgraded to the newest complete installation), the
 * VS Code extension's CLI, then PATH.
 */
export async function resolveCodexBinary(
  configuredPath?: string,
  options: CodexCliResolutionOptions = {},
): Promise<ResolvedCodexBinary> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const managedRoot = options.managedInstallRoot ?? managedCodexRoot(platform, env)
  const configured = cleanCliPath(configuredPath)

  if (configured) {
    const configuredExecutable =
      isAbsolute(configured) && (await stat(configured).catch(() => null))?.isDirectory()
        ? join(configured, platform === 'win32' ? 'codex.exe' : 'codex')
        : configured
    const managed =
      managedRoot && isAbsolute(configuredExecutable)
        ? isInside(configuredExecutable, managedRoot, platform)
        : false
    if (!managed) {
      if (!isAbsolute(configuredExecutable)) return { path: configuredExecutable, source: 'custom' }
      if (await fileExists(configuredExecutable))
        return { path: configuredExecutable, source: 'custom' }
      throw new Error(`Codex executable not found: ${configuredExecutable}`)
    }
  }

  const bundled = options.bundledPath ?? bundledCodexPath
  if (bundled && (await fileExists(bundled))) return { path: bundled, source: 'bundled' }
  if (managedRoot) {
    const managed = await newestManagedCodex(managedRoot, platform)
    if (managed) return { path: managed, source: 'managed' }
  }
  const vscode = await newestVsCodeCodex(env, platform)
  if (vscode) return { path: vscode, source: 'vscode' }
  const fromPath = await codexOnPath(platform, env)
  if (fromPath) return { path: fromPath, source: 'path' }
  throw new Error(
    'Codex was not found: the bundled app-server is missing and no Codex app, VS Code extension or codex on PATH was found. Reinstall Open GenOffice or set a custom Codex path in Settings › AI.',
  )
}

/** Upstream-compatible path-only form. */
export async function resolveCodexCliPath(
  configuredPath?: string,
  options: CodexCliResolutionOptions = {},
): Promise<string> {
  return (await resolveCodexBinary(configuredPath, options)).path
}
```

(c) `codexAppServerLaunchArgs`를 교체:

```ts
/** The standalone codex-app-server takes the transport directly; the full CLI needs its subcommand. */
export function codexAppServerLaunchArgs(cliPath?: string): string[] {
  const name = (cliPath ?? '').split(/[\\/]/).pop() ?? ''
  return /^codex-app-server/i.test(name)
    ? ['--listen', 'stdio://']
    : ['app-server', '--listen', 'stdio://']
}
```

(d) `CodexAppServerClient` 생성자의 `spawn(cliPath, codexAppServerLaunchArgs(), {` → `spawn(cliPath, codexAppServerLaunchArgs(cliPath), {`.

(e) 같은 클래스에 initialize 응답의 userAgent 보관 — 필드 선언부에 `private userAgentValue = ''` 추가, `initialize()`를 다음으로 교체:

```ts
  private async initialize(): Promise<void> {
    const result = await this.requestWire('initialize', {
      clientInfo: { name: 'genoffice', title: 'GenOffice', version: '0.1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    })
    const userAgent = (result as { userAgent?: unknown } | null)?.userAgent
    if (typeof userAgent === 'string') this.userAgentValue = userAgent
    this.notify('initialized')
  }

  /** e.g. "genoffice/0.159.3 (Windows 10.0.19045; x86_64) …" — the first token carries the Codex version */
  get userAgent(): string {
    return this.userAgentValue
  }
```

(f) 파일 끝(`listCodexModels` 뒤)에:

```ts
/** The slice of the app-server client the account module needs (tests pass fakes). */
export interface CodexRpc {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  onNotification(listener: (message: RpcMessage) => void): () => void
  readonly userAgent: string
}

/** Run account RPCs on the shared app-server process for this Codex binary. */
export async function withCodexRpc<T>(
  cliPath: string | undefined,
  action: (rpc: CodexRpc) => Promise<T>,
): Promise<T> {
  return withClient(cliPath, (client) => action(client))
}
```

- [ ] **Step 8: 통과 확인**

Run: `cd packages/ai-provider && npx vitest run && npx tsc --noEmit`
Expected: 기존 + codex 3파일 전부 PASS, 타입 오류 0.

- [ ] **Step 9: 커밋**

```bash
git add packages/ai-provider
git commit -m "$(cat <<'EOF'
ai-provider: port the upstream Codex app-server bridge

Copies codex-app-server.ts, watchdog.ts and their tests from
genspark-ai/genoffice@676bf4d5 (Apache-2.0) with the stream-callback
subset of protocols/shared.ts. Resolution now prefers a custom path
(which must exist), then the bundled app-server, the desktop install,
the VS Code extension's CLI and PATH, and the standalone app-server is
launched without the CLI subcommand.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Codex 계정 모듈 (상태·로그인·로그아웃·캐시)

**Files:**

- Create: `packages/ai-provider/src/codex-account.ts`
- Test: `packages/ai-provider/tests/codex-account.test.ts`

**Interfaces:**

- Consumes: `CodexRpc`, `RpcMessage` (Task 2).
- Produces:
  - `type CodexAccountStatus = { state: 'connected'; accountType: string; email?: string; planType?: string } | { state: 'signed-out' } | { state: 'error'; message: string }`
  - `type CodexLoginMethod = 'chatgpt' | 'chatgptDeviceCode'`
  - `type CodexLoginStart = { method: 'chatgpt'; loginId: string; authUrl: string } | { method: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }`
  - `interface CodexLoginOutcome { success: boolean; error?: string }`
  - `readCodexAccount(rpc): Promise<CodexAccountStatus>`, `startCodexLogin(rpc, method): Promise<CodexLoginStart>`, `waitForCodexLogin(rpc, loginId, timeoutMs = CODEX_LOGIN_TIMEOUT_MS): Promise<CodexLoginOutcome>`, `cancelCodexLogin(rpc, loginId): Promise<void>`, `loginCodexWithApiKey(rpc, apiKey): Promise<void>`, `logoutCodex(rpc): Promise<void>`, `codexVersionFromUserAgent(userAgent: string): string | null`, `CODEX_LOGIN_TIMEOUT_MS = 600_000`
  - `class CodexAccountMonitor { constructor(read: () => Promise<CodexAccountStatus>, options?: { ttlMs?: number; now?: () => number }); snapshot(): CodexAccountStatus | null; isConnected(): boolean; current(): Promise<CodexAccountStatus>; refresh(): Promise<CodexAccountStatus>; invalidate(): void }` (기본 TTL 300,000 ms)

- [ ] **Step 1: 실패 테스트**

`packages/ai-provider/tests/codex-account.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexRpc, RpcMessage } from '../src/codex-app-server'
import {
  CodexAccountMonitor,
  cancelCodexLogin,
  codexVersionFromUserAgent,
  loginCodexWithApiKey,
  logoutCodex,
  readCodexAccount,
  startCodexLogin,
  waitForCodexLogin,
} from '../src/codex-account'

/** scripted RPC: answers by method, records every call, lets the test push notifications */
function fakeRpc(answers: Record<string, unknown | ((params: unknown) => unknown)>) {
  const calls: Array<{ method: string; params: unknown }> = []
  const listeners = new Set<(message: RpcMessage) => void>()
  const rpc: CodexRpc & {
    calls: typeof calls
    push(message: RpcMessage): void
    listenerCount(): number
  } = {
    calls,
    userAgent: 'genoffice/0.159.3 (Windows 10.0.19045; x86_64)',
    async request(method, params) {
      calls.push({ method, params })
      if (!(method in answers)) throw new Error(`unexpected ${method}`)
      const answer = answers[method]
      return typeof answer === 'function' ? (answer as (p: unknown) => unknown)(params) : answer
    },
    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    push(message) {
      for (const listener of [...listeners]) listener(message)
    },
    listenerCount: () => listeners.size,
  }
  return rpc
}

afterEach(() => {
  vi.useRealTimers()
})

describe('readCodexAccount', () => {
  it('reports a ChatGPT sign-in with email and plan, never asking Codex to refresh tokens', async () => {
    const rpc = fakeRpc({
      'account/read': {
        account: { type: 'chatgpt', email: 'a@b.com', planType: 'prolite' },
        requiresOpenaiAuth: true,
      },
    })
    await expect(readCodexAccount(rpc)).resolves.toEqual({
      state: 'connected',
      accountType: 'chatgpt',
      email: 'a@b.com',
      planType: 'prolite',
    })
    expect(rpc.calls).toEqual([{ method: 'account/read', params: { refreshToken: false } }])
  })

  it('reports signed-out when Codex has no account', async () => {
    const rpc = fakeRpc({ 'account/read': { account: null, requiresOpenaiAuth: true } })
    await expect(readCodexAccount(rpc)).resolves.toEqual({ state: 'signed-out' })
  })

  it('keeps an API-key sign-in connected even without an email', async () => {
    const rpc = fakeRpc({ 'account/read': { account: { type: 'apiKey' } } })
    await expect(readCodexAccount(rpc)).resolves.toEqual({
      state: 'connected',
      accountType: 'apiKey',
    })
  })
})

describe('sign-in', () => {
  it('starts the browser flow and the device-code flow with their URLs', async () => {
    const rpc = fakeRpc({
      'account/login/start': (params) =>
        (params as { type: string }).type === 'chatgpt'
          ? { type: 'chatgpt', loginId: 'L1', authUrl: 'https://auth.openai.com/oauth/x' }
          : {
              type: 'chatgptDeviceCode',
              loginId: 'L2',
              verificationUrl: 'https://auth.openai.com/codex/device',
              userCode: 'ABCD-1234',
            },
    })
    await expect(startCodexLogin(rpc, 'chatgpt')).resolves.toEqual({
      method: 'chatgpt',
      loginId: 'L1',
      authUrl: 'https://auth.openai.com/oauth/x',
    })
    await expect(startCodexLogin(rpc, 'chatgptDeviceCode')).resolves.toEqual({
      method: 'chatgptDeviceCode',
      loginId: 'L2',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    })
  })

  it('rejects a start response without the fields the UI needs', async () => {
    const rpc = fakeRpc({ 'account/login/start': { loginId: 'L1' } })
    await expect(startCodexLogin(rpc, 'chatgpt')).rejects.toThrow(/authUrl/)
  })

  it('resolves on the matching login/completed notification and ignores other logins', async () => {
    const rpc = fakeRpc({})
    const outcome = waitForCodexLogin(rpc, 'L1', 60_000)
    rpc.push({ method: 'account/login/completed', params: { loginId: 'OTHER', success: false } })
    rpc.push({ method: 'account/updated', params: {} })
    rpc.push({ method: 'account/login/completed', params: { loginId: 'L1', success: true } })
    await expect(outcome).resolves.toEqual({ success: true })
    expect(rpc.listenerCount()).toBe(0)
  })

  it('reports a failed sign-in with its error', async () => {
    const rpc = fakeRpc({})
    const outcome = waitForCodexLogin(rpc, 'L1', 60_000)
    rpc.push({
      method: 'account/login/completed',
      params: { loginId: 'L1', success: false, error: 'denied' },
    })
    await expect(outcome).resolves.toEqual({ success: false, error: 'denied' })
  })

  it('gives up after the timeout (browser closed, user walked away)', async () => {
    vi.useFakeTimers()
    const rpc = fakeRpc({})
    const outcome = waitForCodexLogin(rpc, 'L1', 600_000)
    await vi.advanceTimersByTimeAsync(600_000)
    await expect(outcome).resolves.toEqual({ success: false, error: 'Sign-in timed out' })
    expect(rpc.listenerCount()).toBe(0)
  })

  it('cancels, signs in with an API key, and signs out through the matching RPCs', async () => {
    const rpc = fakeRpc({
      'account/login/cancel': { status: 'canceled' },
      'account/login/start': {},
      'account/logout': {},
    })
    await cancelCodexLogin(rpc, 'L1')
    await loginCodexWithApiKey(rpc, '  sk-test  ')
    await logoutCodex(rpc)
    expect(rpc.calls).toEqual([
      { method: 'account/login/cancel', params: { loginId: 'L1' } },
      { method: 'account/login/start', params: { type: 'apiKey', apiKey: 'sk-test' } },
      { method: 'account/logout', params: {} },
    ])
    await expect(loginCodexWithApiKey(rpc, '   ')).rejects.toThrow(/API key/)
  })
})

describe('codexVersionFromUserAgent', () => {
  it('reads the Codex version from the app-server user agent', () => {
    expect(codexVersionFromUserAgent('genoffice/0.159.3 (Windows 10.0.19045; x86_64) xterm')).toBe(
      '0.159.3',
    )
    expect(codexVersionFromUserAgent('')).toBeNull()
  })
})

describe('CodexAccountMonitor', () => {
  it('caches a status for the TTL, dedupes concurrent refreshes and refreshes after invalidate', async () => {
    let now = 0
    const read = vi.fn(async () => ({ state: 'connected' as const, accountType: 'chatgpt' }))
    const monitor = new CodexAccountMonitor(read, { ttlMs: 1000, now: () => now })
    expect(monitor.snapshot()).toBeNull()
    expect(monitor.isConnected()).toBe(false)
    await Promise.all([monitor.current(), monitor.current()])
    expect(read).toHaveBeenCalledTimes(1)
    expect(monitor.isConnected()).toBe(true)
    now = 500
    await monitor.current()
    expect(read).toHaveBeenCalledTimes(1)
    now = 1500
    await monitor.current()
    expect(read).toHaveBeenCalledTimes(2)
    monitor.invalidate()
    await monitor.current()
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('turns a failing read into an error status instead of throwing', async () => {
    const monitor = new CodexAccountMonitor(async () => {
      throw new Error('Codex executable not found: C:\\x\\codex.exe')
    })
    await expect(monitor.refresh()).resolves.toEqual({
      state: 'error',
      message: 'Codex executable not found: C:\\x\\codex.exe',
    })
    expect(monitor.isConnected()).toBe(false)
  })
})
```

Run: `cd packages/ai-provider && npx vitest run tests/codex-account.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: 구현**

`packages/ai-provider/src/codex-account.ts`:

```ts
import type { CodexRpc } from './codex-app-server'

/**
 * Codex account RPCs (app-server `account/*`). Codex owns the credentials in
 * ~/.codex; this module only reads the account summary (type, email, plan) and
 * drives sign-in/sign-out. Nothing here reads auth.json or returns a token.
 */

export type CodexAccountStatus =
  | { state: 'connected'; accountType: string; email?: string; planType?: string }
  | { state: 'signed-out' }
  | { state: 'error'; message: string }

export type CodexLoginMethod = 'chatgpt' | 'chatgptDeviceCode'

export type CodexLoginStart =
  | { method: 'chatgpt'; loginId: string; authUrl: string }
  | { method: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }

export interface CodexLoginOutcome {
  success: boolean
  error?: string
}

/** A browser sign-in left open is abandoned after ten minutes. */
export const CODEX_LOGIN_TIMEOUT_MS = 600_000

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export async function readCodexAccount(rpc: CodexRpc): Promise<CodexAccountStatus> {
  const result = record(await rpc.request('account/read', { refreshToken: false }))
  const account = record(result?.account)
  if (!account) return { state: 'signed-out' }
  const email = text(account.email)
  const planType = text(account.planType)
  return {
    state: 'connected',
    accountType: text(account.type) ?? 'unknown',
    ...(email ? { email } : {}),
    ...(planType ? { planType } : {}),
  }
}

export async function startCodexLogin(
  rpc: CodexRpc,
  method: CodexLoginMethod,
): Promise<CodexLoginStart> {
  const result = record(await rpc.request('account/login/start', { type: method }))
  const loginId = text(result?.loginId)
  if (!loginId) throw new Error('Codex did not start a sign-in (no loginId)')
  if (method === 'chatgpt') {
    const authUrl = text(result?.authUrl)
    if (!authUrl) throw new Error('Codex did not return a sign-in authUrl')
    return { method, loginId, authUrl }
  }
  const verificationUrl = text(result?.verificationUrl)
  const userCode = text(result?.userCode)
  if (!verificationUrl || !userCode) throw new Error('Codex did not return a device code')
  return { method, loginId, verificationUrl, userCode }
}

export function waitForCodexLogin(
  rpc: CodexRpc,
  loginId: string,
  timeoutMs = CODEX_LOGIN_TIMEOUT_MS,
): Promise<CodexLoginOutcome> {
  return new Promise((resolve) => {
    let unsubscribe = (): void => undefined
    const finish = (outcome: CodexLoginOutcome) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(outcome)
    }
    const timer = setTimeout(
      () => finish({ success: false, error: 'Sign-in timed out' }),
      timeoutMs,
    )
    unsubscribe = rpc.onNotification((message) => {
      if (message.method !== 'account/login/completed') return
      const params = record(message.params)
      const id = text(params?.loginId)
      if (id && id !== loginId) return
      finish(
        params?.success === false
          ? { success: false, error: text(params.error) ?? 'Sign-in failed' }
          : { success: true },
      )
    })
  })
}

export async function cancelCodexLogin(rpc: CodexRpc, loginId: string): Promise<void> {
  await rpc.request('account/login/cancel', { loginId })
}

/** Signs Codex in with an OpenAI API key instead of a ChatGPT account (replaces the current sign-in). */
export async function loginCodexWithApiKey(rpc: CodexRpc, apiKey: string): Promise<void> {
  const key = apiKey.trim()
  if (!key) throw new Error('An OpenAI API key is required')
  await rpc.request('account/login/start', { type: 'apiKey', apiKey: key })
}

/** Signs Codex out on this computer — the Codex app and VS Code extension share this sign-in. */
export async function logoutCodex(rpc: CodexRpc): Promise<void> {
  await rpc.request('account/logout', {})
}

export function codexVersionFromUserAgent(userAgent: string): string | null {
  return /\/(\d+\.\d+\.\d+)/.exec(userAgent)?.[1] ?? null
}

/**
 * Cached account status for synchronous "is Codex configured?" checks in the
 * settings service; async callers use current(), which refreshes after the TTL.
 */
export class CodexAccountMonitor {
  private last: { status: CodexAccountStatus; at: number } | null = null
  private inflight: Promise<CodexAccountStatus> | null = null
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(
    private readonly read: () => Promise<CodexAccountStatus>,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? 300_000
    this.now = options.now ?? Date.now
  }

  snapshot(): CodexAccountStatus | null {
    return this.last?.status ?? null
  }

  isConnected(): boolean {
    return this.last?.status.state === 'connected'
  }

  current(): Promise<CodexAccountStatus> {
    if (this.last && this.now() - this.last.at < this.ttlMs)
      return Promise.resolve(this.last.status)
    return this.refresh()
  }

  refresh(): Promise<CodexAccountStatus> {
    if (this.inflight) return this.inflight
    this.inflight = this.read()
      .catch((err: unknown): CodexAccountStatus => ({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      }))
      .then((status) => {
        this.last = { status, at: this.now() }
        return status
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  invalidate(): void {
    this.last = null
  }
}
```

- [ ] **Step 3: 통과 확인·커밋**

Run: `cd packages/ai-provider && npx vitest run tests/codex-account.test.ts && npx tsc --noEmit` → PASS(12), 오류 0.

```bash
git add packages/ai-provider/src/codex-account.ts packages/ai-provider/tests/codex-account.test.ts
git commit -m "$(cat <<'EOF'
ai-provider: Codex account status, sign-in and sign-out over app-server RPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `codex` 프로바이더 등록과 대화 디스패치

**Files:**

- Modify: `packages/ai-provider/src/types.ts`, `packages/ai-provider/src/providers.ts`, `packages/ai-provider/src/stream.ts`(`streamForProvider`), `packages/ai-provider/src/chat.ts`(`chatForProvider`)
- Modify: `apps/docs/src/shared/ipc.ts`, `apps/docs/src/main/ai-routing-ipc.ts`, 키 프로바이더 타입 사용처 7곳(Step 3 목록)
- Test: `apps/docs/tests/ai-routing-ipc.test.ts`(추가), `packages/ai-provider/tests/providers.test.ts`(필요 시 갱신)

**Interfaces:**

- Consumes: `streamCodexAppServer`, `chatCodexAppServer` (Task 2).
- Produces: `AiProviderId` ∋ `'codex'`, `AiProviderProtocol` ∋ `'codex-app-server'`, `AiProviderAuth` ∋ `'codex-login'`; `PUBLIC_AI_PROVIDER_IDS` = `['genspark','codex','openrouter','anthropic','openai','deepseek','glm','kimi','minimax']`; `type KeyedPublicAiProviderId = Exclude<PublicAiProviderId, 'genspark' | 'codex'>`; `PublicAiProvider.planType?: string`; codex 대화의 `sessionId = "<projectId>:<chatId>"`.

- [ ] **Step 1: 실패 테스트 — 라우팅이 codex를 브리지로 보낸다**

`apps/docs/tests/ai-routing-ipc.test.ts` 맨 위 import 바로 아래에 모듈 목(mock)을 추가:

```ts
const codexBridge = vi.hoisted(() => ({
  streamCodexAppServer: vi.fn(),
  chatCodexAppServer: vi.fn(),
}))
vi.mock('@genoffice/ai-provider/codex-app-server', () => codexBridge)
```

파일 끝에:

```ts
describe('Codex dispatch', () => {
  function registerWithCodexRoute(send = vi.fn()) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) =>
          handlers.set(channel, listener as (...args: unknown[]) => unknown),
      },
      settings: {
        getGlobalDefault: () => ({ providerId: 'codex', modelId: 'gpt-5.6-luna' }),
        assertRouteAvailable: vi.fn(async () => undefined),
        getProviderConfig: () => ({ apiKey: '', model: 'gpt-5.6-luna' }),
      } as never,
      getProjectStore: () =>
        ({
          getOrCreateChatAiMetadata: () => ({
            schemaVersion: 1,
            route: { providerId: 'codex', modelId: 'gpt-5.6-luna' },
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          }),
        }) as never,
      getGensparkApiKey: () => '',
    })
    return { handlers, send }
  }

  it('streams a codex route through the app-server bridge with the conversation as its session', async () => {
    codexBridge.streamCodexAppServer.mockImplementation(async (...args: unknown[]) => {
      const cb = args[5] as { onDelta(text: string): void }
      cb.onDelta('안녕하세요')
    })
    const { handlers, send } = registerWithCodexRoute()
    await handlers.get(AI_CHANNELS.stream)!(
      { sender: { id: 5, isDestroyed: () => false, send } },
      {
        requestId: 'codex-1',
        conversation: { projectId: 'default', chatId: '0123456789abcdef' },
        system: 'system',
        messages: [{ role: 'user', text: 'hi' }],
      },
    )
    expect(codexBridge.streamCodexAppServer).toHaveBeenCalledTimes(1)
    const [config, system, , , maxTokens, cb] = codexBridge.streamCodexAppServer.mock.calls[0]!
    expect(config).toEqual({ apiKey: '', model: 'gpt-5.6-luna' })
    expect(system).toBe('system')
    expect(maxTokens).toBe(8192)
    expect(cb).toMatchObject({ sessionId: 'default:0123456789abcdef' })
    expect(send).toHaveBeenCalledWith(AI_CHANNELS.streamChunk, {
      requestId: 'codex-1',
      type: 'delta',
      text: '안녕하세요',
    })
    expect(send).toHaveBeenLastCalledWith(AI_CHANNELS.streamChunk, {
      requestId: 'codex-1',
      type: 'done',
    })
  })

  it('answers one-shot chat for a codex route through the bridge', async () => {
    codexBridge.chatCodexAppServer.mockResolvedValue({ ok: true, content: '요약' })
    const { handlers } = registerWithCodexRoute()
    const response = await handlers.get(AI_CHANNELS.chat)!(
      { sender: { id: 5 } },
      { system: 's', user: 'u' },
    )
    expect(response).toEqual({ ok: true, content: '요약' })
    expect(codexBridge.chatCodexAppServer.mock.calls[0]!.slice(0, 3)).toEqual([
      { apiKey: '', model: 'gpt-5.6-luna' },
      's',
      'u',
    ])
  })
})
```

Run: `npx vitest run apps/docs/tests/ai-routing-ipc.test.ts` (리포 루트에서 `npm test -w @genoffice/docs -- ai-routing-ipc`)
Expected: FAIL — `'codex'`가 `PUBLIC_AI_PROVIDER_IDS`에 없어 경로 검증 단계에서 거절되거나 브리지가 호출되지 않음.

- [ ] **Step 2: 타입·메타**

`packages/ai-provider/src/types.ts`:

```ts
export type AiProviderId =
  | 'genspark'
  | 'codex'
  | 'openrouter'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'glm'
  | 'kimi'
  | 'minimax'
  | 'openai'
  | 'custom'

export type AiProviderProtocol =
  'genspark' | 'anthropic' | 'gemini' | 'openai-compatible' | 'codex-app-server'

export type AiProviderAuth =
  'genspark-login' | 'codex-login' | 'bearer-key' | 'anthropic-key' | 'gemini-key'
```

`packages/ai-provider/src/providers.ts`의 `AI_PROVIDERS` 배열에서 genspark 항목 바로 다음에:

```ts
  {
    id: 'codex',
    label: 'Codex (ChatGPT)',
    protocol: 'codex-app-server',
    auth: 'codex-login',
    modelSource: 'remote',
    // filled at runtime from the signed-in account's app-server model/list
    models: [],
    defaultModel: 'gpt-5.6-luna',
    keyPlaceholder: '',
  },
```

`stream.ts`의 `streamForProvider` switch에 `case 'anthropic':` 앞:

```ts
    case 'codex':
      // Codex needs a child process; ai-routing-ipc dispatches it to the
      // main-only @genoffice/ai-provider/codex-app-server bridge.
      throw new Error('Codex runs through the main-process app-server bridge')
```

`chat.ts`의 `chatForProvider` switch에 같은 위치:

```ts
    case 'codex':
      return { ok: false, error: 'Codex runs through the main-process app-server bridge' }
```

- [ ] **Step 3: 공개 id와 키 프로바이더 타입**

`apps/docs/src/shared/ipc.ts`:

```ts
export const PUBLIC_AI_PROVIDER_IDS = [
  'genspark',
  'codex',
  'openrouter',
  'anthropic',
  'openai',
  'deepseek',
  'glm',
  'kimi',
  'minimax',
] as const

export type PublicAiProviderId = Extract<AiProviderId, (typeof PUBLIC_AI_PROVIDER_IDS)[number]>

/** providers authenticated by a user API key (Genspark and Codex sign in instead) */
export type KeyedPublicAiProviderId = Exclude<PublicAiProviderId, 'genspark' | 'codex'>
```

`PublicAiProvider`에 `planType?: string` 필드 추가(`accountLabel?` 다음).

다음 7곳의 `Exclude<PublicAiProviderId, 'genspark'>`를 `KeyedPublicAiProviderId`로 바꾸고 필요한 파일에 import를 추가한다:

| 파일:행                                                                | 비고                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/docs/src/shared/ipc.ts:106`, `:287`                              | 같은 파일                                                                                                        |
| `apps/docs/src/main/ai-catalog-cache.ts:29`                            | `getApiKey` 인자만. 283·304·368행(`refreshOne`/`fetchRemote`/`toCached`)은 codex도 받아야 하므로 **그대로 둔다** |
| `apps/docs/src/main/ai-settings-service.ts:68`, `:160`, `:235`, `:239` |                                                                                                                  |
| `apps/sheets/src/shared/desktop-api.ts:1836`                           |                                                                                                                  |
| `apps/shell/src/shared/home-api.ts:120`                                |                                                                                                                  |
| `apps/shell/src/renderer/src/settings/ai-settings-api.ts:12`           | `export type KeyedAiProviderId = KeyedPublicAiProviderId`                                                        |

- [ ] **Step 4: 라우팅 디스패치**

`apps/docs/src/main/ai-routing-ipc.ts` import에 추가:

```ts
import { chatCodexAppServer, streamCodexAppServer } from '@genoffice/ai-provider/codex-app-server'
```

`AI_CHANNELS.stream` 핸들러의 `await streamForProvider(route.providerId, config, …, { signal, onDelta, onToolCall })` 호출을 다음으로 교체:

```ts
const callbacks = {
  signal: controller.signal,
  onDelta: (text: string) => send({ requestId: request.requestId, type: 'delta', text }),
  onToolCall: (toolCall: AgentToolCall) =>
    send({ requestId: request.requestId, type: 'tool-call', toolCall }),
}
if (route.providerId === 'codex') {
  await streamCodexAppServer(
    config,
    request.system,
    request.messages,
    request.tools ?? [],
    request.maxTokens ?? 8192,
    {
      ...callbacks,
      // one native Codex thread per conversation, so follow-up turns send only the new events
      ...(request.conversation
        ? { sessionId: `${request.conversation.projectId}:${request.conversation.chatId}` }
        : {}),
    },
  )
} else {
  await streamForProvider(
    route.providerId,
    config,
    request.system,
    request.messages,
    request.tools ?? [],
    request.maxTokens ?? 8192,
    callbacks,
  )
}
```

(`AgentToolCall` 타입이 이 파일에 없으면 `import type { AgentToolCall } from '@genoffice/agent-core'` 추가.)

`AI_CHANNELS.chat` 핸들러의 `const response = await chatForProvider(route.providerId, config, request.system, request.user)`를:

```ts
const response =
  route.providerId === 'codex'
    ? await chatCodexAppServer(config, request.system, request.user, AbortSignal.timeout(180_000))
    : await chatForProvider(route.providerId, config, request.system, request.user)
```

- [ ] **Step 5: 통과·회귀 확인**

Run: `npm test -w @genoffice/docs -- ai-routing-ipc` → PASS(추가 2건 포함). `npm test -w @genoffice/ai-provider` — `providers.test.ts`가 프로바이더 id 목록·개수를 고정하고 있으면 `'codex'`를 genspark 다음에 넣어 갱신한다. `npm run typecheck` → 오류 0(타입 오류는 Step 3 목록 밖의 `Exclude<…'genspark'>` 사용처를 가리킨다 — 같은 규칙으로 고친다).

- [ ] **Step 6: 커밋**

```bash
git add packages/ai-provider apps/docs/src apps/docs/tests/ai-routing-ipc.test.ts apps/sheets/src/shared/desktop-api.ts apps/shell/src/shared/home-api.ts apps/shell/src/renderer/src/settings/ai-settings-api.ts
git commit -m "$(cat <<'EOF'
AI: register the codex provider and dispatch its turns to the app-server bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 설정 서비스·카탈로그 통합과 Codex 공급자

**Files:**

- Create: `apps/docs/src/main/codex-provider.ts`
- Modify: `apps/docs/src/main/ai-settings-service.ts`, `apps/docs/src/main/ai-catalog-cache.ts`, `apps/docs/src/main/docs-main.ts:2276-2291`, `apps/sheets/src/main/sheets-main.ts:1989-2005`, `apps/slides/src/main/slides-main.ts:3623-3645`, `apps/pdf/src/main/pdf-main.ts:343-363`
- Test: `apps/docs/tests/ai-settings-codex.test.ts`, `apps/docs/tests/codex-provider.test.ts`

**Interfaces:**

- Consumes: `CodexAccountMonitor`, `readCodexAccount`, `startCodexLogin`, `waitForCodexLogin`, `cancelCodexLogin`, `loginCodexWithApiKey`, `logoutCodex`, `codexVersionFromUserAgent` (Task 3), `withCodexRpc`, `listCodexModels`, `resolveCodexBinary`, `setBundledCodexPath`, `shutdownCodexAppServers` (Task 2).
- Produces:
  - `codex-provider.ts`:
    - `interface CodexRpcRunner { <T>(cliPath: string | undefined, action: (rpc: CodexRpc) => Promise<T>): Promise<T> }`
    - `interface CodexProviderDeps { withRpc: CodexRpcRunner; listModels(cliPath?: string): Promise<CodexModelCatalog>; resolveBinary(cliPath?: string): Promise<ResolvedCodexBinary> }`
    - `interface CodexStatusView { state: 'connected' | 'signed-out' | 'error'; email?: string; planType?: string; accountType?: string; message?: string; binary?: { path: string; source: CodexBinarySource; version: string | null } }`
    - `class CodexProvider { constructor(deps: CodexProviderDeps); cliPath(): string | undefined; setCliPath(path: string | undefined): void; readonly monitor: CodexAccountMonitor; isConnected(): boolean; ensureStatus(): Promise<CodexAccountStatus>; listModels(): Promise<CodexModelCatalog>; lastDefaultModel(): string | null; status(): Promise<CodexStatusView>; startLogin(method: CodexLoginMethod): Promise<CodexLoginStart>; awaitLogin(loginId: string, timeoutMs?: number): Promise<CodexStatusView>; cancelLogin(loginId: string): Promise<void>; loginWithApiKey(apiKey: string): Promise<CodexStatusView>; logout(): Promise<CodexStatusView> }`
    - `getCodexProvider(): CodexProvider` (프로세스 전역 1개, 실제 의존 주입), `configureCodexBundledBinary(path: string | undefined): void`
  - `AiSettingsServiceOptions.codex?: CodexProvider`, `AiCatalogCacheOptions.codexModels?: () => Promise<CodexModelCatalog>`
  - 설정 파일 `providers.codex.cliPath?: string`(사용자 지정 경로, Task 6의 IPC가 쓴다), `AiSettingsService.setCodexCliPath(path: unknown): PublicAiSettings`

- [ ] **Step 1: Codex 공급자 테스트**

`apps/docs/tests/codex-provider.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { CodexRpc, RpcMessage } from '@genoffice/ai-provider/codex-app-server'
import { CodexProvider, type CodexProviderDeps } from '../src/main/codex-provider'

function deps(account: unknown, extra: Partial<CodexProviderDeps> = {}) {
  const listeners = new Set<(m: RpcMessage) => void>()
  const calls: string[] = []
  let current = account
  const rpc: CodexRpc = {
    userAgent: 'genoffice/0.159.3 (Windows)',
    async request(method, params) {
      calls.push(method)
      if (method === 'account/read') return { account: current }
      if (method === 'account/login/start') {
        if ((params as { type: string }).type === 'apiKey') {
          current = { type: 'apiKey' }
          return {}
        }
        return { loginId: 'L1', authUrl: 'https://auth.openai.com/x' }
      }
      if (method === 'account/logout') {
        current = null
        return {}
      }
      if (method === 'account/login/cancel') return { status: 'canceled' }
      throw new Error(`unexpected ${method}`)
    },
    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const value: CodexProviderDeps = {
    withRpc: async (_cliPath, action) => action(rpc),
    listModels: vi.fn(async () => ({
      models: ['gpt-6.1-sol', 'gpt-5.6-luna'],
      defaultModel: 'gpt-6.1-sol',
    })),
    resolveBinary: vi.fn(async () => ({
      path: 'C:\\app\\resources\\native\\codex-app-server.exe',
      source: 'bundled' as const,
    })),
    ...extra,
  }
  return {
    value,
    calls,
    complete: (success = true) => {
      current = success ? { type: 'chatgpt', email: 'a@b.com', planType: 'plus' } : current
      for (const l of [...listeners])
        l({ method: 'account/login/completed', params: { loginId: 'L1', success } })
    },
  }
}

describe('CodexProvider', () => {
  it('reports status with account summary and the binary in use', async () => {
    const d = deps({ type: 'chatgpt', email: 'a@b.com', planType: 'prolite' })
    const provider = new CodexProvider(d.value)
    await expect(provider.status()).resolves.toEqual({
      state: 'connected',
      accountType: 'chatgpt',
      email: 'a@b.com',
      planType: 'prolite',
      binary: {
        path: 'C:\\app\\resources\\native\\codex-app-server.exe',
        source: 'bundled',
        version: '0.159.3',
      },
    })
    expect(provider.isConnected()).toBe(true)
  })

  it('shows a missing custom binary as an error on the card', async () => {
    const d = deps(null, {
      resolveBinary: vi.fn(async () => {
        throw new Error('Codex executable not found: D:\\nope\\codex.exe')
      }),
      withRpc: async () => {
        throw new Error('Codex executable not found: D:\\nope\\codex.exe')
      },
    })
    const provider = new CodexProvider(d.value)
    provider.setCliPath('D:\\nope\\codex.exe')
    await expect(provider.status()).resolves.toMatchObject({
      state: 'error',
      message: 'Codex executable not found: D:\\nope\\codex.exe',
    })
  })

  it('completes a browser sign-in and refreshes the cached status', async () => {
    const d = deps(null)
    const provider = new CodexProvider(d.value)
    expect((await provider.status()).state).toBe('signed-out')
    const start = await provider.startLogin('chatgpt')
    expect(start).toEqual({
      method: 'chatgpt',
      loginId: 'L1',
      authUrl: 'https://auth.openai.com/x',
    })
    const done = provider.awaitLogin('L1', 60_000)
    d.complete(true)
    await expect(done).resolves.toMatchObject({ state: 'connected', email: 'a@b.com' })
    expect(provider.isConnected()).toBe(true)
  })

  it('cancels the server-side login when the wait times out', async () => {
    vi.useFakeTimers()
    try {
      const d = deps(null)
      const provider = new CodexProvider(d.value)
      await provider.startLogin('chatgpt')
      const done = provider.awaitLogin('L1', 1_000)
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(done).resolves.toMatchObject({ state: 'signed-out' })
      expect(d.calls).toContain('account/login/cancel')
    } finally {
      vi.useRealTimers()
    }
  })

  it('signs in with an API key and signs out, updating the status each time', async () => {
    const d = deps({ type: 'chatgpt', email: 'a@b.com' })
    const provider = new CodexProvider(d.value)
    await expect(provider.loginWithApiKey('sk-x')).resolves.toMatchObject({
      state: 'connected',
      accountType: 'apiKey',
    })
    await expect(provider.logout()).resolves.toMatchObject({ state: 'signed-out' })
    expect(provider.isConnected()).toBe(false)
  })

  it('remembers the account default model from the last model list', async () => {
    const d = deps({ type: 'chatgpt' })
    const provider = new CodexProvider(d.value)
    expect(provider.lastDefaultModel()).toBeNull()
    await provider.listModels()
    expect(provider.lastDefaultModel()).toBe('gpt-6.1-sol')
  })
})
```

Run: `npm test -w @genoffice/docs -- codex-provider` → FAIL(module not found).

- [ ] **Step 2: 공급자 구현**

`apps/docs/src/main/codex-provider.ts`:

```ts
import {
  CodexAccountMonitor,
  cancelCodexLogin,
  codexVersionFromUserAgent,
  loginCodexWithApiKey,
  logoutCodex,
  readCodexAccount,
  startCodexLogin,
  waitForCodexLogin,
  type CodexAccountStatus,
  type CodexLoginMethod,
  type CodexLoginStart,
} from '@genoffice/ai-provider/codex-account'
import {
  listCodexModels,
  resolveCodexBinary,
  setBundledCodexPath,
  withCodexRpc,
  type CodexBinarySource,
  type CodexRpc,
  type ResolvedCodexBinary,
} from '@genoffice/ai-provider/codex-app-server'
import type { CodexModelCatalog } from '@genoffice/ai-provider'

/**
 * Process-wide Codex state shared by every module's AiSettingsService (docs,
 * sheets, slides, pdf all run in the shell's main process): the custom binary
 * path, the cached account status, the last model list, and the sign-in flows
 * the settings card drives. Codex keeps the credentials in ~/.codex.
 */

export type CodexRpcRunner = <T>(
  cliPath: string | undefined,
  action: (rpc: CodexRpc) => Promise<T>,
) => Promise<T>

export interface CodexProviderDeps {
  withRpc: CodexRpcRunner
  listModels(cliPath?: string): Promise<CodexModelCatalog>
  resolveBinary(cliPath?: string): Promise<ResolvedCodexBinary>
}

export interface CodexStatusView {
  state: 'connected' | 'signed-out' | 'error'
  accountType?: string
  email?: string
  planType?: string
  message?: string
  binary?: { path: string; source: CodexBinarySource; version: string | null }
}

export class CodexProvider {
  readonly monitor: CodexAccountMonitor
  private customPath: string | undefined
  private defaultModel: string | null = null
  private version: string | null = null

  constructor(private readonly deps: CodexProviderDeps) {
    this.monitor = new CodexAccountMonitor(() =>
      this.deps.withRpc(this.customPath, async (rpc) => {
        this.version = codexVersionFromUserAgent(rpc.userAgent)
        return readCodexAccount(rpc)
      }),
    )
  }

  cliPath(): string | undefined {
    return this.customPath
  }

  setCliPath(path: string | undefined): void {
    const next = path?.trim() || undefined
    if (next === this.customPath) return
    this.customPath = next
    this.defaultModel = null
    this.monitor.invalidate()
  }

  isConnected(): boolean {
    return this.monitor.isConnected()
  }

  ensureStatus(): Promise<CodexAccountStatus> {
    return this.monitor.current()
  }

  async listModels(): Promise<CodexModelCatalog> {
    const catalog = await this.deps.listModels(this.customPath)
    this.defaultModel = catalog.defaultModel || null
    return catalog
  }

  lastDefaultModel(): string | null {
    return this.defaultModel
  }

  async status(): Promise<CodexStatusView> {
    const account = await this.monitor.refresh()
    let binary: CodexStatusView['binary']
    try {
      const resolved = await this.deps.resolveBinary(this.customPath)
      binary = { ...resolved, version: this.version }
    } catch {
      binary = undefined
    }
    if (account.state === 'error')
      return { state: 'error', message: account.message, ...(binary ? { binary } : {}) }
    if (account.state === 'signed-out')
      return { state: 'signed-out', ...(binary ? { binary } : {}) }
    return {
      state: 'connected',
      accountType: account.accountType,
      ...(account.email ? { email: account.email } : {}),
      ...(account.planType ? { planType: account.planType } : {}),
      ...(binary ? { binary } : {}),
    }
  }

  startLogin(method: CodexLoginMethod): Promise<CodexLoginStart> {
    return this.deps.withRpc(this.customPath, (rpc) => startCodexLogin(rpc, method))
  }

  /** waits for the browser/device sign-in to finish; cancels it server-side on timeout */
  async awaitLogin(loginId: string, timeoutMs?: number): Promise<CodexStatusView> {
    const outcome = await this.deps.withRpc(this.customPath, (rpc) =>
      waitForCodexLogin(rpc, loginId, timeoutMs),
    )
    if (!outcome.success) await this.cancelLogin(loginId).catch(() => undefined)
    this.monitor.invalidate()
    return this.status()
  }

  async cancelLogin(loginId: string): Promise<void> {
    await this.deps.withRpc(this.customPath, (rpc) => cancelCodexLogin(rpc, loginId))
  }

  async loginWithApiKey(apiKey: string): Promise<CodexStatusView> {
    await this.deps.withRpc(this.customPath, (rpc) => loginCodexWithApiKey(rpc, apiKey))
    this.monitor.invalidate()
    return this.status()
  }

  async logout(): Promise<CodexStatusView> {
    await this.deps.withRpc(this.customPath, (rpc) => logoutCodex(rpc))
    this.monitor.invalidate()
    return this.status()
  }
}

let shared: CodexProvider | null = null

export function getCodexProvider(): CodexProvider {
  if (!shared) {
    shared = new CodexProvider({
      withRpc: (cliPath, action) => withCodexRpc(cliPath, action),
      listModels: (cliPath) => listCodexModels(cliPath),
      resolveBinary: (cliPath) => resolveCodexBinary(cliPath),
    })
  }
  return shared
}

/** shell main calls this once with resources/native/codex-app-server[.exe] (dev: apps/shell/native/codex/…) */
export function configureCodexBundledBinary(path: string | undefined): void {
  setBundledCodexPath(path)
}
```

Run: `npm test -w @genoffice/docs -- codex-provider` → PASS(6).

- [ ] **Step 3: 설정 서비스 테스트**

`apps/docs/tests/ai-settings-codex.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiCatalogCache } from '../src/main/ai-catalog-cache'
import { AiSecretStore, type SecretCipher } from '../src/main/ai-secret-store'
import { AiSettingsService } from '../src/main/ai-settings-service'
import { CodexProvider } from '../src/main/codex-provider'

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(`e:${value}`),
  decrypt: (value) => value.toString().slice(2),
}

function fixture(account: unknown, models = ['gpt-6.1-sol', 'gpt-5.6-luna']) {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-ai-codex-'))
  const settingsPath = join(dir, 'ai-settings.json')
  const codex = new CodexProvider({
    withRpc: async (_path, action) =>
      action({
        userAgent: 'genoffice/0.159.3',
        request: async () => ({ account }),
        onNotification: () => () => undefined,
      }),
    listModels: vi.fn(async () => ({ models, defaultModel: models[0] ?? '' })),
    resolveBinary: async () => ({ path: 'x', source: 'bundled' as const }),
  })
  const secretStore = new AiSecretStore(join(dir, 'ai-secrets.json'), cipher)
  const catalogs = new AiCatalogCache({
    cacheDir: join(dir, 'catalogs'),
    getApiKey: (providerId) => secretStore.get(providerId),
    fetch: vi.fn(),
    codexModels: () => codex.listModels(),
  })
  const service = new AiSettingsService({
    settingsPath,
    secretStore,
    catalogs,
    isGensparkConfigured: () => false,
    codex,
  })
  return { settingsPath, service, codex }
}

const signedIn = { type: 'chatgpt', email: 'a@b.com', planType: 'prolite' }

describe('AiSettingsService + Codex', () => {
  it('defaults a fresh install to Codex gpt-5.6-luna', () => {
    const { service } = fixture(signedIn)
    expect(service.getGlobalDefault()).toEqual({ providerId: 'codex', modelId: 'gpt-5.6-luna' })
  })

  it('keeps an existing user default untouched', () => {
    const { settingsPath, service } = fixture(signedIn)
    writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        globalDefault: { providerId: 'openai', modelId: 'gpt-4.1-mini' },
        providers: {},
      }),
    )
    expect(service.getGlobalDefault()).toEqual({ providerId: 'openai', modelId: 'gpt-4.1-mini' })
  })

  it('lists the signed-in account models and shows Codex as connected with email and plan', async () => {
    const { service } = fixture(signedIn)
    const result = await service.listModels()
    expect(result.models.filter((m) => m.providerId === 'codex').map((m) => m.id)).toEqual([
      'gpt-6.1-sol',
      'gpt-5.6-luna',
    ])
    expect(service.getPublicSettings().providers.find((p) => p.id === 'codex')).toMatchObject({
      status: 'connected',
      accountLabel: 'a@b.com',
      planType: 'prolite',
      hasApiKey: false,
    })
  })

  it('hides Codex models and points to Settings when the account is signed out', async () => {
    const { service } = fixture(null)
    const result = await service.listModels()
    expect(result.models.some((m) => m.providerId === 'codex')).toBe(false)
    expect(service.getPublicSettings().providers.find((p) => p.id === 'codex')?.status).toBe(
      'not-configured',
    )
    await expect(
      service.assertRouteAvailable({ providerId: 'codex', modelId: 'gpt-5.6-luna' }),
    ).rejects.toThrow(/Sign in to Codex in Settings › AI/)
  })

  it('falls back to the account default model when gpt-5.6-luna is not offered', async () => {
    const { service } = fixture(signedIn, ['gpt-6.1-sol', 'gpt-5.5'])
    await service.listModels()
    expect(service.getGlobalDefault()).toEqual({ providerId: 'codex', modelId: 'gpt-6.1-sol' })
  })

  it('gives the bridge a key-less config with the custom binary path', async () => {
    const { service, codex } = fixture(signedIn)
    service.setCodexCliPath('D:\\tools\\codex.exe')
    expect(codex.cliPath()).toBe('D:\\tools\\codex.exe')
    expect(
      service.getProviderConfig({ providerId: 'codex', modelId: 'gpt-5.6-luna' }, () => ''),
    ).toEqual({
      apiKey: '',
      model: 'gpt-5.6-luna',
      cliPath: 'D:\\tools\\codex.exe',
    })
  })

  it('persists the custom path and restores it into the shared provider', () => {
    const first = fixture(signedIn)
    first.service.setCodexCliPath('  D:\\tools\\codex.exe  ')
    const saved = JSON.parse(readFileSync(first.settingsPath, 'utf8'))
    expect(saved.providers.codex).toEqual({ cliPath: 'D:\\tools\\codex.exe' })
    first.service.setCodexCliPath('')
    expect(JSON.parse(readFileSync(first.settingsPath, 'utf8')).providers.codex).toBeUndefined()
    expect(first.codex.cliPath()).toBeUndefined()
  })

  it('rejects removing a Codex "key" — sign-out is the Codex way', () => {
    const { service } = fixture(signedIn)
    expect(() => service.removeProviderKey('codex')).toThrow(/cannot be removed/)
  })
})
```

Run: `npm test -w @genoffice/docs -- ai-settings-codex` → FAIL.

- [ ] **Step 4: 카탈로그 캐시**

`apps/docs/src/main/ai-catalog-cache.ts`:

- import에 `type CodexModelCatalog`(from `@genoffice/ai-provider`) 추가.
- `AiCatalogCacheOptions`에:

```ts
  /** signed-in Codex account's model list; absent when Codex is not wired in (tests, standalone tools) */
  codexModels?: () => Promise<CodexModelCatalog>
```

- `fetchRemote` 맨 앞(`const apiKey = …` 앞)에:

```ts
if (providerId === 'codex') {
  if (!this.options.codexModels) throw new Error('Codex is not available in this build')
  const live = await this.options.codexModels()
  return this.toCached(
    'codex',
    live.models.map((id) => normalizeStaticModel('codex', id)),
    this.now().toISOString(),
    // the account's lineup changes with plans and releases; keep it short-lived
    'max-age=300',
  )
}
```

- [ ] **Step 5: 설정 서비스**

`apps/docs/src/main/ai-settings-service.ts`:

(a) import에 `import type { CodexProvider } from './codex-provider'`. `PersistedProviderState`에 `cliPath?: string` 추가. `normalizePersistedSettings`의 provider 루프에 `if (typeof raw.cliPath === 'string' && raw.cliPath) provider.cliPath = raw.cliPath` 추가.

(b) `AiSettingsServiceOptions`에 `codex?: CodexProvider` 추가.

(c) `DEFAULT_ROUTE`를 교체:

```ts
/** New installs default to the signed-in ChatGPT account through Codex (spec §5.3). */
const DEFAULT_ROUTE: AiRoute = { providerId: 'codex', modelId: 'gpt-5.6-luna' }
```

(d) 클래스에 private 헬퍼:

```ts
  private codexConfigured(): boolean {
    return this.options.codex?.isConnected() === true
  }

  /** the shared provider learns the persisted custom path the first time settings load */
  private syncCodexPath(state: PersistedAiSettings): void {
    this.options.codex?.setCliPath(state.providers.codex?.cliPath)
  }

  /** an unavailable built-in default model is replaced by the account default (spec §5.3) */
  private adoptCodexDefault(result: ListAiModelsResult): void {
    const state = this.load()
    if (state.globalDefault.providerId !== 'codex') return
    const codexModels = result.models.filter((model) => model.providerId === 'codex')
    if (codexModels.length === 0 || codexModels.some((m) => m.id === state.globalDefault.modelId)) return
    const fallback = this.options.codex?.lastDefaultModel()
    if (!fallback || !codexModels.some((m) => m.id === fallback)) return
    state.globalDefault = { providerId: 'codex', modelId: fallback }
    this.write(state)
  }
```

`load()`에서 `this.state = current` / 새 기본 상태 / `migrateLegacy` 결과를 반환하기 직전마다 `this.syncCodexPath(this.state)` 호출(세 반환 지점 모두).

(e) `listModels`와 `refreshModels` 맨 앞에 `await this.options.codex?.ensureStatus()`를 넣고, 두 메서드의 `if (!args.requireImageInput) this.updateProviderUsability(result)` 다음 줄에 `this.adoptCodexDefault(result)`.

(f) `configuredProviderIds`의 filter 첫 줄 아래에 `if (providerId === 'codex') return this.codexConfigured()`.

(g) `publicProvider`에서 genspark 분기 다음에:

```ts
if (providerId === 'codex') {
  const snapshot = this.options.codex?.monitor.snapshot()
  const provider: PublicAiProvider = {
    id: providerId,
    label: definition.label,
    status:
      snapshot?.state === 'connected'
        ? 'connected'
        : snapshot?.state === 'error'
          ? 'unavailable'
          : 'not-configured',
    hasApiKey: false,
  }
  if (snapshot?.state === 'connected') {
    if (snapshot.email) provider.accountLabel = snapshot.email
    if (snapshot.planType) provider.planType = snapshot.planType
  }
  return provider
}
```

(h) `setGlobalDefault`의 genspark 분기 다음에:

```ts
    } else if (route.providerId === 'codex') {
      if (!this.codexConfigured()) throw new Error('Sign in to Codex in Settings › AI first')
```

(이어지는 `else if (route.providerId !== 'genspark')` 블록은 `else if (route.providerId !== 'genspark' && route.providerId !== 'codex')`로 바꾼다.)

(i) `assertRouteAvailable`의 genspark 검사 다음에:

```ts
if (route.providerId === 'codex') {
  const status = await this.options.codex?.ensureStatus()
  if (status?.state === 'error') throw new Error(`Codex is unavailable: ${status.message}`)
  if (status?.state !== 'connected')
    throw new Error('Sign in to Codex in Settings › AI to use this model')
}
```

그리고 다음 `if (route.providerId !== 'genspark') {` 조건을 `if (route.providerId !== 'genspark' && route.providerId !== 'codex') {`로.

(j) `getProviderConfig`의 genspark 분기 다음에:

```ts
if (route.providerId === 'codex') {
  const cliPath = this.options.codex?.cliPath()
  return { apiKey: '', model: route.modelId, ...(cliPath ? { cliPath } : {}) }
}
```

(k) `removeProviderKey`는 `VERIFIABLE_PROVIDER_IDS` 검사로 codex를 이미 거절한다("Provider key cannot be removed") — 수정 없음. `redactCatalogResult`·`updateProviderUsability`의 `catalog.providerId === 'genspark'` 조건은 `catalog.providerId === 'genspark' || catalog.providerId === 'codex'`로(codex는 비밀이 없고 `verifiedAt`도 없다).

(l) 새 메서드:

```ts
  setCodexCliPath(value: unknown): PublicAiSettings {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new Error('Codex path must be a string')
    }
    const path = typeof value === 'string' ? value.trim() : ''
    if (path.length > 4096) throw new Error('Codex path is too long')
    const state = this.load()
    if (path) state.providers.codex = { ...state.providers.codex, cliPath: path }
    else delete state.providers.codex
    this.write(state)
    this.options.codex?.setCliPath(path || undefined)
    this.options.catalogs.clear('codex')
    return this.getPublicSettings()
  }
```

- [ ] **Step 6: 각 모듈 메인에 공급자 주입**

`apps/docs/src/main/docs-main.ts`의 `getAiSettingsService()`:

```ts
const codex = getCodexProvider()
const catalogs = new AiCatalogCache({
  cacheDir: CATALOG_CACHE_PATH(),
  getApiKey: (providerId) => secrets.get(providerId),
  codexModels: () => codex.listModels(),
})
aiSettingsService = new AiSettingsService({
  settingsPath: SETTINGS_PATH(),
  secretStore: secrets,
  catalogs,
  isGensparkConfigured: hasGskAuth,
  codex,
})
```

(import `getCodexProvider` from `./codex-provider`.) 같은 변경을 `apps/sheets/src/main/sheets-main.ts` `getSheetsAiSettingsService`, `apps/slides/src/main/slides-main.ts` `getSlidesAiSettingsService`, `apps/pdf/src/main/pdf-main.ts` `getStandaloneAiSettingsService`에 적용한다(import 경로는 각 파일이 이미 docs 모듈을 가져오는 방식 그대로: `'../../../docs/src/main/codex-provider'`).

`docs-main.ts`의 `registerAiIpc()` 끝에:

```ts
// stop every Codex app-server child on quit (also covers sheets/slides/pdf — one shared pool)
app.once('before-quit', shutdownCodexAppServers)
```

(import `shutdownCodexAppServers` from `@genoffice/ai-provider/codex-app-server`.)

- [ ] **Step 7: 통과·회귀**

Run: `npm test -w @genoffice/docs` → `ai-settings-codex`(8)·`codex-provider`(6) PASS, 기존 `ai-settings-service`·`ai-catalog-cache` 그대로 PASS. `npm test -w @genoffice/sheets`, `-w @genoffice/slides`, `-w @genoffice/pdf` → 기존 결과 유지(sheets의 Windows `EPERM fsync` 3건은 기존 실패). `npm run typecheck` → 0.

- [ ] **Step 8: 커밋**

```bash
git add apps/docs/src/main apps/docs/tests/ai-settings-codex.test.ts apps/docs/tests/codex-provider.test.ts apps/sheets/src/main/sheets-main.ts apps/slides/src/main/slides-main.ts apps/pdf/src/main/pdf-main.ts
git commit -m "$(cat <<'EOF'
AI: make Codex the default provider in every module's settings service

New installs route to codex / gpt-5.6-luna (account default when that model
is not offered); existing defaults are kept. Codex counts as configured when
its account is signed in, contributes the account's live model list, and
keeps an optional custom binary path.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 셸 — Codex 계정 IPC, 프리로드, 설정 카드

**Files:**

- Create: `apps/shell/src/shared/codex-api.ts`, `apps/shell/src/main/codex-ipc.ts`, `apps/shell/src/renderer/src/settings/codex-card.ts`, `apps/shell/src/renderer/src/settings/CodexCard.tsx`
- Modify: `apps/shell/src/main/index.ts`(동봉 경로 설정·IPC 등록), `apps/shell/src/preload/index.ts`, `apps/shell/src/shared/home-api.ts`(`HomeApi`), `apps/shell/src/renderer/src/settings/ai-settings-api.ts`, `apps/shell/src/renderer/src/settings/AiSettingsModal.tsx`, `apps/docs/src/shared/ipc.ts`(`AI_CHANNELS.setCodexCliPath`), `apps/docs/src/main/ai-routing-ipc.ts`(핸들러)
- Test: `apps/shell/tests/codex-ipc.test.ts`, `apps/shell/tests/codex-card.test.ts`

**Interfaces:**

- Consumes: `getCodexProvider`, `configureCodexBundledBinary`, `CodexStatusView` (Task 5), `CodexLoginMethod` (Task 3), `AiSettingsService.setCodexCliPath` (Task 5), `safeExternalUrl` (`@genoffice/electron-utils`).
- Produces:
  - `CODEX_CHANNELS = { status: 'codex:status', login: 'codex:login', loginCancel: 'codex:login-cancel', loginApiKey: 'codex:login-api-key', logout: 'codex:logout', statusChanged: 'codex:status-changed' }`
  - `type CodexLoginStartView = { method: 'chatgpt'; loginId: string } | { method: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }` (authUrl은 렌더러로 보내지 않는다)
  - `interface CodexRendererApi { codexStatus(): Promise<CodexStatusView>; codexLogin(method: CodexLoginMethod): Promise<CodexLoginStartView>; codexLoginCancel(loginId: string): Promise<void>; codexLoginWithApiKey(apiKey: string): Promise<CodexStatusView>; codexLogout(): Promise<CodexStatusView>; onCodexStatusChanged(handler: (status: CodexStatusView) => void): () => void; setCodexCliPath(path: string): Promise<PublicAiSettings> }`
  - `registerCodexIpc(deps: CodexIpcDeps): void`
  - `codexCardView(status: CodexStatusView | null, pending: CodexLoginStartView | null): CodexCardView`

- [ ] **Step 1: 공용 채널 정의**

`apps/shell/src/shared/codex-api.ts`:

```ts
import type { CodexStatusView } from '../../../docs/src/main/codex-provider'
import type { PublicAiSettings } from '../../../docs/src/shared/ipc'

export type { CodexStatusView }

export type CodexLoginMethod = 'chatgpt' | 'chatgptDeviceCode'

export const CODEX_CHANNELS = {
  status: 'codex:status',
  login: 'codex:login',
  loginCancel: 'codex:login-cancel',
  loginApiKey: 'codex:login-api-key',
  logout: 'codex:logout',
  /** main → renderer: a sign-in finished (or timed out) */
  statusChanged: 'codex:status-changed',
} as const

/** what the settings card needs to show while a sign-in is open; the browser URL never leaves main */
export type CodexLoginStartView =
  | { method: 'chatgpt'; loginId: string }
  | { method: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }

export interface CodexRendererApi {
  codexStatus(): Promise<CodexStatusView>
  codexLogin(method: CodexLoginMethod): Promise<CodexLoginStartView>
  codexLoginCancel(loginId: string): Promise<void>
  codexLoginWithApiKey(apiKey: string): Promise<CodexStatusView>
  codexLogout(): Promise<CodexStatusView>
  onCodexStatusChanged(handler: (status: CodexStatusView) => void): () => void
  setCodexCliPath(path: string): Promise<PublicAiSettings>
}
```

`apps/docs/src/shared/ipc.ts`의 `AI_CHANNELS`에 `setCodexCliPath: 'ai:codex:set-cli-path',` 추가. `apps/docs/src/main/ai-routing-ipc.ts`에서 `AI_CHANNELS.removeProviderKey` 핸들러와 같은 패턴으로:

```ts
ipcMain.handle(AI_CHANNELS.setCodexCliPath, (_event, value) => {
  try {
    return settings.setCodexCliPath(value)
  } catch (error) {
    throw new Error(safeError(error), { cause: error })
  }
})
```

- [ ] **Step 2: IPC 실패 테스트**

`apps/shell/tests/codex-ipc.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { CODEX_CHANNELS } from '../src/shared/codex-api'
import { registerCodexIpc, type CodexIpcDeps } from '../src/main/codex-ipc'

function setup(overrides: Partial<CodexIpcDeps> = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const provider = {
    status: vi.fn(async () => ({
      state: 'connected' as const,
      email: 'a@b.com',
      accountType: 'chatgpt',
    })),
    startLogin: vi.fn(async (method: string) =>
      method === 'chatgpt'
        ? { method: 'chatgpt' as const, loginId: 'L1', authUrl: 'https://auth.openai.com/oauth/x' }
        : {
            method: 'chatgptDeviceCode' as const,
            loginId: 'L2',
            verificationUrl: 'https://auth.openai.com/codex/device',
            userCode: 'AB-12',
          },
    ),
    awaitLogin: vi.fn(async () => ({ state: 'connected' as const, email: 'a@b.com' })),
    cancelLogin: vi.fn(async () => undefined),
    loginWithApiKey: vi.fn(async () => ({ state: 'connected' as const, accountType: 'apiKey' })),
    logout: vi.fn(async () => ({ state: 'signed-out' as const })),
  }
  const deps: CodexIpcDeps = {
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener as never) },
    provider: provider as never,
    openExternal: vi.fn(async () => undefined),
    confirm: vi.fn(async () => true),
    ...overrides,
  }
  registerCodexIpc(deps)
  const sender = { isDestroyed: () => false, send: vi.fn() }
  const invoke = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)!({ sender }, ...args)
  return { deps, provider, invoke, sender }
}

describe('Codex IPC', () => {
  it('opens the sign-in page in the browser, keeps the URL in main, and pushes the result', async () => {
    const { deps, provider, invoke, sender } = setup()
    const view = await invoke(CODEX_CHANNELS.login, 'chatgpt')
    expect(view).toEqual({ method: 'chatgpt', loginId: 'L1' })
    expect(deps.openExternal).toHaveBeenCalledWith('https://auth.openai.com/oauth/x')
    await vi.waitFor(() =>
      expect(sender.send).toHaveBeenCalledWith(CODEX_CHANNELS.statusChanged, {
        state: 'connected',
        email: 'a@b.com',
      }),
    )
    expect(provider.awaitLogin).toHaveBeenCalledWith('L1')
  })

  it('returns the device code for the card and opens the verification page', async () => {
    const { deps, invoke } = setup()
    await expect(invoke(CODEX_CHANNELS.login, 'chatgptDeviceCode')).resolves.toEqual({
      method: 'chatgptDeviceCode',
      loginId: 'L2',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'AB-12',
    })
    expect(deps.openExternal).toHaveBeenCalledWith('https://auth.openai.com/codex/device')
  })

  it('refuses unknown methods and never opens a non-https URL', async () => {
    const { invoke, provider, deps } = setup()
    await expect(invoke(CODEX_CHANNELS.login, 'apiKey')).rejects.toThrow(/Unsupported/)
    provider.startLogin.mockResolvedValueOnce({
      method: 'chatgpt',
      loginId: 'L3',
      authUrl: 'file:///C:/evil',
    } as never)
    await invoke(CODEX_CHANNELS.login, 'chatgpt')
    expect(deps.openExternal).not.toHaveBeenCalledWith('file:///C:/evil')
  })

  it('signs out only after the user confirms', async () => {
    const confirm = vi.fn(async () => false)
    const { invoke, provider } = setup({ confirm })
    await expect(invoke(CODEX_CHANNELS.logout)).resolves.toMatchObject({ state: 'connected' })
    expect(provider.logout).not.toHaveBeenCalled()
    expect(confirm.mock.calls[0]![0]).toMatchObject({
      detail: expect.stringMatching(/a@b\.com.*VS Code/s),
    })
    confirm.mockResolvedValueOnce(true)
    await expect(invoke(CODEX_CHANNELS.logout)).resolves.toEqual({ state: 'signed-out' })
  })

  it('asks before replacing the sign-in with an API key and validates the key', async () => {
    const confirm = vi.fn(async () => true)
    const { invoke, provider } = setup({ confirm })
    await expect(invoke(CODEX_CHANNELS.loginApiKey, 42)).rejects.toThrow(/API key/)
    await invoke(CODEX_CHANNELS.loginApiKey, 'sk-x')
    expect(provider.loginWithApiKey).toHaveBeenCalledWith('sk-x')
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending sign-in by id', async () => {
    const { invoke, provider } = setup()
    await invoke(CODEX_CHANNELS.loginCancel, 'L1')
    expect(provider.cancelLogin).toHaveBeenCalledWith('L1')
    await expect(invoke(CODEX_CHANNELS.loginCancel, '')).rejects.toThrow(/loginId/)
  })
})
```

Run: `npm test -w @genoffice/shell -- codex-ipc` → FAIL(module not found).

- [ ] **Step 3: IPC 구현**

`apps/shell/src/main/codex-ipc.ts`:

```ts
import { safeExternalUrl } from '@genoffice/electron-utils'
import type { CodexProvider, CodexStatusView } from '../../../docs/src/main/codex-provider'
import { CODEX_CHANNELS, type CodexLoginStartView } from '../shared/codex-api'

interface SenderLike {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export interface CodexIpcDeps {
  ipcMain: {
    handle(
      channel: string,
      listener: (event: { sender: SenderLike }, ...args: unknown[]) => unknown,
    ): void
  }
  provider: Pick<
    CodexProvider,
    'status' | 'startLogin' | 'awaitLogin' | 'cancelLogin' | 'loginWithApiKey' | 'logout'
  >
  openExternal(url: string): Promise<void>
  /** native confirmation; resolves true for the affirmative button */
  confirm(options: { message: string; detail: string; confirmLabel: string }): Promise<boolean>
}

/**
 * Codex account IPC for the Home settings card. The sign-in URL is opened from
 * main and never sent to the renderer; sign-out and API-key sign-in replace the
 * sign-in that the Codex app and the VS Code extension share, so both ask first.
 */
export function registerCodexIpc(deps: CodexIpcDeps): void {
  const { ipcMain, provider } = deps

  ipcMain.handle(CODEX_CHANNELS.status, () => provider.status())

  ipcMain.handle(CODEX_CHANNELS.login, async (event, method): Promise<CodexLoginStartView> => {
    if (method !== 'chatgpt' && method !== 'chatgptDeviceCode') {
      throw new Error('Unsupported Codex sign-in method')
    }
    const start = await provider.startLogin(method)
    const url = start.method === 'chatgpt' ? start.authUrl : start.verificationUrl
    const safe = safeExternalUrl(url, { allowedProtocols: ['https:'] })
    if (safe) await deps.openExternal(safe)
    void provider.awaitLogin(start.loginId).then(
      (status) => {
        if (!event.sender.isDestroyed()) event.sender.send(CODEX_CHANNELS.statusChanged, status)
      },
      () => undefined,
    )
    return start.method === 'chatgpt'
      ? { method: 'chatgpt', loginId: start.loginId }
      : {
          method: 'chatgptDeviceCode',
          loginId: start.loginId,
          verificationUrl: start.verificationUrl,
          userCode: start.userCode,
        }
  })

  ipcMain.handle(CODEX_CHANNELS.loginCancel, async (_event, loginId) => {
    if (typeof loginId !== 'string' || !loginId) throw new Error('loginId is required')
    await provider.cancelLogin(loginId)
  })

  ipcMain.handle(CODEX_CHANNELS.loginApiKey, async (_event, apiKey): Promise<CodexStatusView> => {
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 16_384) {
      throw new Error('A valid OpenAI API key is required')
    }
    const confirmed = await deps.confirm({
      message: 'Sign Codex in with an API key?',
      detail:
        'This replaces the current Codex sign-in on this computer, including the one the Codex app and the VS Code extension use. Usage is billed to the API key.',
      confirmLabel: 'Use API key',
    })
    if (!confirmed) return provider.status()
    return provider.loginWithApiKey(apiKey)
  })

  ipcMain.handle(CODEX_CHANNELS.logout, async (): Promise<CodexStatusView> => {
    const current = await provider.status()
    const confirmed = await deps.confirm({
      message: 'Sign out of Codex?',
      detail: `${current.email ?? 'This account'} will be signed out on this computer — the Codex app and the VS Code extension use the same sign-in.`,
      confirmLabel: 'Sign out',
    })
    if (!confirmed) return current
    return provider.logout()
  })
}
```

Run: `npm test -w @genoffice/shell -- codex-ipc` → PASS(6).

- [ ] **Step 4: 메인 등록·프리로드·타입**

`apps/shell/src/main/index.ts`:

- import 추가: `import { configureCodexBundledBinary, getCodexProvider } from '../../../docs/src/main/codex-provider'`, `import { registerCodexIpc } from './codex-ipc'`.
- `RHWP_BIN` 정의 바로 아래:

```ts
const CODEX_EXE = process.platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server'
const CODEX_BIN = app.isPackaged
  ? join(process.resourcesPath, 'native', CODEX_EXE)
  : join(APPS_ROOT, 'shell', 'native', 'codex', `${process.platform}-${process.arch}`, CODEX_EXE)
configureCodexBundledBinary(CODEX_BIN)
```

- `registerHomeIpc()` 함수 끝에:

```ts
registerCodexIpc({
  ipcMain,
  provider: getCodexProvider(),
  openExternal: (url) => shell.openExternal(url),
  confirm: async ({ message, detail, confirmLabel }) => {
    const parent = BrowserWindow.getFocusedWindow()
    const options = {
      type: 'warning' as const,
      message,
      detail,
      buttons: [confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    return response === 0
  },
})
```

(`shell`, `dialog`, `BrowserWindow`가 import 목록에 없으면 기존 `electron` import에 추가.)

`apps/shell/src/shared/home-api.ts`: `import type { CodexRendererApi } from './codex-api'` 후 `export interface HomeApi extends CodexRendererApi {`로 확장(기존 멤버 유지).

`apps/shell/src/preload/index.ts`: import `CODEX_CHANNELS`(from `'../shared/codex-api'`), `homeApi` 객체의 `refreshAiModels` 다음에:

```ts
  codexStatus: () => ipcRenderer.invoke(CODEX_CHANNELS.status),
  codexLogin: (method) => ipcRenderer.invoke(CODEX_CHANNELS.login, method),
  codexLoginCancel: (loginId) => ipcRenderer.invoke(CODEX_CHANNELS.loginCancel, loginId),
  codexLoginWithApiKey: (apiKey) => ipcRenderer.invoke(CODEX_CHANNELS.loginApiKey, apiKey),
  codexLogout: () => ipcRenderer.invoke(CODEX_CHANNELS.logout),
  onCodexStatusChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof handler>[0]) =>
      handler(status)
    ipcRenderer.on(CODEX_CHANNELS.statusChanged, listener)
    return () => ipcRenderer.removeListener(CODEX_CHANNELS.statusChanged, listener)
  },
  setCodexCliPath: (path) => ipcRenderer.invoke(AI_CHANNELS.setCodexCliPath, path),
```

`apps/shell/src/renderer/src/settings/ai-settings-api.ts`: `import type { CodexRendererApi } from '../../../shared/codex-api'`, 인터페이스를 `export interface AiSettingsRendererApi extends Partial<CodexRendererApi> {`로(편집기 창의 `window.desktop`에는 Codex 메서드가 없으므로 선택적).

Run: `npm run typecheck -w @genoffice/shell` → 0.

- [ ] **Step 5: 카드 상태 모델 — 실패 테스트**

`apps/shell/tests/codex-card.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { codexCardView } from '../src/renderer/src/settings/codex-card'

const bundled = {
  path: 'C:\\Program Files\\Open GenOffice\\resources\\native\\codex-app-server.exe',
  source: 'bundled' as const,
  version: '0.159.3',
}

describe('codexCardView', () => {
  it('shows checking before the first status arrives', () => {
    expect(codexCardView(null, null)).toMatchObject({ badge: 'checking', actions: [] })
  })

  it('shows the account and plan when connected, with sign-out', () => {
    expect(
      codexCardView(
        {
          state: 'connected',
          accountType: 'chatgpt',
          email: 'a@b.com',
          planType: 'prolite',
          binary: bundled,
        },
        null,
      ),
    ).toEqual({
      badge: 'connected',
      title: 'Connected as a@b.com',
      detail: 'ChatGPT plan: prolite',
      actions: ['logout'],
      binaryLine: 'Codex 0.159.3 · bundled with Open GenOffice',
      deviceCode: null,
    })
  })

  it('labels an API-key sign-in honestly', () => {
    expect(
      codexCardView({ state: 'connected', accountType: 'apiKey', binary: bundled }, null),
    ).toMatchObject({
      title: 'Connected with an OpenAI API key',
      detail: null,
    })
  })

  it('offers every sign-in method when signed out', () => {
    expect(codexCardView({ state: 'signed-out', binary: bundled }, null)).toMatchObject({
      badge: 'signed-out',
      title: 'Not signed in',
      actions: ['login', 'login-device', 'login-api-key'],
    })
  })

  it('shows the device code while a device sign-in is open, and cancel for any open sign-in', () => {
    const device = {
      method: 'chatgptDeviceCode' as const,
      loginId: 'L2',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'AB-12',
    }
    expect(codexCardView({ state: 'signed-out' }, device)).toMatchObject({
      badge: 'signing-in',
      actions: ['cancel'],
      deviceCode: { code: 'AB-12', url: 'https://auth.openai.com/codex/device' },
    })
    expect(
      codexCardView({ state: 'signed-out' }, { method: 'chatgpt', loginId: 'L1' }),
    ).toMatchObject({
      badge: 'signing-in',
      title: 'Finish signing in in your browser',
      actions: ['cancel'],
      deviceCode: null,
    })
  })

  it('surfaces an unusable binary as an error with retry', () => {
    expect(
      codexCardView(
        { state: 'error', message: 'Codex executable not found: D:\\nope\\codex.exe' },
        null,
      ),
    ).toEqual({
      badge: 'error',
      title: 'Codex is unavailable',
      detail: 'Codex executable not found: D:\\nope\\codex.exe',
      actions: ['retry'],
      binaryLine: null,
      deviceCode: null,
    })
  })

  it('names a custom or detected binary by its path', () => {
    const view = codexCardView(
      {
        state: 'signed-out',
        binary: { path: 'D:\\tools\\codex.exe', source: 'custom', version: '0.159.2' },
      },
      null,
    )
    expect(view.binaryLine).toBe('Codex 0.159.2 · custom path D:\\tools\\codex.exe')
  })
})
```

Run: `npm test -w @genoffice/shell -- codex-card` → FAIL.

- [ ] **Step 6: 카드 상태 모델 구현**

`apps/shell/src/renderer/src/settings/codex-card.ts`:

```ts
import type { CodexLoginStartView, CodexStatusView } from '../../../shared/codex-api'

export type CodexCardAction =
  'login' | 'login-device' | 'login-api-key' | 'cancel' | 'logout' | 'retry'

export interface CodexCardView {
  badge: 'checking' | 'connected' | 'signed-out' | 'signing-in' | 'error'
  title: string
  detail: string | null
  actions: CodexCardAction[]
  binaryLine: string | null
  deviceCode: { code: string; url: string } | null
}

const SOURCE_LABELS = {
  bundled: 'bundled with Open GenOffice',
  managed: 'Codex app',
  vscode: 'VS Code extension',
  path: 'on PATH',
} as const

function binaryLine(status: CodexStatusView | null): string | null {
  const binary = status?.binary
  if (!binary) return null
  const version = binary.version ? `Codex ${binary.version}` : 'Codex'
  return binary.source === 'custom'
    ? `${version} · custom path ${binary.path}`
    : `${version} · ${SOURCE_LABELS[binary.source]}`
}

/** pure view model for the Codex card (rendering lives in CodexCard.tsx) */
export function codexCardView(
  status: CodexStatusView | null,
  pending: CodexLoginStartView | null,
): CodexCardView {
  const line = binaryLine(status)
  if (pending) {
    return {
      badge: 'signing-in',
      title:
        pending.method === 'chatgpt'
          ? 'Finish signing in in your browser'
          : 'Enter this code on the OpenAI sign-in page',
      detail: null,
      actions: ['cancel'],
      binaryLine: line,
      deviceCode:
        pending.method === 'chatgptDeviceCode'
          ? { code: pending.userCode, url: pending.verificationUrl }
          : null,
    }
  }
  if (!status) {
    return {
      badge: 'checking',
      title: 'Checking Codex…',
      detail: null,
      actions: [],
      binaryLine: null,
      deviceCode: null,
    }
  }
  if (status.state === 'error') {
    return {
      badge: 'error',
      title: 'Codex is unavailable',
      detail: status.message ?? null,
      actions: ['retry'],
      binaryLine: line,
      deviceCode: null,
    }
  }
  if (status.state === 'signed-out') {
    return {
      badge: 'signed-out',
      title: 'Not signed in',
      detail: 'Sign in with your ChatGPT account to use your plan in every Open GenOffice module.',
      actions: ['login', 'login-device', 'login-api-key'],
      binaryLine: line,
      deviceCode: null,
    }
  }
  const apiKey = status.accountType === 'apiKey'
  return {
    badge: 'connected',
    title: apiKey
      ? 'Connected with an OpenAI API key'
      : `Connected as ${status.email ?? 'your ChatGPT account'}`,
    detail: !apiKey && status.planType ? `ChatGPT plan: ${status.planType}` : null,
    actions: ['logout'],
    binaryLine: line,
    deviceCode: null,
  }
}
```

Run: `npm test -w @genoffice/shell -- codex-card` → PASS(7).

- [ ] **Step 7: 카드 컴포넌트와 모달 배치**

`apps/shell/src/renderer/src/settings/CodexCard.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type {
  CodexLoginStartView,
  CodexRendererApi,
  CodexStatusView,
} from '../../../shared/codex-api'
import { codexCardView, type CodexCardAction } from './codex-card'

const ACTION_LABELS: Record<CodexCardAction, string> = {
  login: 'Sign in with ChatGPT',
  'login-device': 'Use a device code',
  'login-api-key': 'Use an API key',
  cancel: 'Cancel sign-in',
  logout: 'Sign out',
  retry: 'Check again',
}

/** Codex (ChatGPT sign-in) card at the top of AI settings; onChanged reloads providers and models. */
export function CodexCard({
  api,
  customPath,
  onChanged,
}: {
  api: CodexRendererApi
  customPath: string
  onChanged: () => void
}) {
  const [status, setStatus] = useState<CodexStatusView | null>(null)
  const [pending, setPending] = useState<CodexLoginStartView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [path, setPath] = useState(customPath)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void api.codexStatus().then(
      (next) => active && setStatus(next),
      (err: unknown) => active && setError(String(err)),
    )
    const off = api.onCodexStatusChanged((next) => {
      setPending(null)
      setStatus(next)
      onChanged()
    })
    return () => {
      active = false
      off()
    }
  }, [api, onChanged])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onAction = (action: CodexCardAction) =>
    void run(async () => {
      if (action === 'login') setPending(await api.codexLogin('chatgpt'))
      else if (action === 'login-device') setPending(await api.codexLogin('chatgptDeviceCode'))
      else if (action === 'login-api-key') setApiKeyOpen(true)
      else if (action === 'cancel' && pending) {
        await api.codexLoginCancel(pending.loginId)
        setPending(null)
        setStatus(await api.codexStatus())
      } else if (action === 'logout') {
        setStatus(await api.codexLogout())
        onChanged()
      } else if (action === 'retry') setStatus(await api.codexStatus())
    })

  const view = codexCardView(status, pending)

  return (
    <section
      className="ai-provider-card ai-provider-card--codex"
      aria-labelledby="ai-provider-codex"
      data-codex-card
    >
      <div className="ai-provider-card__head">
        <div>
          <h3 id="ai-provider-codex">Codex (ChatGPT)</h3>
          <p>Use your ChatGPT plan through the bundled Codex. No API key needed.</p>
        </div>
        <span
          className={`ai-provider-status ai-provider-status--${view.badge === 'connected' ? 'connected' : view.badge === 'error' ? 'unavailable' : 'not-configured'}`}
          data-codex-badge={view.badge}
        >
          <span aria-hidden="true" />
          {view.title}
        </span>
      </div>
      {view.detail && <p className="ai-provider-card__detail">{view.detail}</p>}
      {view.deviceCode && (
        <p className="ai-provider-card__detail" data-codex-device-code>
          Code <strong>{view.deviceCode.code}</strong> — enter it at {view.deviceCode.url}
        </p>
      )}
      <div className="ai-provider-key-row">
        {view.actions.map((action) => (
          <button
            key={action}
            type="button"
            className={`ai-settings-btn ${action === 'login' ? 'ai-settings-btn--primary' : 'ai-settings-btn--quiet'}`}
            disabled={busy}
            data-codex-action={action}
            onClick={() => onAction(action)}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
      {apiKeyOpen && (
        <div className="ai-provider-key-row">
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            aria-label="OpenAI API key for Codex"
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button
            type="button"
            className="ai-settings-btn ai-settings-btn--primary"
            disabled={busy || !apiKey.trim()}
            onClick={() =>
              void run(async () => {
                setStatus(await api.codexLoginWithApiKey(apiKey))
                setApiKey('')
                setApiKeyOpen(false)
                onChanged()
              })
            }
          >
            Sign in
          </button>
        </div>
      )}
      <details className="ai-provider-card__advanced">
        <summary>Use an installed Codex instead</summary>
        <div className="ai-provider-key-row">
          <input
            type="text"
            value={path}
            spellCheck={false}
            placeholder="Leave empty to use the bundled Codex"
            aria-label="Custom Codex executable path"
            onChange={(event) => setPath(event.target.value)}
          />
          <button
            type="button"
            className="ai-settings-btn ai-settings-btn--quiet"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.setCodexCliPath(path)
                setStatus(await api.codexStatus())
                onChanged()
              })
            }
          >
            Save
          </button>
        </div>
      </details>
      {view.binaryLine && <p className="ai-provider-card__detail">{view.binaryLine}</p>}
      {error && (
        <p className="ai-provider-card__detail" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
```

`AiSettingsModal.tsx`:

- `PROVIDER_HELP`에 `codex: 'Use your ChatGPT plan through Codex.',` 추가(타입이 `Record<PublicAiProviderId, string>`이므로 필수). `PROVIDER_ORDER`에는 **넣지 않는다**(Codex는 전용 카드).
- 모달의 초기 로드 `useEffect`(`Promise.all([api.getAiPublicSettings(), api.listAiModels()])`)의 의존 배열을 `[api, reloadKey]`로 바꾸고, 컴포넌트 상단에 `const [reloadKey, setReloadKey] = useState(0)`와 `const reload = useCallback(() => setReloadKey((key) => key + 1), [])`(react import에 `useCallback` 추가).
- 프로바이더 카드 목록을 렌더하는 위치 바로 앞에:

```tsx
{
  api &&
    api.codexStatus &&
    api.codexLogin &&
    api.codexLoginCancel &&
    api.codexLoginWithApiKey &&
    api.codexLogout &&
    api.onCodexStatusChanged &&
    api.setCodexCliPath && (
      <CodexCard api={api as Required<typeof api>} customPath="" onChanged={reload} />
    )
}
```

(import `CodexCard` from `./CodexCard`.) 사용자 지정 경로의 현재 값은 다음 열기 때 카드의 `binaryLine`(custom path …)으로 보인다 — 입력란은 빈 값으로 시작한다.

- [ ] **Step 8: 검증·커밋**

Run: `npm test -w @genoffice/shell` → 기존 + `codex-ipc`(6)·`codex-card`(7) PASS(기존 `ai-settings-modal.test.ts` 포함). `npm run typecheck`, `npm run lint`, `npm run format` 후 `npm run format:check`.

```bash
git add apps/shell/src apps/shell/tests/codex-ipc.test.ts apps/shell/tests/codex-card.test.ts apps/docs/src/shared/ipc.ts apps/docs/src/main/ai-routing-ipc.ts
git commit -m "$(cat <<'EOF'
shell: Codex sign-in, sign-out and status card in AI settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 계약 테스트, 수용 드라이버, 문서, 설치본

**Files:**

- Create: `packages/ai-provider/tests/codex-app-server.contract.test.ts`, `scripts/drivers/driver.codex.mjs`(gitignored)
- Modify: `README.md`, `MODIFICATIONS.md`, `docs/upstream-provenance.md`, `docs/superpowers/specs/2026-10-01-codex-multi-provider-design.md`(상태 줄), 이 계획의 §"수용 로그"

- [ ] **Step 0: Codex 셸 도구를 끄는 설정 조사 (스펙 §5.6·§8-2)**

read-only sandbox는 Codex 내장 셸 도구의 디스크 읽기를 막지 못한다. 계정을 건드리지 않는 `config/read` RPC로 동봉 바이너리의 설정 키를 확인한다:

임시 파일 `packages/ai-provider/tests/tmp-codex-config.test.ts`(실행 후 삭제, 커밋하지 않음):

```ts
/** @vitest-environment node */
import { join, resolve } from 'node:path'
import { it } from 'vitest'
import { shutdownCodexAppServers, withCodexRpc } from '../src/codex-app-server'

const BIN = join(
  resolve(__dirname, '../../..'),
  'apps/shell/native/codex/win32-x64/codex-app-server.exe',
)

it('prints shell/tool related config keys (read-only)', async () => {
  const config = await withCodexRpc(BIN, (rpc) => rpc.request('config/read', {}))
  const keys: string[] = []
  const walk = (value: unknown, prefix: string): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (/shell|tool|feature/i.test(path))
        keys.push(`${path} = ${JSON.stringify(child).slice(0, 80)}`)
      walk(child, path)
    }
  }
  walk(config, '')
  console.log(keys.join('\n'))
  shutdownCodexAppServers()
}, 30_000)
```

Run: `npm test -w @genoffice/ai-provider -- tmp-codex-config` → 출력된 키를 확인하고 파일을 지운다.

- 셸 도구를 끄는 불리언 키가 **있으면**: `codexAppServerLaunchArgs`의 두 반환값 앞에 `['-c', '<키>=false']`를 붙이고, Task 2의 `codexAppServerLaunchArgs` 테스트 기대값을 같은 값으로 갱신한다(커밋 메시지에 키 이름).
- **없으면**: 변경 없이 수용 로그 "미검증" 칸에 "셸 도구 차단 설정 없음 — read-only sandbox + approvalPolicy never + networkAccess false로 완화"를 기록한다.

- [ ] **Step 1: 계약 테스트 (실바이너리, 계정 변경 RPC 금지)**

`packages/ai-provider/tests/codex-app-server.contract.test.ts`:

```ts
/** @vitest-environment node */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cancelCodexLogin, readCodexAccount, startCodexLogin } from '../src/codex-account'
import { listCodexModels, shutdownCodexAppServers, withCodexRpc } from '../src/codex-app-server'

/**
 * Pins the app-server protocol the app relies on against the bundled binary
 * (npm run fetch:codex). Uses the developer's real ~/.codex sign-in, so it only
 * reads and starts-then-cancels sign-ins. NEVER add account/logout or an apiKey
 * login here: on 2026-10-01 a probe of account/logout signed the machine out.
 */
const exe = process.platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server'
const BIN =
  process.env.CODEX_APP_SERVER_BIN ??
  join(
    resolve(__dirname, '../../..'),
    'apps',
    'shell',
    'native',
    'codex',
    `${process.platform}-${process.arch}`,
    exe,
  )

describe.skipIf(!existsSync(BIN))('codex app-server contract (bundled binary)', () => {
  afterAll(() => shutdownCodexAppServers())

  it('initializes and reports the pinned version', async () => {
    const userAgent = await withCodexRpc(BIN, async (rpc) => rpc.userAgent)
    expect(userAgent).toMatch(/^genoffice\/0\.159\.3 /)
  })

  it('reads the account summary without refreshing tokens', async () => {
    const status = await withCodexRpc(BIN, (rpc) => readCodexAccount(rpc))
    expect(['connected', 'signed-out']).toContain(status.state)
  })

  it('lists models with a default when signed in', async () => {
    const status = await withCodexRpc(BIN, (rpc) => readCodexAccount(rpc))
    if (status.state !== 'connected') return
    const catalog = await listCodexModels(BIN)
    expect(catalog.models.length).toBeGreaterThan(0)
    expect(catalog.models).toContain(catalog.defaultModel)
  })

  it('starts and cancels browser and device-code sign-ins without changing the account', async () => {
    await withCodexRpc(BIN, async (rpc) => {
      const before = await readCodexAccount(rpc)
      const browser = await startCodexLogin(rpc, 'chatgpt')
      expect(browser.authUrl).toMatch(/^https:\/\//)
      await cancelCodexLogin(rpc, browser.loginId)
      const device = await startCodexLogin(rpc, 'chatgptDeviceCode')
      expect(device.verificationUrl).toMatch(/^https:\/\//)
      expect(device.userCode.length).toBeGreaterThan(3)
      await cancelCodexLogin(rpc, device.loginId)
      expect(await readCodexAccount(rpc)).toEqual(before)
    })
  })
})
```

Run: `npm test -w @genoffice/ai-provider -- codex-app-server.contract` → PASS(4) (바이너리 없으면 skipped). 실행 후 `"%USERPROFILE%\.vscode\extensions\openai.chatgpt-*\bin\windows-x86_64\codex.exe" login status`(또는 카드 상태)로 로그인이 그대로인지 확인한다.

- [ ] **Step 2: 수용 드라이버**

`scripts/drivers/driver.codex.mjs`(gitignored, 커밋하지 않음): 개발 셸 또는 `argv[2]`의 패키지 exe를 Playwright로 띄운다. 확인 항목:

1. Home 창에서 `await window.aiOffice.codexStatus()` → `state === 'connected'`, `email` 존재, `binary.source === 'bundled'`.
2. `await window.aiOffice.listAiModels()` → `providerId === 'codex'` 모델에 `gpt-5.6-luna` 포함; `getAiPublicSettings()`의 codex `status === 'connected'`.
3. Home에서 `.quick-card`(`/New HWP/`)로 HWP 탭을 열고, 탭에서 `hwpApi.resolveProjectChat({ filePath: null, tempChatId: 'unsaved-driver-codex' })` → `setAiConversationRoute(identity, { providerId: 'codex', modelId: 'gpt-5.6-luna' })` → `onAiStream`으로 청크를 모으면서 `aiStream({ requestId, conversation: identity, system: 'Reply with one short Korean sentence. If asked to search, call find.', messages: [{ role: 'user', text: '문서에서 "예산"을 찾아줘' }], tools: [{ name: 'find', description: 'Search the document', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] })`.
4. 통과 조건: 120초 안에 `type: 'tool-call'` 청크(`toolCall.name === 'find'`, `input.query`에 `예산` 포함)와 `type: 'done'`; `type: 'error'` 없음.

```js
// Local acceptance driver (gitignored): Codex as the default AI in a built shell.
//   node scripts/drivers/driver.codex.mjs                                  # dev shell
//   node scripts/drivers/driver.codex.mjs <path\to\Open GenOffice.exe>     # packaged build
// Never calls codexLogout / codexLoginWithApiKey — it uses this machine's real Codex sign-in.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(resolve('D:/genoffice/package.json'))
const { _electron: electron } = require('playwright-core')
const SHELL_DIR = 'D:/genoffice/apps/shell'
const OUT = 'D:/genoffice/scripts/drivers/out'
const packagedExe = process.argv[2]
await mkdir(OUT, { recursive: true })

const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
let launchOptions
if (packagedExe) {
  if (!existsSync(packagedExe)) throw new Error(`packaged app not found: ${packagedExe}`)
  const userData = join(process.env.APPDATA, 'Open GenOffice')
  await mkdir(userData, { recursive: true })
  const settings = join(userData, 'app-settings.json')
  if (!existsSync(settings)) await writeFile(settings, JSON.stringify({ onboardingSeen: true }))
  launchOptions = {
    executablePath: packagedExe,
    args: ['--disable-gpu'],
    env: { ...env, GENOFFICE_LANG: 'ko' },
  }
} else {
  const userDataDir = await mkdtemp(join(tmpdir(), 'genoffice-codex-'))
  await writeFile(join(userDataDir, 'app-settings.json'), JSON.stringify({ onboardingSeen: true }))
  launchOptions = {
    executablePath: require('electron'),
    args: [SHELL_DIR, '--disable-gpu'],
    env: { ...env, GENOFFICE_USER_DATA: userDataDir, GENOFFICE_LANG: 'ko' },
  }
}

const app = await electron.launch(launchOptions)
const result = { status: null, codexModels: [], providerStatus: null, chunks: [], error: null }
try {
  const home = await app.firstWindow()
  await home.waitForLoadState('domcontentloaded')
  result.status = await home.evaluate(() => window.aiOffice.codexStatus())
  const models = await home.evaluate(() => window.aiOffice.listAiModels())
  result.codexModels = models.models.filter((m) => m.providerId === 'codex').map((m) => m.id)
  const settings = await home.evaluate(() => window.aiOffice.getAiPublicSettings())
  result.providerStatus = settings.providers.find((p) => p.id === 'codex')?.status ?? null

  const hwpPromise = app.waitForEvent('window', { timeout: 30_000 })
  await home.locator('.quick-card', { hasText: /New HWP/ }).click()
  const hwp = await hwpPromise
  await hwp.waitForLoadState('domcontentloaded')
  result.chunks = await hwp.evaluate(async () => {
    const api = window.hwpApi
    const identity = await api.resolveProjectChat({
      filePath: null,
      tempChatId: 'unsaved-driver-codex',
    })
    await api.setAiConversationRoute(identity, { providerId: 'codex', modelId: 'gpt-5.6-luna' })
    const requestId = `driver-${Date.now()}`
    const chunks = []
    const done = new Promise((resolve) => {
      const off = api.onAiStream((chunk) => {
        if (chunk.requestId !== requestId) return
        chunks.push(
          chunk.type === 'tool-call'
            ? { type: 'tool-call', name: chunk.toolCall.name, input: chunk.toolCall.input }
            : { type: chunk.type, text: chunk.text, error: chunk.error },
        )
        if (chunk.type === 'done' || chunk.type === 'error') {
          off()
          resolve()
        }
      })
    })
    await api.aiStream({
      requestId,
      conversation: identity,
      system: 'Reply with one short Korean sentence. If asked to search, call find.',
      messages: [{ role: 'user', text: '문서에서 "예산"을 찾아줘' }],
      tools: [
        {
          name: 'find',
          description: 'Search the document',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    })
    await Promise.race([done, new Promise((r) => setTimeout(r, 120_000))])
    return chunks
  })
} catch (err) {
  result.error = err instanceof Error ? err.message : String(err)
} finally {
  console.log('RESULT:', JSON.stringify(result, null, 2))
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 20_000))])
  try {
    app.process().kill()
  } catch {
    /* already gone */
  }
}
const toolCall = result.chunks.find((c) => c.type === 'tool-call')
const ok =
  result.status?.state === 'connected' &&
  result.status?.binary?.source === 'bundled' &&
  result.providerStatus === 'connected' &&
  result.codexModels.includes('gpt-5.6-luna') &&
  toolCall?.name === 'find' &&
  String(toolCall.input?.query ?? '').includes('예산') &&
  result.chunks.some((c) => c.type === 'done') &&
  !result.chunks.some((c) => c.type === 'error') &&
  !result.error
process.exit(ok ? 0 : 1)
```

Run: `npm run build:all && node scripts/drivers/driver.codex.mjs` → exit 0.

- [ ] **Step 3: 문서**

`docs/upstream-provenance.md` 끝에 절 추가:

```markdown
## Codex app-server bridge (from upstream)

`packages/ai-provider/src/codex-app-server.ts`, `watchdog.ts`, the stream-callback
subset of `protocols/shared.ts` and the tests `codex-app-server.test.ts` /
`codex-stdout-lines.test.ts` are ported from `genspark-ai/genoffice`
`676bf4d5` (Apache-2.0). Fork changes: binary resolution prefers a custom path
(which must exist), then the bundled app-server, the desktop install, the VS
Code extension's CLI and PATH; the standalone `codex-app-server` is launched
without the CLI subcommand; the client exposes `withCodexRpc` for the account
RPCs in `codex-account.ts`. The app ships the official Codex app-server
(`openai/codex` `rust-v0.159.3`, Apache-2.0) as `resources/native/codex-app-server[.exe]`,
fetched and SHA-256-verified by `tools/fetch-codex.mjs`.
```

`MODIFICATIONS.md`의 프로바이더 불릿 목록 맨 앞에:

```markdown
- Codex (ChatGPT sign-in) as the default AI for new installs: the official
  Codex app-server ships with the app, the upstream app-server bridge is ported,
  and AI settings sign in, sign out and show the account and plan;
```

`README.md`의 기능 불릿(OpenRouter 등 프로바이더 불릿) 앞에:

```markdown
- Uses your ChatGPT plan through Codex by default: the official Codex
  app-server ships with the app, and Settings › AI signs in with ChatGPT (browser
  or device code) or an OpenAI API key, shows the account and plan, and signs
  out. API-key providers keep working alongside it.
```

스펙 상태 줄 `- 상태: 설계 승인(대화), 스펙 검토 대기`를 `- 상태: M1 구현 완료 (2026-10-01) — 계획 docs/superpowers/plans/2026-10-01-codex-default-provider.md`로.

- [ ] **Step 4: 전체 게이트·설치본**

```bash
npm run typecheck
npm run lint
node tools/format-changed.mjs --check --base main
npm test -w @genoffice/ai-provider
npm test -w @genoffice/docs
npm test -w @genoffice/shell
npm test -w @genoffice/hwp
npm test -w @genoffice/slides
npm test -w @genoffice/pdf
```

전부 통과(sheets Windows `EPERM fsync` 3건은 기존 실패라 제외). 이어서 `npm run dist:win` → `apps/shell/release/OpenGenOfficeSetup-v0.4.0-x64.exe` 갱신, `release/win-unpacked/resources/native/codex-app-server.exe` 존재, 설치본 크기 기록. `node scripts/drivers/driver.codex.mjs "apps/shell/release/win-unpacked/Open GenOffice.exe"` → exit 0. (버전 0.5.0 상향은 M2 끝에서 한다.)

- [ ] **Step 5: 수용 로그·커밋·마무리**

아래 §"수용 로그"를 채우고:

```bash
git add README.md MODIFICATIONS.md docs/upstream-provenance.md docs/superpowers/specs/2026-10-01-codex-multi-provider-design.md docs/superpowers/plans/2026-10-01-codex-default-provider.md packages/ai-provider/tests/codex-app-server.contract.test.ts
git commit -m "$(cat <<'EOF'
AI: document Codex as the default provider and record M1 acceptance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

그다음 **REQUIRED SUB-SKILL:** `superpowers:finishing-a-development-branch`.

---

## 수용 로그

2026-10-01, Windows 10 x64, Codex 계정 ChatGPT(prolite).

| 항목                                                 | 결과             | 비고                                                                                                                                                                                     |
| ---------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fetch-codex: SHA256 검증·`--help`                    | **통과**         | `codex-app-server.exe` 248,790,832 B, LICENSE·NOTICE 동봉, 재실행 시 스탬프로 건너뜀                                                                                                     |
| 유닛 — ai-provider(codex 브리지·해석·계정)           | **통과** 114/114 | 업스트림 이식 테스트 20 + 해석·실행 인자·프로세스 사망 회복 7 + 계정 12 + 계약 4                                                                                                         |
| 유닛 — docs(라우팅·설정·공급자)                      | **통과** 521/521 | 라우팅 codex 분기 3, 설정 서비스 codex 8, 공급자 6                                                                                                                                       |
| 유닛 — shell(IPC·카드·패키징)                        | **통과** 151/151 | IPC 6, 카드 모델 7, 모달 3(기본 모델 선택기의 codex 모델·카드 표시·편집기 창 생략)                                                                                                       |
| 기타 회귀                                            | **통과**         | hwp 30, slides 331(+5 skip), pdf 151, project-store 73(codex 라우트 저장 1 추가). sheets는 기존 Windows `EPERM fsync` 3건만 실패(main과 동일)                                            |
| 계약 테스트(동봉 바이너리) 4건 · 실행 후 로그인 유지 | **통과**         | initialize(0.159.3)·`account/read`·`model/list`·브라우저/기기 코드 로그인 시작→취소 후 계정 불변. 이후 `codex login status` = Logged in using ChatGPT                                    |
| 드라이버(개발 셸)                                    | **통과**         | 상태 connected·bundled 0.159.3, 계정 모델 8개(`gpt-5.6-luna` 포함), HWP 탭에서 `gpt-5.6-luna` 실제 턴 → `find {"query":"예산"}` 도구 호출 + done                                         |
| 드라이버(패키지 exe)                                 | **통과**         | `resources/native/codex-app-server.exe`에서 실행, 같은 결과                                                                                                                              |
| 설치본 크기                                          | 214.6 MB         | 이전 153.1 MB(+61.5 MB). `OpenGenOfficeSetup-v0.4.0-x64.exe`                                                                                                                             |
| 셸 도구 차단 설정(Step 0)                            | 없음             | `config/read`에 셸 도구를 끄는 불리언 없음(`allow_login_shell`, `shell_environment_policy.*`, `tools=null`). read-only sandbox + `approvalPolicy: never` + `networkAccess: false`로 완화 |
| 미검증                                               | —                | macOS; 기기 코드·API 키 로그인을 **끝까지** 완료하는 경로(계정을 바꾸므로 자동화하지 않음 — 수동 확인 필요); 설정 카드의 실제 클릭 흐름(드라이버는 IPC로 확인)                           |
