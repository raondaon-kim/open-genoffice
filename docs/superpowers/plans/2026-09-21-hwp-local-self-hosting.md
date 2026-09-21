# HWP 로컬 자립화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한글(.hwp/.hwpx) 편집기와 AI 문서 생성이 인터넷 없이, 설치본에서 동작하게 하고, `rhwp` CLI 바이너리를 같은 패키징 계약으로 동봉해 Phase 2(AI 엔진 표면)의 토대를 만든다.

**Architecture:** `apps/hwp`가 iframe으로 띄우는 rhwp 스튜디오를 원격(`edwardkim.github.io`)에서 받는 대신, 빌드 시 업스트림 태그에서 빌드해 앱에 동봉하고 기존 루프백 HTTP 서버의 `/rhwp/` 경로로 서빙한다. 네이티브 헬퍼 바이너리 두 개 — AI 문서 생성이 쓰는 HwpForge MCP, Phase 2가 쓸 `rhwp` CLI(릴리스 자산, SHA256SUMS 검증) — 는 sheets Rust 사이드카와 같은 `extraResources` 패턴으로 패키징하고 공용 리졸버로 경로를 얻는다. 스튜디오↔호스트 런타임 계약은 바꾸지 않는다.

**Tech Stack:** Electron 41, electron-vite, Vite 8(스튜디오 빌드), `@rhwp/editor`/`@rhwp/core` 0.8.6, `@hwpforge/mcp` 0.16.x, vitest, electron-builder, Node ≥20(스튜디오 빌드는 `import.meta.dirname` 때문에 ≥20.11; 로컬은 22.17)

**Spec:** `docs/superpowers/specs/2026-09-21-hwp-local-self-hosting-design.md` — 계획은 스펙의 §5(컴포넌트 변경), §7(에러 처리), §8(테스트)를 그대로 구현한다. 실행자는 두 문서를 함께 읽는다.

## Global Constraints

- rhwp 버전은 정확히 `0.8.6`으로 고정. `apps/hwp/package.json`의 `@rhwp/core`·`@rhwp/editor`에서 `^` 제거. git 태그 `v0.8.6` = npm 버전.
- 스튜디오 빌드는 `RHWP_DISABLE_EXTERNAL_WEBFONTS=1`로만 한다(함초롬체 CDN은 비상업 조건). `RHWP_WITHOUT_HWPCTRL`은 **절대 설정하지 않는다**(AI 도구가 `plugins.load('hwpctrl')` 호출).
- 스튜디오 빌드에서 `vite-plugin-pwa*` 플러그인을 제거한다. 산출물에 `sw.js`, `registerSW.js`, `manifest.webmanifest`가 있으면 빌드 실패.
- 앱은 `edwardkim.github.io`로 요청을 보내지 않는다. 허용되는 유일한 잔존물은 `@rhwp/editor` 번들 안의 미사용 상수 `DEFAULT_STUDIO_URL` 1건.
- 호스트 CSP `frame-src 'self' http://127.0.0.1:*`. 호스트 CSP에 `'wasm-unsafe-eval'`을 넣지 않는다.
- 스튜디오는 `/rhwp/` prefix, SPA 폴백 없음(미존재 → 404). 렌더러 root(`/`)만 `index.html` 폴백.
- HwpForge는 플랫폼 바이너리를 **직접** spawn한다. npm 런처 JS·`process.execPath`·`ELECTRON_RUN_AS_NODE`를 쓰지 않는다.
- `rhwp` CLI는 GitHub 릴리스 자산(`rhwp-v0.8.6-<os>-<arch>.{zip,tar.gz}`)을 `SHA256SUMS.txt`로 검증해 `apps/hwp/native/rhwp/<platform>-<arch>/`(gitignore)에 두고 `native/rhwp[.exe]`로 패키징한다. 버전은 `@rhwp/core`와 동일. **Phase 1에서는 경로를 주입하기만 하고 호출하지 않는다.**
- `@hwpforge/mcp` 의존성은 `apps/hwp/package.json`에만 둔다(루트에서 제거). 이 패키지는 import되지 않으며, optionalDependencies로 플랫폼 바이너리 패키지를 끌어오는 용도다. **루트 `dependencies`는 electron-builder가 `app.asar`에 자동 수집하므로**, 바이너리를 `extraResources`로 명시 배포하는 이상 루트에 남기면 `asar.unpacked`와 `native/`에 두 번 실린다.
- 코드 스타일: prettier `semi: false, singleQuote, trailingComma: all, printWidth: 100`. 커밋 전 `npm run format`.
- 커밋 메시지는 리포 관례 `HWP: <imperative summary>` + 본문, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- 작업 브랜치 `feat/hwp-local-self-hosting`(이미 체크아웃됨). `main`은 건드리지 않는다.
- 새 유닛 테스트는 `apps/hwp/tests/*.test.ts`. hwp의 vitest 기본 환경은 jsdom이므로 Node 전용 테스트는 파일 첫 줄에 `/** @vitest-environment node */`.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `tools/build-hwp-studio.mjs` (신규) | rhwp 태그 sparse clone → WASM·폰트 배치 → PWA 제거 빌드 → `apps/hwp/dist/studio/` 원자적 교체 → 고지 파일·스탬프 |
| `tools/hwp-studio/vite.config.genoffice.ts` (신규) | 업스트림 Vite 설정을 import해 PWA 플러그인만 제거하는 래퍼. 빌드 시 스튜디오 디렉터리로 복사됨 |
| `apps/hwp/src/main/static-server.ts` (신규) | Electron 의존 없는 루프백 정적 서버. prefix별 root, 탈출 차단, MIME, SPA 폴백 정책 |
| `apps/hwp/src/main/native-binary-path.ts` (신규) | HwpForge·rhwp CLI 공용 바이너리 경로 해석(순수 함수, 우선순위 4단계) |
| `tools/fetch-rhwp-cli.mjs` (신규) | `@rhwp/core` 버전의 rhwp CLI 릴리스 자산을 내려받아 `SHA256SUMS.txt`로 검증, `apps/hwp/native/rhwp/<platform>-<arch>/`에 배치 |
| `apps/hwp/src/main/hwpforge-client.ts` (수정) | 바이너리 직접 spawn, spawn 주입, `error` 이벤트 처리 |
| `apps/hwp/src/main/hwp-main.ts` (수정) | 서버 모듈 사용, `RuntimePaths` 확장, `getStudioUrl` IPC, 표준 경로 조립 |
| `apps/hwp/src/shared/ipc.ts`, `apps/hwp/src/preload/index.ts` (수정) | `getStudioUrl` 채널/API |
| `apps/hwp/src/renderer/App.tsx`, `index.html` (수정) | `studioUrl` 전달, 오류 문구, CSP |
| `apps/shell/src/main/index.ts` (수정) | `studioDir`, `hwpforgePath` 주입 |
| `apps/shell/electron-builder.cjs` (수정) | extraResources 3건, 존재 검사 |
| `tools/gen-third-party-notices.mjs` (수정) | 스튜디오 고지 병합, extraResources 패키지 추출 정규식 |
| `package.json`(루트), `apps/hwp/package.json`, `.gitignore`, `eslint.config.mjs`, `.prettierignore` | 의존성 이동·고정, 스크립트, 무시 규칙 |
| `.github/workflows/ci.yml`, `README.md`, `MODIFICATIONS.md`, `docs/upstream-provenance.md`, 스펙 §8 | CI 단계, 문서 |
| `apps/hwp/tests/{static-server,native-binary-path,hwpforge-client}.test.ts` (신규) | 유닛 테스트 |

---

### Task 0: 준비, 스파이크, 결함 재현

**Files:**
- (리포 변경 없음. 스파이크 산출물은 `C:\Temp\claude\d--genoffice\1644438f-7f48-4eb2-a9d1-60920d831374\scratchpad\hwp-spike\`에 두고 버린다.)

**Interfaces:**
- Produces: 스파이크 판정(go / wasm-pack 폴백 필요), 수정 전 설치본에서 K-12 서식 버튼이 실패한다는 기록(에러 문구).

- [x] **Step 1: 의존성 설치** (완료 2026-09-21)

Run (리포 루트 `D:\genoffice`):
```bash
npm ci
ls node_modules/@rhwp/core/rhwp_bg.wasm node_modules/@rhwp/editor/index.js node_modules/@hwpforge/mcp-win32-x64/bin/hwpforge-mcp.exe
```
Expected: 세 파일 모두 존재. `@hwpforge/mcp-win32-x64`만 있고 darwin/linux는 없는 것이 정상(npm은 현재 OS의 optional 플랫폼 패키지만 설치).

- [x] **Step 2: 수정 전 기준선 — 패키지 앱에서 HwpForge 경로가 동작함을 확인 (스펙 §8 수용 1)**

현재 HEAD는 스펙·계획 문서만 추가된 상태라 코드는 `main`과 동일하다. 설계 초기의 "설치본에서
`create_document`가 실패한다"는 가설을 검증하는 단계였고, **결과는 반대(동작함)**였다 — 스펙 §1·§2에
반영됨. 이후 Task 3·7은 결함 수정이 아니라 명시적 패키징 계약으로의 구조 개선이다.

Run:
```bash
npm run dist:win
node scripts/drivers/driver.hwp-k12.mjs   # release/win-unpacked/Open GenOffice.exe 를 구동
```
드라이버(`scripts/drivers/driver.hwp-k12.mjs`, gitignored, 리포 관례 `_electron.launch`)는 Home → "New HWP"
카드 → HWP 탭에서 `window.hwpApi.createDocument(markdown, name)`을 호출한다 — K-12 버튼이 호출하는
것과 동일한 IPC이며, 버튼 자체는 AI 모델이 0개인 새 설치본에서는 렌더되지 않는다(`AiPanel.tsx:575`).

결과(2026-09-21): `{ ok: true, path: "…ai-created드라이버_테스트-<ts>.hwpx" }`, 8,197바이트 `.hwpx` 생성,
새 탭 `Open GenOffice HWP` 오픈. asar 헤더 파싱: `node_modules/@hwpforge/mcp`, `@hwpforge/mcp-win32-x64`,
`ws` 포함(= 루트 `dependencies`), `.exe`는 `app.asar.unpacked`에 서명되어 존재.

정리: 설치하지 않았으므로 제거할 것이 없다. 드라이버가 만든 `%APPDATA%Open GenOfficeapp-settings.json`과
`ai-created` 산출물은 앱의 정상 userData이며 그대로 둔다.

- [x] **Step 3: 스파이크 — rhwp-studio를 `@rhwp/core` WASM으로 빌드해 로컬 서빙 확인 (스펙 §9)**

작업 폴더 생성 후 sparse clone (`samples`는 스파이크용 샘플 문서 확보를 위해 추가):
```bash
mkdir -p "C:/Temp/claude/d--genoffice/1644438f-7f48-4eb2-a9d1-60920d831374/scratchpad/hwp-spike"
cd "C:/Temp/claude/d--genoffice/1644438f-7f48-4eb2-a9d1-60920d831374/scratchpad/hwp-spike"
git clone --filter=blob:none --sparse --depth 1 --branch v0.8.6 https://github.com/edwardkim/rhwp rhwp
# git < 2.37: clone --sparse leaves cone mode off, and pattern-mode `set` drops the root files
git -C rhwp config core.sparseCheckoutCone true
git -C rhwp sparse-checkout set rhwp-studio npm/hwpctrl-ocx npm/editor assets/fonts assets/logo samples
ls rhwp/LICENSE rhwp/THIRD_PARTY_LICENSES.md rhwp/rhwp-studio/vite.config.ts
ls rhwp/samples | grep -iE "\.hwpx?$" | head
```
Expected: 루트 파일 2개와 `vite.config.ts` 존재, samples에 `.hwp`/`.hwpx` 파일 목록 출력. 하나를 골라 `SAMPLE` 경로로 기억한다. (`samples/`는 약 500MB — 스파이크 전용이며 프로덕션 스크립트의 sparse 집합에는 없다.)

WASM·폰트 배치:
```bash
CORE=/d/genoffice/node_modules/@rhwp/core
mkdir -p rhwp/pkg
cp "$CORE"/rhwp.js "$CORE"/rhwp_bg.wasm "$CORE"/rhwp.d.ts "$CORE"/rhwp_bg.wasm.d.ts rhwp/pkg/
cp rhwp/pkg/rhwp.js rhwp/pkg/rhwp_bg.wasm rhwp/rhwp-studio/public/
rm -rf rhwp/rhwp-studio/public/fonts
cp -r rhwp/assets/fonts rhwp/rhwp-studio/public/fonts
cp rhwp/assets/logo/favicon.ico rhwp/rhwp-studio/public/favicon.ico
# 정보: 커밋된 public/rhwp.js와 npm core의 rhwp.js가 같은가 (다르면 커밋본이 stale인지 기록)
git -C rhwp show HEAD:rhwp-studio/public/rhwp.js | diff -q - "$CORE/rhwp.js" && echo SAME || echo DIFFERENT
```

PWA 제거 래퍼 설정 작성 — `rhwp/rhwp-studio/vite.config.genoffice.ts` (Task 5에서 리포에 들어갈 파일과 동일 내용):
```ts
// Copied next to upstream's vite.config.ts by tools/build-hwp-studio.mjs.
// Reuses the upstream Vite config but drops vite-plugin-pwa: the studio is
// served from a loopback origin whose port changes on every launch, so a
// service worker would only accumulate registrations and WASM caches in
// userData.
import base from './vite.config.ts'

type PluginLike = { name?: unknown } | null | undefined | false

const flatten = (items: unknown[]): PluginLike[] =>
  items.flatMap((item) => (Array.isArray(item) ? flatten(item) : [item as PluginLike]))

const isPwa = (plugin: PluginLike): boolean =>
  Boolean(
    plugin &&
      typeof plugin === 'object' &&
      typeof plugin.name === 'string' &&
      plugin.name.startsWith('vite-plugin-pwa'),
  )

const config = base as { plugins?: unknown[] }

export default {
  ...config,
  plugins: flatten(config.plugins ?? []).filter((plugin) => !isPwa(plugin)),
}
```

빌드 (Git Bash에서는 `MSYS_NO_PATHCONV=1`이 필수 — 없으면 MSYS가 `--base=/rhwp/`를 `/Program Files/Git/rhwp/`로 변환해 `index.html` 참조가 깨진다; 프로덕션 스크립트는 Node→cmd.exe로 실행하므로 영향 없음):
```bash
cd rhwp/rhwp-studio
npm ci
MSYS_NO_PATHCONV=1 RHWP_DISABLE_EXTERNAL_WEBFONTS=1 npx vite build --base=/rhwp/ --config vite.config.genoffice.ts --outDir ../dist-staging --emptyOutDir
ls ../dist-staging
ls ../dist-staging/sw.js ../dist-staging/registerSW.js ../dist-staging/manifest.webmanifest 2>&1 | grep -c "No such file"
cd ../..
```
Expected: `dist-staging/index.html`, `dist-staging/rhwp_bg.wasm`, `dist-staging/assets/`, `dist-staging/fonts/` 존재. 마지막 명령은 `3`(PWA 산출물 3개 모두 없음).

던지는 정적 서버 `serve.mjs` 작성 (스파이크 폴더 루트):
```js
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const [, , distDir, editorDir, sampleFile] = process.argv
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}
const HARNESS = `<!doctype html><html><body style="margin:0">
<div id="host" style="width:100vw;height:100vh"></div>
<script type="module">
import { createEditor } from '/editor/index.js'
const ed = await createEditor('#host', { studioUrl: location.origin + '/rhwp/' })
const res = await fetch('/sample')
const r = await ed.loadFile(new Uint8Array(await res.arrayBuffer()), 'sample.hwpx')
document.title = 'pages=' + r.pageCount
console.log('SPIKE OK pages=', r.pageCount)
</script></body></html>`

createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file
  if (p === '/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(HARNESS)
  }
  if (p === '/sample') file = sampleFile
  else if (p.startsWith('/rhwp/')) {
    file = join(distDir, p.slice('/rhwp/'.length) || 'index.html')
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  } else if (p.startsWith('/editor/')) file = join(editorDir, p.slice('/editor/'.length))
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(7790, '127.0.0.1', () => console.log('spike: http://127.0.0.1:7790/'))
```

Run:
```bash
node serve.mjs rhwp/dist-staging /d/genoffice/node_modules/@rhwp/editor "rhwp/samples/<SAMPLE>"
```
브라우저(Edge/Chrome)로 `http://127.0.0.1:7790/` 열기.
Expected: 한글 문서가 렌더되고 탭 제목이 `pages=N`. DevTools 콘솔에 `SPIKE OK pages= N`, 빨간 오류 없음. Network 탭에서 `edwardkim.github.io` 요청 0건, WASM은 `127.0.0.1:7790/rhwp/rhwp_bg.wasm`에서 로드.

- [x] **Step 4: 판정** — GO (2026-09-21)

- 렌더 성공 → Task 1로 진행.
- 스튜디오가 WASM 로드/초기화에서 실패(콘솔에 `rhwp_bg.wasm` 관련 오류, export 누락 등) → **여기서 멈추고 보고한다.** 스펙 §9 폴백(wasm-pack으로 `pkg/` 직접 빌드)을 Task 5 스크립트에 반영하는 설계 변경이 필요하며, 이는 사용자 승인 사안이다.

---

### Task 1: 루프백 정적 서버 모듈

**Files:**
- Create: `apps/hwp/src/main/static-server.ts`
- Test: `apps/hwp/tests/static-server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StaticRoot { prefix: string; dir: string; spaFallback: boolean }
  export interface StaticServer { origin: string; close(): Promise<void> }
  export type Resolution = { kind: 'file'; path: string } | { kind: 'forbidden' } | { kind: 'missing' }
  export function mimeFor(path: string): string
  export function matchRoot(roots: StaticRoot[], urlPath: string): StaticRoot | null
  export function resolveFile(root: StaticRoot, urlPath: string): Resolution
  export function createStaticServer(opts: { roots: StaticRoot[] }): Promise<StaticServer>
  ```
  Task 4의 `hwp-main.ts`가 `createStaticServer`와 `StaticRoot`를 사용한다.

- [x] **Step 1: 실패하는 테스트 작성**

`apps/hwp/tests/static-server.test.ts`:
```ts
/** @vitest-environment node */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createStaticServer,
  matchRoot,
  mimeFor,
  resolveFile,
  type StaticRoot,
  type StaticServer,
} from '../src/main/static-server'

let base: string
let renderer: string
let studio: string
let outside: string
let roots: StaticRoot[]
let server: StaticServer
const WASM_BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0])

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'hwp-static-'))
  renderer = join(base, 'renderer')
  studio = join(base, 'studio')
  outside = join(base, 'outside')
  await mkdir(join(renderer, 'assets'), { recursive: true })
  await mkdir(join(studio, 'assets'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(renderer, 'index.html'), 'RENDERER')
  await writeFile(join(renderer, 'assets', 'app.js'), 'console.log(1)')
  await writeFile(join(studio, 'index.html'), 'STUDIO')
  await writeFile(join(studio, 'rhwp_bg.wasm'), WASM_BYTES)
  await writeFile(join(studio, 'assets', 'x.js'), 'x')
  await writeFile(join(outside, 'secret.txt'), 'SECRET')
  // '/' listed first on purpose: matching must pick the longest prefix, not the first
  roots = [
    { prefix: '/', dir: renderer, spaFallback: true },
    { prefix: '/rhwp/', dir: studio, spaFallback: false },
  ]
  server = await createStaticServer({ roots })
})

afterAll(async () => {
  await server.close()
  await rm(base, { recursive: true, force: true })
})

const get = (path: string, init?: RequestInit) => fetch(`${server.origin}${path}`, init)

describe('matchRoot', () => {
  it('picks the longest matching prefix', () => {
    expect(matchRoot(roots, '/rhwp/index.html')?.dir).toBe(studio)
    expect(matchRoot(roots, '/index.html')?.dir).toBe(renderer)
  })
  it('does not treat /rhwpx as the studio prefix', () => {
    expect(matchRoot(roots, '/rhwpx/y')?.dir).toBe(renderer)
  })
})

describe('resolveFile', () => {
  it('serves index.html for a directory request', () => {
    expect(resolveFile(roots[1], '/rhwp/')).toEqual({ kind: 'file', path: join(studio, 'index.html') })
  })
  it('reports missing files under a root without SPA fallback', () => {
    expect(resolveFile(roots[1], '/rhwp/nope.js')).toEqual({ kind: 'missing' })
  })
  it('falls back to index.html under a root with SPA fallback', () => {
    expect(resolveFile(roots[0], '/some/client/route')).toEqual({
      kind: 'file',
      path: join(renderer, 'index.html'),
    })
  })
  it('never resolves to a file outside the root', () => {
    // absolute path (forbidden on Windows drive letters, stripped to a miss on POSIX)
    expect(resolveFile(roots[1], `/rhwp/${join(outside, 'secret.txt')}`).kind).not.toBe('file')
    // dot segments are stripped, so the path stays inside the root
    expect(resolveFile(roots[1], '/rhwp/../../outside/secret.txt').kind).not.toBe('file')
  })
})

describe('mimeFor', () => {
  it('knows wasm, fonts and falls back to octet-stream', () => {
    expect(mimeFor('/a/rhwp_bg.wasm')).toBe('application/wasm')
    expect(mimeFor('/a/f.woff2')).toBe('font/woff2')
    expect(mimeFor('/a/f.otf')).toBe('font/otf')
    expect(mimeFor('/a/unknown.bin')).toBe('application/octet-stream')
  })
})

describe('createStaticServer', () => {
  it('listens on a loopback http origin', () => {
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
  it('serves each root under its prefix', async () => {
    expect(await (await get('/index.html')).text()).toBe('RENDERER')
    expect(await (await get('/rhwp/index.html')).text()).toBe('STUDIO')
    expect(await (await get('/rhwp/')).text()).toBe('STUDIO')
    expect(await (await get('/assets/app.js')).text()).toBe('console.log(1)')
  })
  it('serves wasm with the application/wasm type and no-store', async () => {
    const res = await get('/rhwp/rhwp_bg.wasm')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/wasm')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WASM_BYTES)
  })
  it('returns 404 for missing studio files instead of index.html', async () => {
    expect((await get('/rhwp/does-not-exist.js')).status).toBe(404)
  })
  it('falls back to index.html for unknown renderer routes', async () => {
    const res = await get('/some/client/route')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('RENDERER')
  })
  it('rejects non-GET methods', async () => {
    expect((await get('/index.html', { method: 'POST' })).status).toBe(405)
  })
  it('answers HEAD with headers only', async () => {
    const res = await get('/rhwp/index.html', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
  it('never serves files outside a root', async () => {
    // Encoded separators and absolute paths reach the server verbatim and must
    // be refused there. Plain dot segments are collapsed by the URL parser
    // before the request leaves the client, so that form only proves the body.
    for (const path of [
      '/rhwp/..%2F..%2Foutside%2Fsecret.txt',
      `/rhwp/${encodeURIComponent(join(outside, 'secret.txt'))}`,
    ]) {
      const res = await get(path)
      expect([403, 404]).toContain(res.status)
      expect(await res.text()).not.toBe('SECRET')
    }
    const collapsed = await get('/rhwp/../../outside/secret.txt')
    expect(await collapsed.text()).not.toBe('SECRET')
  })
  it('returns 400 on malformed percent-encoding', async () => {
    expect((await get('/rhwp/%E0%A4%A')).status).toBe(400)
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npm test -w @genoffice/hwp`
Expected: FAIL — `Cannot find module '../src/main/static-server'` (또는 동등한 해석 오류).

- [x] **Step 3: 구현**

`apps/hwp/src/main/static-server.ts`:
```ts
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, normalize, resolve, sep } from 'node:path'

/**
 * Loopback static file server shared by the hwp renderer (production) and the
 * bundled rhwp studio (always). The studio SDK rejects opaque origins
 * (file:/data:), so both are served over one http://127.0.0.1:<port> origin.
 * No Electron imports: this module is unit-tested under plain Node.
 */

export interface StaticRoot {
  /** URL prefix; must start and end with '/' — e.g. '/rhwp/' or '/' */
  prefix: string
  /** absolute directory served under prefix */
  dir: string
  /** serve dir/index.html for paths that do not exist (SPA); false → 404 */
  spaFallback: boolean
}

export interface StaticServer {
  origin: string
  close(): Promise<void>
}

export type Resolution =
  | { kind: 'file'; path: string }
  | { kind: 'forbidden' }
  | { kind: 'missing' }

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}

export function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** Pick the root with the longest matching prefix; null when none matches. */
export function matchRoot(roots: StaticRoot[], urlPath: string): StaticRoot | null {
  let best: StaticRoot | null = null
  for (const root of roots) {
    if (!urlPath.startsWith(root.prefix)) continue
    if (!best || root.prefix.length > best.prefix.length) best = root
  }
  return best
}

/**
 * Map a URL path to a file inside root.dir. Leading separators and '..'
 * segments are stripped and the resolved path must stay inside the root;
 * anything else is 'forbidden'. Directories resolve to their index.html.
 */
export function resolveFile(root: StaticRoot, urlPath: string): Resolution {
  const relative = normalize(urlPath.slice(root.prefix.length)).replace(/^([/\\]|\.\.)+/, '')
  const dir = resolve(root.dir)
  let filePath = resolve(dir, relative)
  if (filePath !== dir && !filePath.startsWith(dir + sep)) return { kind: 'forbidden' }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html')
  }
  if (existsSync(filePath) && statSync(filePath).isFile()) return { kind: 'file', path: filePath }
  if (root.spaFallback) {
    const index = join(dir, 'index.html')
    if (existsSync(index)) return { kind: 'file', path: index }
  }
  return { kind: 'missing' }
}

export function createStaticServer(opts: { roots: StaticRoot[] }): Promise<StaticServer> {
  const { roots } = opts
  return new Promise<StaticServer>((resolveServer, reject) => {
    const server = createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end()
        return
      }
      let urlPath: string
      try {
        urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      } catch {
        res.writeHead(400).end()
        return
      }
      const root = matchRoot(roots, urlPath)
      if (!root) {
        res.writeHead(404).end()
        return
      }
      const resolution = resolveFile(root, urlPath)
      if (resolution.kind === 'forbidden') {
        res.writeHead(403).end()
        return
      }
      if (resolution.kind === 'missing') {
        res.writeHead(404).end()
        return
      }
      const target = resolution.path
      void readFile(target)
        .then((bytes) => {
          res.writeHead(200, {
            'content-type': mimeFor(target),
            'content-length': bytes.byteLength,
            'cache-control': 'no-store',
          })
          res.end(req.method === 'HEAD' ? undefined : bytes)
        })
        .catch(() => res.writeHead(404).end())
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveServer({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      })
    })
  })
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test -w @genoffice/hwp`
Expected: PASS, `static-server.test.ts` 전 케이스 녹색.

Run: `npm run typecheck -w @genoffice/hwp`
Expected: 오류 없음.

- [x] **Step 5: 커밋**

```bash
npm run format
git add apps/hwp/src/main/static-server.ts apps/hwp/tests/static-server.test.ts
git commit -m "$(cat <<'EOF'
HWP: extract the loopback static server into a testable module

The renderer's loopback server in hwp-main.ts will also serve the bundled
rhwp studio, so it needs prefix routing, a wasm MIME type and a per-root
fallback policy. Pull it out of the Electron-bound main module so it can be
unit-tested under Node.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 네이티브 바이너리 경로 해석 (HwpForge · rhwp CLI 공용)

**Files:**
- Create: `apps/hwp/src/main/native-binary-path.ts`
- Test: `apps/hwp/tests/native-binary-path.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type NativeBinaryName = 'hwpforge-mcp' | 'rhwp'
  export interface NativeBinaryInput {
    runtimePath?: string; envPath?: string; isPackaged: boolean
    resourcesPath: string; repoRoot: string; platform: NodeJS.Platform; arch: string
  }
  export function nativeExecutableName(name: NativeBinaryName, platform: NodeJS.Platform): string
  export function resolveNativeBinary(name: NativeBinaryName, input: NativeBinaryInput): string
  ```
  Task 3의 `hwp-main.ts` 호출 지점(`'hwpforge-mcp'`), Task 4의 셸 주입, 그리고 Phase 2의 `rhwp` 호출이 사용한다.

- [x] **Step 1: 실패하는 테스트 작성**

`apps/hwp/tests/native-binary-path.test.ts`:
```ts
/** @vitest-environment node */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nativeExecutableName, resolveNativeBinary } from '../src/main/native-binary-path'

const base = {
  isPackaged: false,
  resourcesPath: join('C:', 'app', 'resources'),
  repoRoot: join('D:', 'genoffice'),
  platform: 'win32' as NodeJS.Platform,
  arch: 'x64',
}

describe('nativeExecutableName', () => {
  it('adds .exe on win32 only', () => {
    expect(nativeExecutableName('hwpforge-mcp', 'win32')).toBe('hwpforge-mcp.exe')
    expect(nativeExecutableName('hwpforge-mcp', 'darwin')).toBe('hwpforge-mcp')
    expect(nativeExecutableName('rhwp', 'win32')).toBe('rhwp.exe')
    expect(nativeExecutableName('rhwp', 'linux')).toBe('rhwp')
  })
})

describe('resolveNativeBinary', () => {
  it('prefers the runtime-injected path over everything', () => {
    expect(
      resolveNativeBinary('hwpforge-mcp', { ...base, runtimePath: 'R', envPath: 'E', isPackaged: true }),
    ).toBe('R')
  })
  it('falls back to the environment override', () => {
    expect(resolveNativeBinary('rhwp', { ...base, envPath: 'E', isPackaged: true })).toBe('E')
  })
  it('uses resources/native in packaged builds', () => {
    expect(resolveNativeBinary('hwpforge-mcp', { ...base, isPackaged: true })).toBe(
      join(base.resourcesPath, 'native', 'hwpforge-mcp.exe'),
    )
    expect(resolveNativeBinary('rhwp', { ...base, isPackaged: true, platform: 'darwin' })).toBe(
      join(base.resourcesPath, 'native', 'rhwp'),
    )
  })
  it('uses the hoisted platform package for HwpForge in dev', () => {
    expect(resolveNativeBinary('hwpforge-mcp', base)).toBe(
      join(base.repoRoot, 'node_modules', '@hwpforge', 'mcp-win32-x64', 'bin', 'hwpforge-mcp.exe'),
    )
    expect(resolveNativeBinary('hwpforge-mcp', { ...base, platform: 'darwin', arch: 'arm64' })).toBe(
      join(base.repoRoot, 'node_modules', '@hwpforge', 'mcp-darwin-arm64', 'bin', 'hwpforge-mcp'),
    )
  })
  it('uses apps/hwp/native/rhwp for the rhwp CLI in dev', () => {
    expect(resolveNativeBinary('rhwp', base)).toBe(
      join(base.repoRoot, 'apps', 'hwp', 'native', 'rhwp', 'win32-x64', 'rhwp.exe'),
    )
    expect(resolveNativeBinary('rhwp', { ...base, platform: 'darwin', arch: 'arm64' })).toBe(
      join(base.repoRoot, 'apps', 'hwp', 'native', 'rhwp', 'darwin-arm64', 'rhwp'),
    )
  })
  it('ignores empty strings for runtime and env overrides', () => {
    expect(resolveNativeBinary('rhwp', { ...base, runtimePath: '', envPath: '', isPackaged: true })).toBe(
      join(base.resourcesPath, 'native', 'rhwp.exe'),
    )
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npm test -w @genoffice/hwp -- native-binary-path`
Expected: FAIL — 모듈 없음.

- [x] **Step 3: 구현**

`apps/hwp/src/main/native-binary-path.ts`:
```ts
import { join } from 'node:path'

/**
 * Where the native helper binaries live. Mirrors
 * apps/sheets/src/main/sheets-main.ts resolveSidecarPath(): the shell injects
 * the path, an env var can override it, packaged builds carry each binary as an
 * extraResource under resources/native, and dev runs use the build-time
 * location — for HwpForge the platform package that `@hwpforge/mcp` pulls in
 * through optionalDependencies (never imported; declared in apps/hwp only to
 * install the binary), for the rhwp CLI apps/hwp/native/rhwp filled by
 * tools/fetch-rhwp-cli.mjs from the pinned upstream release.
 */
export type NativeBinaryName = 'hwpforge-mcp' | 'rhwp'

export interface NativeBinaryInput {
  runtimePath?: string
  envPath?: string
  isPackaged: boolean
  resourcesPath: string
  repoRoot: string
  platform: NodeJS.Platform
  arch: string
}

export function nativeExecutableName(name: NativeBinaryName, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}

function devPath(name: NativeBinaryName, input: NativeBinaryInput, exe: string): string {
  const target = `${input.platform}-${input.arch}`
  switch (name) {
    case 'hwpforge-mcp':
      return join(input.repoRoot, 'node_modules', '@hwpforge', `mcp-${target}`, 'bin', exe)
    case 'rhwp':
      return join(input.repoRoot, 'apps', 'hwp', 'native', 'rhwp', target, exe)
  }
}

export function resolveNativeBinary(name: NativeBinaryName, input: NativeBinaryInput): string {
  const exe = nativeExecutableName(name, input.platform)
  if (input.runtimePath) return input.runtimePath
  if (input.envPath) return input.envPath
  if (input.isPackaged) return join(input.resourcesPath, 'native', exe)
  return devPath(name, input, exe)
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test -w @genoffice/hwp -- native-binary-path`
Expected: PASS.

- [x] **Step 5: 커밋**

```bash
npm run format
git add apps/hwp/src/main/native-binary-path.ts apps/hwp/tests/native-binary-path.test.ts
git commit -m "$(cat <<'EOF'
HWP: resolve native helper binaries like the sheets sidecar

Runtime injection → env override → resources/native (packaged) → build-time
location (dev), shared by the HwpForge MCP binary and the rhwp CLI. Pure
function so the priority order is unit-tested.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: HwpForge 클라이언트 — 바이너리 직접 spawn

**Files:**
- Modify: `apps/hwp/src/main/hwpforge-client.ts` (전체 교체)
- Modify: `apps/hwp/src/main/hwp-main.ts:198-206` (`RuntimePaths`), `:12` (import), `:353-369` (createDocument 핸들러)
- Test: `apps/hwp/tests/hwpforge-client.test.ts`

**Interfaces:**
- Consumes: `resolveNativeBinary('hwpforge-mcp', …)` (Task 2).
- Produces:
  ```ts
  export type SpawnLike = (command: string, args: readonly string[], options: { stdio: ['pipe','pipe','pipe'] }) => ChildProcessWithoutNullStreams
  export interface McpCallOptions { binPath: string; spawnImpl?: SpawnLike; timeoutMs?: number }
  export function mcpCall(toolName: string, args: Record<string, unknown>, options: McpCallOptions): Promise<string>
  export interface CreateHwpResult { ok: boolean; path?: string; error?: string }
  export function createHwpFromMarkdown(markdown: string, destDir: string, baseName: string, options: McpCallOptions): Promise<CreateHwpResult>
  ```
  `RuntimePaths.hwpforgePath?: string` 추가(Task 4의 셸 주입이 채움).

- [x] **Step 1: 실패하는 테스트 작성**

`apps/hwp/tests/hwpforge-client.test.ts`:
```ts
/** @vitest-environment node */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createHwpFromMarkdown, mcpCall, type SpawnLike } from '../src/main/hwpforge-client'

type Line = { jsonrpc: string; id?: number; method: string; params?: Record<string, unknown> }
type Reply = (message: unknown) => void
type Script = (line: Line, reply: Reply, child: FakeChild) => void

interface FakeChild extends EventEmitter {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  kill(): boolean
}

/** A child process that answers JSON-RPC lines on stdin according to `script`. */
function fakeChild(script: Script): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  let buffer = ''
  child.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!raw) continue
      script(JSON.parse(raw) as Line, (msg) => child.stdout.write(`${JSON.stringify(msg)}\n`), child)
    }
  })
  return child
}

/** Scripted server: initialize → ok, notifications → silent, tools/call → `onCall` */
const answering =
  (onCall: (params: Record<string, unknown>) => unknown): Script =>
  (line, reply) => {
    if (line.method === 'initialize') {
      reply({ jsonrpc: '2.0', id: line.id, result: { protocolVersion: '2025-03-26' } })
    } else if (line.method === 'tools/call') {
      reply({ jsonrpc: '2.0', id: line.id, result: onCall(line.params ?? {}) })
    }
  }

const spawnWith = (child: FakeChild) =>
  vi.fn<SpawnLike>(() => child as unknown as ChildProcessWithoutNullStreams)

describe('mcpCall', () => {
  it('spawns the binary directly, drives initialize + tools/call and returns the text', async () => {
    const child = fakeChild(
      answering((params) => ({
        content: [{ type: 'text', text: `converted ${(params as { name: string }).name}` }],
      })),
    )
    const spawnImpl = spawnWith(child)
    const text = await mcpCall('hwpforge_convert', { markdown: 'x.md' }, {
      binPath: '/bin/hwpforge-mcp',
      spawnImpl,
    })
    expect(text).toBe('converted hwpforge_convert')
    expect(spawnImpl).toHaveBeenCalledWith('/bin/hwpforge-mcp', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    expect(child.killed).toBe(true)
  })

  it('throws when the tool reports isError', async () => {
    const child = fakeChild(
      answering(() => ({ isError: true, content: [{ type: 'text', text: 'bad markdown' }] })),
    )
    await expect(
      mcpCall('hwpforge_convert', {}, { binPath: '/bin/x', spawnImpl: spawnWith(child) }),
    ).rejects.toThrow(/hwpforge hwpforge_convert failed: bad markdown/)
  })

  it('rejects with the binary path when the process cannot be spawned', async () => {
    const child = fakeChild(() => undefined)
    const spawnImpl = vi.fn<SpawnLike>(() => {
      setImmediate(() =>
        child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
      )
      return child as unknown as ChildProcessWithoutNullStreams
    })
    await expect(
      mcpCall('hwpforge_convert', {}, { binPath: '/missing/hwpforge-mcp.exe', spawnImpl }),
    ).rejects.toThrow(/not found or not executable: \/missing\/hwpforge-mcp\.exe \(ENOENT\)/)
  })

  it('times out when the server never answers', async () => {
    const child = fakeChild(() => undefined)
    await expect(
      mcpCall('hwpforge_convert', {}, { binPath: '/bin/x', spawnImpl: spawnWith(child), timeoutMs: 50 }),
    ).rejects.toThrow(/hwpforge initialize timed out/)
    expect(child.killed).toBe(true)
  })
})

describe('createHwpFromMarkdown', () => {
  it('writes the markdown, calls hwpforge_convert with is_file and returns the output path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hwpforge-'))
    try {
      let seen: Record<string, unknown> | null = null
      const child = fakeChild(
        answering((params) => {
          const args = (params as { arguments: Record<string, unknown> }).arguments
          seen = args
          writeFileSync(args.output_path as string, 'HWPX')
          return { content: [{ type: 'text', text: 'ok' }] }
        }),
      )
      const result = await createHwpFromMarkdown('# 제목\n\n본문', dir, '주간 보고서', {
        binPath: '/bin/x',
        spawnImpl: spawnWith(child),
      })
      expect(result.ok).toBe(true)
      expect(result.path).toMatch(/주간_보고서-\d+\.hwpx$/)
      expect(existsSync(result.path!)).toBe(true)
      expect(seen).toMatchObject({ is_file: true })
      expect((seen as unknown as { markdown: string }).markdown).toMatch(/주간_보고서-\d+\.md$/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a missing output file as a failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hwpforge-'))
    try {
      const child = fakeChild(answering(() => ({ content: [{ type: 'text', text: 'ok' }] })))
      const result = await createHwpFromMarkdown('x', dir, 'doc', {
        binPath: '/bin/x',
        spawnImpl: spawnWith(child),
      })
      expect(result).toEqual({ ok: false, error: 'hwpforge did not produce an output file' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects empty markdown without spawning', async () => {
    const spawnImpl = vi.fn<SpawnLike>()
    const result = await createHwpFromMarkdown('   ', tmpdir(), 'doc', { binPath: '/bin/x', spawnImpl })
    expect(result).toEqual({ ok: false, error: 'hwpforge: markdown is empty' })
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npm test -w @genoffice/hwp -- hwpforge-client`
Expected: FAIL — `mcpCall`이 export되지 않음 / 시그니처 불일치.

- [x] **Step 3: 클라이언트 구현 (전체 교체)**

`apps/hwp/src/main/hwpforge-client.ts`:
```ts
import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Minimal MCP stdio client for the HwpForge document generator.
 *
 * HwpForge compiles Markdown (GFM tables included) into valid HWPX documents
 * with real tables/cells — the "write text + tables into one document"
 * capability the rhwp engine automation does not expose. We spawn its prebuilt
 * platform binary directly (no npm launcher script, no ELECTRON_RUN_AS_NODE),
 * speak JSON-RPC lines over stdio and call hwpforge_convert. The binary path
 * comes from the caller (see native-binary-path.ts) so packaged builds can ship it
 * as an extraResource next to the sheets sidecar.
 */

interface McpJsonRpc {
  id?: number
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean }
  error?: { message: string }
}

/** spawn(3)-shaped hook so tests can substitute a scripted child process */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams

export interface McpCallOptions {
  /** absolute path of the HwpForge MCP platform binary */
  binPath: string
  spawnImpl?: SpawnLike
  timeoutMs?: number
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export async function mcpCall(
  toolName: string,
  args: Record<string, unknown>,
  options: McpCallOptions,
): Promise<string> {
  const { binPath, timeoutMs = 90_000 } = options
  const spawnImpl: SpawnLike = options.spawnImpl ?? (nodeSpawn as unknown as SpawnLike)
  const child = spawnImpl(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })

  let buffer = ''
  let nextId = 0
  const pending = new Map<
    number,
    { resolve: (m: McpJsonRpc) => void; reject: (e: Error) => void }
  >()
  const failAll = (err: Error) => {
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
  }
  // ENOENT/EACCES arrive here; surface the path so a broken install is diagnosable
  child.on('error', (err: NodeJS.ErrnoException) => {
    failAll(
      new Error(
        `hwpforge binary not found or not executable: ${binPath} (${err.code ?? err.message})`,
      ),
    )
  })
  child.on('close', (code) => {
    failAll(new Error(`hwpforge exited before responding (code ${code ?? 'signal'})`))
  })
  // a dead stdin must not turn into an unhandled 'error' event
  child.stdin.on('error', () => undefined)

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let msg: McpJsonRpc
      try {
        msg = JSON.parse(line) as McpJsonRpc
      } catch {
        /* not JSON — skip */ continue
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) entry.reject(new Error(msg.error.message ?? 'mcp error'))
        else entry.resolve(msg)
      }
    }
  })

  const send = (payload: Record<string, unknown>) => {
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    } catch {
      /* stdin already gone; the 'error'/'close' handlers reject the caller */
    }
  }
  const request = (method: string, params: unknown): Promise<McpJsonRpc> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })

  try {
    await withTimeout(
      request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'open-genoffice-hwp', version: '1' },
      }),
      timeoutMs,
      'hwpforge initialize',
    )
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const res = await withTimeout(
      request('tools/call', { name: toolName, arguments: args }),
      timeoutMs,
      `hwpforge ${toolName}`,
    )
    const text = (res.result?.content ?? []).map((c) => c.text).join('\n')
    if (res.result?.isError) throw new Error(`hwpforge ${toolName} failed: ${text.slice(0, 800)}`)
    return text
  } finally {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
}

export interface CreateHwpResult {
  ok: boolean
  path?: string
  error?: string
}

/** Compile Markdown (tables allowed) into a fresh .hwpx document. */
export async function createHwpFromMarkdown(
  markdown: string,
  destDir: string,
  baseName: string,
  options: McpCallOptions,
): Promise<CreateHwpResult> {
  try {
    if (!markdown.trim()) return { ok: false, error: 'hwpforge: markdown is empty' }
    await mkdir(destDir, { recursive: true })
    const safe = baseName
      .replace(/[^a-zA-Z0-9가-힣_ -]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60)
    const stamp = Date.now()
    const mdPath = join(destDir, `${safe || 'document'}-${stamp}.md`)
    const outPath = join(destDir, `${safe || 'document'}-${stamp}.hwpx`)
    await writeFile(mdPath, markdown, 'utf8')
    await mcpCall(
      'hwpforge_convert',
      { markdown: mdPath, is_file: true, output_path: outPath },
      options,
    )
    if (!existsSync(outPath)) {
      return { ok: false, error: 'hwpforge did not produce an output file' }
    }
    return { ok: true, path: outPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [x] **Step 4: 호출 지점 갱신 — `hwp-main.ts`**

(a) import (12행 근처) — 기존 `import { createHwpFromMarkdown } from './hwpforge-client'` 아래에 추가:
```ts
import { resolveNativeBinary } from './native-binary-path'
```

(b) `RuntimePaths`(198-206행) — `onCreateDocument` 아래에 필드 추가:
```ts
  /** HwpForge MCP platform binary; the shell injects it, dev falls back to node_modules */
  hwpforgePath?: string
```

(c) `createDocument` 핸들러(361-365행) — 기존
```ts
      const result = await createHwpFromMarkdown(
        markdown,
        join(app.getPath('userData'), 'ai-created'),
        baseName,
      )
```
을 다음으로 교체:
```ts
      const result = await createHwpFromMarkdown(
        markdown,
        join(app.getPath('userData'), 'ai-created'),
        baseName,
        {
          binPath: resolveNativeBinary('hwpforge-mcp', {
            runtimePath: runtime.hwpforgePath,
            envPath: process.env.HWPFORGE_MCP_PATH,
            isPackaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            // apps/shell or apps/hwp → repo root
            repoRoot: join(app.getAppPath(), '..', '..'),
            platform: process.platform,
            arch: process.arch,
          }),
        },
      )
```

- [x] **Step 5: 통과 확인**

Run: `npm test -w @genoffice/hwp`
Expected: PASS (static-server, native-binary-path, hwpforge-client 전부).

Run: `npm run typecheck -w @genoffice/hwp && npm run typecheck -w @genoffice/shell`
Expected: 오류 없음.

- [x] **Step 6: 커밋**

```bash
npm run format
git add apps/hwp/src/main/hwpforge-client.ts apps/hwp/src/main/hwp-main.ts apps/hwp/tests/hwpforge-client.test.ts
git commit -m "$(cat <<'EOF'
HWP: spawn the HwpForge binary directly instead of the npm launcher

The launcher path worked only because electron-builder copies the root
package.json dependencies into app.asar and Electron resolves the unpacked
.exe through it — an implicit contract, with an Electron-as-Node process in
between. Drive the platform binary over stdio directly, take its path from
the caller (explicit extraResource, like the sheets sidecar), and reject
with that path when it cannot be spawned.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 런타임 배선 — 서버, `getStudioUrl` IPC, 셸 주입

**Files:**
- Modify: `apps/hwp/src/main/hwp-main.ts:1-12` (imports), `:198-206` (`RuntimePaths`), `:383-384` 뒤 (IPC 핸들러), `:409-480` (서버 블록 교체), `:509-513` (standalone)
- Modify: `apps/hwp/src/shared/ipc.ts:7-18` (채널), `:120-135` (`HwpApi`)
- Modify: `apps/hwp/src/preload/index.ts:16-24`
- Modify: `apps/shell/src/main/index.ts:130-135`, `:158-169`

**Interfaces:**
- Consumes: `createStaticServer`, `StaticRoot` (Task 1).
- Produces:
  ```ts
  // shared/ipc.ts
  HWP_CHANNELS.getStudioUrl = 'hwp:get-studio-url'
  export type StudioUrlResult = { ok: true; url: string } | { ok: false; error: string }
  HwpApi.getStudioUrl(): Promise<StudioUrlResult>
  // hwp-main.ts RuntimePaths
  studioDir?: string
  ```
  Task 6의 `App.tsx`가 `getStudioUrl`을 호출한다.

- [x] **Step 1: `shared/ipc.ts`**

`HWP_CHANNELS`에 추가(`createDocument` 아래):
```ts
  getStudioUrl: 'hwp:get-studio-url',
```

`CreateDocumentResult` 인터페이스 아래에 타입 추가:
```ts
/** Where the renderer should point the rhwp studio iframe (served from the loopback origin). */
export type StudioUrlResult = { ok: true; url: string } | { ok: false; error: string }
```

`HwpApi`의 `createDocument` 아래에 메서드 추가:
```ts
  /** loopback URL of the bundled rhwp studio; fails when studio assets are not built/installed */
  getStudioUrl(): Promise<StudioUrlResult>
```

- [x] **Step 2: `preload/index.ts`**

`createDocument` 항목 아래에 추가:
```ts
  getStudioUrl: () => ipcRenderer.invoke(HWP_CHANNELS.getStudioUrl),
```

- [x] **Step 3: `hwp-main.ts` — imports**

1-5행의 Node import를 다음으로 교체(`createServer`, `AddressInfo`, `normalize`, `sep` 제거):
```ts
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
```
10-12행 근처의 로컬 import에 추가:
```ts
import type { SaveHwpRequest, SaveHwpResult, StudioUrlResult } from '../shared/ipc'
import { createStaticServer } from './static-server'
import type { StaticRoot } from './static-server'
```
(기존 `import type { SaveHwpRequest, SaveHwpResult } from '../shared/ipc'` 줄은 위 줄로 대체.)

- [x] **Step 4: `hwp-main.ts` — `RuntimePaths`**

`hwpforgePath` 필드 아래에 추가:
```ts
  /** built rhwp studio (index.html + wasm + fonts); served under STUDIO_PREFIX on the loopback origin */
  studioDir?: string
  /** rhwp native CLI (Phase 2 AI tools); injected by the shell, unused in Phase 1 */
  rhwpPath?: string
```

- [x] **Step 5: `hwp-main.ts` — 서버 블록 교체**

`/** The embedded rhwp studio iframe rejects postMessage …` 주석(409행)부터 `rendererLoadUrl()` 함수 끝(480행)까지를 다음으로 통째로 교체:
```ts
/** URL prefix under which the bundled rhwp studio is served on the loopback origin */
const STUDIO_PREFIX = '/rhwp/'

let loopbackOriginPromise: Promise<string> | null = null

function studioIndexExists(): boolean {
  return Boolean(runtime.studioDir && existsSync(join(runtime.studioDir, 'index.html')))
}

/**
 * One loopback HTTP origin serves the renderer (production builds; dev uses the
 * Vite origin) and the bundled rhwp studio (always). The studio SDK rejects
 * postMessage from opaque origins (file:/data:), and serving the studio locally
 * is what makes Hangul editing work offline. The studio root is registered only
 * when its assets exist so the renderer still comes up to show the error.
 */
function ensureLoopbackOrigin(): Promise<string> {
  if (loopbackOriginPromise) return loopbackOriginPromise
  loopbackOriginPromise = (async () => {
    const roots: StaticRoot[] = []
    if (runtime.rendererFile) {
      roots.push({ prefix: '/', dir: dirname(resolve(runtime.rendererFile)), spaFallback: true })
    }
    if (runtime.studioDir && studioIndexExists()) {
      roots.push({ prefix: STUDIO_PREFIX, dir: runtime.studioDir, spaFallback: false })
    }
    if (roots.length === 0) throw new Error('hwp: no renderer output configured')
    const server = await createStaticServer({ roots })
    return server.origin
  })()
  loopbackOriginPromise.catch(() => {
    loopbackOriginPromise = null
  })
  return loopbackOriginPromise
}

/** resolve the URL to load for the hwp renderer: dev server, or the loopback origin */
function rendererLoadUrl(): Promise<string> {
  if (runtime.rendererUrl) return Promise.resolve(runtime.rendererUrl)
  return ensureLoopbackOrigin().then((origin) => `${origin}/index.html`)
}

/** loopback URL of the bundled studio, or a message telling the user/dev what is missing */
async function studioUrl(): Promise<StudioUrlResult> {
  if (!studioIndexExists()) {
    return {
      ok: false,
      error: app.isPackaged
        ? 'Bundled HWP editor assets are missing — reinstall Open GenOffice.'
        : 'HWP studio is not built — run: npm run build -w @genoffice/hwp',
    }
  }
  try {
    const origin = await ensureLoopbackOrigin()
    return { ok: true, url: `${origin}${STUDIO_PREFIX}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [x] **Step 6: `hwp-main.ts` — IPC 핸들러**

`registerHwpIpc()` 안, `ipcMain.handle(HWP_CHANNELS.getLanguage, …)` 줄 바로 아래에 추가:
```ts
  ipcMain.handle(HWP_CHANNELS.getStudioUrl, () => studioUrl())
```

- [x] **Step 7: `hwp-main.ts` — standalone 구성**

`startHwpStandalone()`의 `configureHwpRuntime({...})`에 필드 추가:
```ts
    studioDir: join(__dirname, '../../dist/studio'),
```
(`__dirname`은 dev에서 `apps/hwp/out/main` → `apps/hwp/dist/studio`.)

또 `createHwpView`와 `startHwpStandalone`의 `.catch` 주석 `// last resort: file:// still renders the shell of the page (no studio bridge)`는 그대로 둔다 — 여전히 참이다.

- [x] **Step 8: 셸 주입 — `apps/shell/src/main/index.ts`**

`SIDECAR_BIN` 상수(133-135행) 아래에 추가:
```ts
const HWP_STUDIO_DIR = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'hwp-studio')
  : join(APPS_ROOT, 'hwp', 'dist', 'studio')
const HWPFORGE_EXE = process.platform === 'win32' ? 'hwpforge-mcp.exe' : 'hwpforge-mcp'
const HWPFORGE_BIN = app.isPackaged
  ? join(process.resourcesPath, 'native', HWPFORGE_EXE)
  : join(
      APPS_ROOT,
      '..',
      'node_modules',
      '@hwpforge',
      `mcp-${process.platform}-${process.arch}`,
      'bin',
      HWPFORGE_EXE,
    )
const RHWP_EXE = process.platform === 'win32' ? 'rhwp.exe' : 'rhwp'
const RHWP_BIN = app.isPackaged
  ? join(process.resourcesPath, 'native', RHWP_EXE)
  : join(APPS_ROOT, 'hwp', 'native', 'rhwp', `${process.platform}-${process.arch}`, RHWP_EXE)
```

`configureHwpRuntime({...})`(158-169행)에 세 필드 추가(`rendererFile` 아래):
```ts
  studioDir: HWP_STUDIO_DIR,
  hwpforgePath: HWPFORGE_BIN,
  rhwpPath: RHWP_BIN,
```

- [x] **Step 9: 검증**

Run: `npm run typecheck -w @genoffice/hwp && npm run typecheck -w @genoffice/shell && npm test -w @genoffice/hwp && npm run lint`
Expected: 모두 통과. (`dist/studio`가 아직 없으므로 런타임에서 `getStudioUrl`은 `ok:false`로 dev 안내 문구를 돌려준다 — 의도된 상태.)

- [x] **Step 10: 커밋**

```bash
npm run format
git add apps/hwp/src/main/hwp-main.ts apps/hwp/src/shared/ipc.ts apps/hwp/src/preload/index.ts apps/shell/src/main/index.ts
git commit -m "$(cat <<'EOF'
HWP: serve the bundled studio from the loopback origin and expose its URL

The loopback server now mounts dist/studio under /rhwp/ next to the
renderer, starts in dev too, and the renderer can ask main for the studio
URL. The shell injects studioDir and the native binary paths (HwpForge,
rhwp CLI) the same way it injects the sheets sidecar.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 스튜디오 빌드 스크립트, 의존성 고정, 무시 규칙

**Files:**
- Create: `tools/build-hwp-studio.mjs`
- Create: `tools/hwp-studio/vite.config.genoffice.ts`
- Modify: `apps/hwp/package.json`, `package.json`(루트), `.gitignore`, `eslint.config.mjs:10-20`, `.prettierignore`

**Interfaces:**
- Produces: `apps/hwp/dist/studio/{index.html, rhwp_bg.wasm, assets/, fonts/, THIRD-PARTY.md, .rhwp-version}`; npm 스크립트 `build:hwp-studio`(루트), `build:studio`(hwp); hwp `build`가 스튜디오 빌드를 선행.

- [x] **Step 1: 래퍼 Vite 설정**

`tools/hwp-studio/vite.config.genoffice.ts` (Task 0 스파이크와 동일 내용):
```ts
// Copied next to upstream's vite.config.ts by tools/build-hwp-studio.mjs.
// Reuses the upstream Vite config but drops vite-plugin-pwa: the studio is
// served from a loopback origin whose port changes on every launch, so a
// service worker would only accumulate registrations and WASM caches in
// userData.
// The explicit .ts extension keeps Vite's native config loader quiet.
import base from './vite.config.ts'

type PluginLike = { name?: unknown } | null | undefined | false

const flatten = (items: unknown[]): PluginLike[] =>
  items.flatMap((item) => (Array.isArray(item) ? flatten(item) : [item as PluginLike]))

const isPwa = (plugin: PluginLike): boolean =>
  Boolean(
    plugin &&
      typeof plugin === 'object' &&
      typeof plugin.name === 'string' &&
      plugin.name.startsWith('vite-plugin-pwa'),
  )

const config = base as { plugins?: unknown[] }

export default {
  ...config,
  plugins: flatten(config.plugins ?? []).filter((plugin) => !isPwa(plugin)),
}
```

- [x] **Step 2: 빌드 스크립트**

`tools/build-hwp-studio.mjs`:
```js
#!/usr/bin/env node
/**
 * Build the rhwp studio — the Hangul editor UI that apps/hwp embeds in an
 * iframe — from the upstream tag matching the installed @rhwp/core, so the app
 * serves it from its loopback origin instead of edwardkim.github.io and Hangul
 * editing works offline.
 *
 *   node tools/build-hwp-studio.mjs [--force]
 *
 * Output: apps/hwp/dist/studio/ (gitignored). Skipped when the .rhwp-version
 * stamp already matches; --force rebuilds. Needs git and network on the first
 * run (sparse clone of edwardkim/rhwp + npm ci inside rhwp-studio). No Rust:
 * the WASM comes from the @rhwp/core npm package.
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HWP_DIR = join(ROOT, 'apps', 'hwp')
/** sparse clone of edwardkim/rhwp at the pinned tag */
const WORK_DIR = join(HWP_DIR, '.build', 'rhwp')
const STUDIO_DIR = join(WORK_DIR, 'rhwp-studio')
const PKG_DIR = join(WORK_DIR, 'pkg')
const STAGING_DIR = join(WORK_DIR, 'dist-staging')
const DIST_DIR = join(HWP_DIR, 'dist', 'studio')
const REPO_URL = 'https://github.com/edwardkim/rhwp'
const SPARSE_PATHS = ['rhwp-studio', 'npm/hwpctrl-ocx', 'npm/editor', 'assets/fonts', 'assets/logo']
const WRAPPER_CONFIG = join(ROOT, 'tools', 'hwp-studio', 'vite.config.genoffice.ts')
/** bump whenever this script changes what it produces */
const SCRIPT_VERSION = 1
const FORCE = process.argv.includes('--force')
const IS_WIN = process.platform === 'win32'

const require = createRequire(import.meta.url)
const coreDir = dirname(require.resolve('@rhwp/core/package.json'))
const rhwpVersion = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8')).version
const tag = `v${rhwpVersion}`
const stamp = JSON.stringify({
  rhwpVersion,
  disableExternalWebFonts: true,
  hwpctrl: true,
  scriptVersion: SCRIPT_VERSION,
})

const stampFile = join(DIST_DIR, '.rhwp-version')
if (!FORCE && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
  console.log(`hwp studio: up to date (rhwp ${rhwpVersion}), skipping — pass --force to rebuild`)
  process.exit(0)
}

const read = (path) => readFileSync(path, 'utf8').trim()
const quoteForShell = (arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)

function run(cmd, args, opts = {}) {
  const shown = [cmd, ...args].join(' ')
  console.log(`> ${shown}${opts.cwd ? `   (in ${relative(ROOT, opts.cwd) || '.'})` : ''}`)
  // npm/npx are .cmd shims on Windows and must go through a shell there
  const res = spawnSync(cmd, IS_WIN ? args.map(quoteForShell) : args, {
    stdio: 'inherit',
    shell: IS_WIN,
    ...opts,
  })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`command failed (${res.status ?? res.signal}): ${shown}`)
}

/** remove a path whether it is a file, a directory, or a (possibly dangling) symlink */
function removeAny(path) {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return
  }
  if (stat.isSymbolicLink() || stat.isFile()) unlinkSync(path)
  else rmSync(path, { recursive: true, force: true })
}

function ensureClone() {
  const tagFile = join(WORK_DIR, '.tag')
  if (existsSync(join(WORK_DIR, '.git')) && existsSync(tagFile) && read(tagFile) === tag) {
    console.log(`hwp studio: reusing clone of rhwp ${tag}`)
    return
  }
  rmSync(WORK_DIR, { recursive: true, force: true })
  run('git', [
    'clone',
    '--filter=blob:none',
    '--sparse',
    '--depth',
    '1',
    '--branch',
    tag,
    REPO_URL,
    WORK_DIR,
  ])
  // git < 2.37 leaves cone mode off after `clone --sparse`; without it `set`
  // treats the paths as patterns and drops the top-level files (LICENSE, …)
  run('git', ['-C', WORK_DIR, 'config', 'core.sparseCheckoutCone', 'true'])
  run('git', ['-C', WORK_DIR, 'sparse-checkout', 'set', ...SPARSE_PATHS])
  writeFileSync(tagFile, tag)
}

/**
 * The WASM package that upstream's deploy workflow produces with wasm-pack.
 * The studio bundles it through the `@wasm` alias → pkg/ and references the
 * hashed assets/rhwp_bg-*.wasm at runtime; the copies upstream also drops into
 * public/ (and the stale ones committed there) are never fetched, so they are
 * removed instead of shipped (~10 MB).
 */
function placeWasm() {
  mkdirSync(PKG_DIR, { recursive: true })
  for (const file of ['rhwp.js', 'rhwp_bg.wasm', 'rhwp.d.ts', 'rhwp_bg.wasm.d.ts']) {
    cpSync(join(coreDir, file), join(PKG_DIR, file))
  }
  const publicDir = join(STUDIO_DIR, 'public')
  for (const stale of ['rhwp.js', 'rhwp_bg.wasm', 'rhwp.d.ts', 'rhwp_bg.wasm.d.ts']) {
    removeAny(join(publicDir, stale))
  }
}

/**
 * public/fonts is a symlink upstream; Windows checkouts turn it into a text
 * file. public/samples (demo documents, ~7 MB) is not referenced by the built
 * studio and is dropped from the embedded bundle.
 */
function placeFontsAndIcon() {
  const publicDir = join(STUDIO_DIR, 'public')
  const fonts = join(publicDir, 'fonts')
  removeAny(fonts)
  cpSync(join(WORK_DIR, 'assets', 'fonts'), fonts, { recursive: true })
  cpSync(join(WORK_DIR, 'assets', 'logo', 'favicon.ico'), join(publicDir, 'favicon.ico'))
  removeAny(join(publicDir, 'samples'))
}

function buildStudio() {
  // upstream ships a package-lock.json (v0.8.6); fall back to install if a later tag drops it
  run('npm', [existsSync(join(STUDIO_DIR, 'package-lock.json')) ? 'ci' : 'install'], {
    cwd: STUDIO_DIR,
  })
  cpSync(WRAPPER_CONFIG, join(STUDIO_DIR, 'vite.config.genoffice.ts'))
  rmSync(STAGING_DIR, { recursive: true, force: true })
  run(
    'npx',
    [
      'vite',
      'build',
      '--base=/rhwp/',
      '--config',
      'vite.config.genoffice.ts',
      '--outDir',
      '../dist-staging',
      '--emptyOutDir',
    ],
    {
      cwd: STUDIO_DIR,
      // the Hamchorom CDN fonts are non-commercial and need network; layout uses
      // built-in font metrics either way, only on-screen glyphs change
      env: { ...process.env, RHWP_DISABLE_EXTERNAL_WEBFONTS: '1' },
    },
  )
}

function thirdPartyNotices() {
  const parts = [
    '# Third-party notices — bundled rhwp studio (Hangul editor)',
    '',
    '본 제품의 한글 문서 처리 기능은 한글과컴퓨터의 HWP 문서 파일 공개 문서를 참고하여 개발된 rhwp를 포함합니다.',
    '',
    `## rhwp ${tag} — MIT`,
    '',
    read(join(WORK_DIR, 'LICENSE')),
    '',
  ]
  const upstreamThirdParty = join(WORK_DIR, 'THIRD_PARTY_LICENSES.md')
  if (existsSync(upstreamThirdParty)) {
    parts.push('## rhwp third-party licenses', '', read(upstreamThirdParty), '')
  }
  parts.push('## Bundled fonts', '', read(join(WORK_DIR, 'assets', 'fonts', 'FONTS.md')), '')
  const studioPkg = JSON.parse(read(join(STUDIO_DIR, 'package.json')))
  for (const name of Object.keys(studioPkg.dependencies ?? {})) {
    const dir = join(STUDIO_DIR, 'node_modules', ...name.split('/'))
    const meta = JSON.parse(read(join(dir, 'package.json')))
    const licenseFile = readdirSync(dir).find((f) => /^(LICENSE|LICENCE|COPYING)/i.test(f))
    parts.push(
      `## ${name} v${meta.version} — ${meta.license ?? 'see package'}`,
      '',
      licenseFile ? read(join(dir, licenseFile)) : '(no license file published in the package)',
      '',
    )
  }
  return parts.join('\n')
}

function verifyStaging() {
  if (!existsSync(join(STAGING_DIR, 'index.html'))) throw new Error('studio build is missing index.html')
  const assets = existsSync(join(STAGING_DIR, 'assets')) ? readdirSync(join(STAGING_DIR, 'assets')) : []
  if (!assets.some((f) => /^rhwp_bg-.*\.wasm$/.test(f))) {
    throw new Error('studio build is missing the bundled assets/rhwp_bg-*.wasm')
  }
  if (!assets.some((f) => /^studio-plugin-.*\.js$/.test(f))) {
    throw new Error('studio build is missing the hwpctrl studio-plugin chunk (RHWP_WITHOUT_HWPCTRL set?)')
  }
  for (const file of ['sw.js', 'registerSW.js', 'manifest.webmanifest']) {
    if (existsSync(join(STAGING_DIR, file))) {
      throw new Error(`studio build must not contain the PWA artifact ${file}`)
    }
  }
  for (const file of ['rhwp_bg.wasm', 'rhwp.js', 'samples']) {
    if (existsSync(join(STAGING_DIR, file))) {
      throw new Error(`studio build should not contain the unreferenced ${file} (pruning failed)`)
    }
  }
}

try {
  ensureClone()
  placeWasm()
  placeFontsAndIcon()
  buildStudio()
  verifyStaging()
  writeFileSync(join(STAGING_DIR, 'THIRD-PARTY.md'), thirdPartyNotices())
  writeFileSync(join(STAGING_DIR, '.rhwp-version'), stamp)
  rmSync(DIST_DIR, { recursive: true, force: true })
  renameSync(STAGING_DIR, DIST_DIR)
  console.log(`hwp studio: built rhwp ${tag} → ${relative(ROOT, DIST_DIR)}`)
} catch (err) {
  console.error(`hwp studio: build failed — ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
```

- [x] **Step 2b: `rhwp` CLI 획득 스크립트**

`tools/fetch-rhwp-cli.mjs`:
```js
#!/usr/bin/env node
/**
 * Fetch the rhwp native CLI matching the installed @rhwp/core from the upstream
 * GitHub release, verify it against the release's SHA256SUMS.txt, and unpack it
 * to apps/hwp/native/rhwp/<platform>-<arch>/rhwp[.exe] (gitignored).
 *
 *   node tools/fetch-rhwp-cli.mjs [--force]
 *
 * Only the current OS/arch is fetched — that is what electron-builder packages
 * on this machine. Skipped when the .rhwp-version stamp matches.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const FORCE = process.argv.includes('--force')
const REPO = 'edwardkim/rhwp'

/** release asset per Node platform-arch; archives contain a top-level rhwp/ directory */
const ASSETS = {
  'win32-x64': { file: (v) => `rhwp-v${v}-windows-x86_64.zip`, exe: 'rhwp.exe' },
  'darwin-arm64': { file: (v) => `rhwp-v${v}-macos-aarch64.tar.gz`, exe: 'rhwp' },
  'darwin-x64': { file: (v) => `rhwp-v${v}-macos-x86_64.tar.gz`, exe: 'rhwp' },
  'linux-x64': { file: (v) => `rhwp-v${v}-linux-x86_64.tar.gz`, exe: 'rhwp' },
  'linux-arm64': { file: (v) => `rhwp-v${v}-linux-aarch64.tar.gz`, exe: 'rhwp' },
}

const target = `${process.platform}-${process.arch}`
const asset = ASSETS[target]
if (!asset) {
  console.error(`rhwp cli: no release asset for ${target}`)
  process.exit(1)
}

const version = JSON.parse(readFileSync(require.resolve('@rhwp/core/package.json'), 'utf8')).version
const outDir = join(ROOT, 'apps', 'hwp', 'native', 'rhwp', target)
const exePath = join(outDir, asset.exe)
const stampFile = join(outDir, '.rhwp-version')
const stamp = JSON.stringify({ version, target })
if (!FORCE && existsSync(exePath) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
  console.log(`rhwp cli: up to date (v${version}, ${target}), skipping — pass --force to refetch`)
  process.exit(0)
}

const base = `https://github.com/${REPO}/releases/download/v${version}/`
const fileName = asset.file(version)

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

try {
  console.log(`rhwp cli: fetching ${fileName} (v${version})`)
  const [archive, sums] = await Promise.all([download(base + fileName), download(`${base}SHA256SUMS.txt`)])
  const expected = sums
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === fileName || parts[1] === `*${fileName}`)?.[0]
  if (!expected) throw new Error(`${fileName} is not listed in SHA256SUMS.txt`)
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${fileName}: expected ${expected}, got ${actual}`)
  }

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  if (fileName.endsWith('.zip')) {
    // JSZip is already a hoisted dependency (docx-engine, sheets)
    const JSZip = require('jszip')
    const zip = await JSZip.loadAsync(archive)
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue
      const name = entry.name.split('/').pop()
      if (name === asset.exe || /^LICENSE/i.test(name)) {
        writeFileSync(join(outDir, name), await entry.async('nodebuffer'))
      }
    }
  } else {
    const archivePath = join(outDir, fileName)
    writeFileSync(archivePath, archive)
    const tar = spawnSync('tar', ['-xzf', archivePath, '-C', outDir, '--strip-components=1'], {
      stdio: 'inherit',
    })
    rmSync(archivePath, { force: true })
    if (tar.status !== 0) throw new Error(`tar failed (${tar.status ?? tar.signal})`)
  }
  if (!existsSync(exePath)) throw new Error(`archive did not contain ${asset.exe}`)
  if (process.platform !== 'win32') chmodSync(exePath, 0o755)
  writeFileSync(stampFile, stamp)
  const check = spawnSync(exePath, ['--version'], { encoding: 'utf8' })
  console.log(`rhwp cli: ${check.stdout.trim() || '(no --version output)'} → ${outDir}`)
} catch (err) {
  console.error(`rhwp cli: fetch failed — ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
```

- [x] **Step 3: 의존성·스크립트**

`apps/hwp/package.json` — `dependencies`를 다음으로 교체(정확 고정, `@hwpforge/mcp` 추가):
```json
  "dependencies": {
    "@genoffice/agent-core": "*",
    "@genoffice/ai-provider": "*",
    "@genoffice/ui": "*",
    "@hwpforge/mcp": "^0.16.4",
    "@rhwp/core": "0.8.6",
    "@rhwp/editor": "0.8.6"
  },
```
`scripts`의 `"build": "electron-vite build"`를 다음 세 줄로 교체:
```json
    "build:studio": "node ../../tools/build-hwp-studio.mjs",
    "build:cli": "node ../../tools/fetch-rhwp-cli.mjs",
    "build": "npm run build:studio && npm run build:cli && electron-vite build",
```

루트 `package.json` — `dependencies`에서 `"@hwpforge/mcp": "^0.16.4",` 줄 삭제(`ws`는 gsk용이므로 유지). `scripts`의 `"fixtures"` 줄 아래에 추가:
```json
    "build:hwp-studio": "node tools/build-hwp-studio.mjs",
    "fetch:rhwp-cli": "node tools/fetch-rhwp-cli.mjs",
```

- [x] **Step 4: 무시 규칙**

생성물은 eslint(`**/.build/**`, `**/dist/**`)·prettier(`.build/`, `dist/`)·git(`dist/`)이 **이미 무시하는 관례 경로**에 둔다
— 클론은 `apps/hwp/.build/rhwp/`, 스튜디오는 `apps/hwp/dist/studio/`. 그래서 `eslint.config.mjs`·`.prettierignore`는
건드리지 않는다(이 리포의 config-protection 훅이 `eslint.config.mjs` 수정을 차단하기도 한다). `.gitignore`에는
`.build/`가 없고 `native/`는 새 경로이므로 두 줄만 추가한다 — `release/` 줄 아래:
```
# rhwp: sparse upstream clone and fetched CLI (tools/build-hwp-studio.mjs, tools/fetch-rhwp-cli.mjs);
# the built studio lands in apps/hwp/dist/studio, covered by dist/ above
/apps/hwp/.build/
/apps/hwp/native/
```

검증: 빌드 후 `git status --short`에 생성물이 나타나지 않고, `npm run lint`가 생성물을 건너뛴다(오류 0).
- [x] **Step 5: lock 갱신·확인**

Run:
```bash
npm install
git diff --stat package-lock.json
ls node_modules/@hwpforge/mcp-win32-x64/bin/hwpforge-mcp.exe node_modules/@rhwp/core/package.json
node -p "require('./node_modules/@rhwp/core/package.json').version"
```
Expected: lock 변경은 `apps/hwp` 워크스페이스 항목에 `@hwpforge/mcp`가 추가되고 루트 항목에서 빠지는 수준(수십 줄 이내). 바이너리 존재. 버전 `0.8.6`.

- [x] **Step 6: 빌드 실행·검증**

Run:
```bash
npm run build:hwp-studio
ls -a apps/hwp/dist/studio
ls apps/hwp/dist/studio/assets | grep -E "rhwp_bg-.*\.wasm|studio-plugin-.*\.js"
cat apps/hwp/dist/studio/.rhwp-version
grep -c "/rhwp/" apps/hwp/dist/studio/index.html
ls apps/hwp/dist/studio/sw.js apps/hwp/dist/studio/registerSW.js apps/hwp/dist/studio/manifest.webmanifest apps/hwp/dist/studio/rhwp_bg.wasm apps/hwp/dist/studio/samples 2>&1 | grep -c "No such file"
grep -c "^## " apps/hwp/dist/studio/THIRD-PARTY.md
du -sh apps/hwp/dist/studio | cut -f1
grep -rl "edwardkim.github.io" apps/hwp/dist/studio || echo "no occurrences"
```
Expected: `index.html`, `assets/`, `fonts/`, `icons/`, `images/`, `print.html`, `theme-init.js`, `favicon.ico`, `THIRD-PARTY.md`, `.rhwp-version` 존재. `assets/`에 `rhwp_bg-<hash>.wasm`과 `studio-plugin-<hash>.js`(hwpctrl) 존재. 스탬프 JSON에 `"rhwpVersion":"0.8.6"`. `index.html`에 `/rhwp/` 경로 ≥1. PWA 3개 + 정리 대상 2개 부재(`5`). THIRD-PARTY 섹션 ≥ 6(rhwp, 폰트, canvaskit-wasm, @noble/hashes, pixelmatch, pngjs). 크기 약 42MB(폰트 22 + assets 19; 스파이크에서 정리 전 59MB 실측). `edwardkim.github.io` 발생은 정보로만 기록(스튜디오 내부 링크 텍스트일 수 있음; 호스트 CSP가 iframe 로드를 막으므로 기능 영향 없음).

두 번째 실행:
```bash
npm run build:hwp-studio
```
Expected: `up to date (rhwp 0.8.6), skipping`, 즉시 종료.

전체 hwp 빌드 체인:
```bash
npm run build -w @genoffice/hwp
ls apps/hwp/out/main/index.js apps/hwp/out/preload/index.js apps/hwp/out/renderer/index.html
```
Expected: 스튜디오 skip 메시지 후 electron-vite build 성공, 세 산출물 존재.

- [x] **Step 6b: CLI 획득 실행·검증**

Run:
```bash
npm run fetch:rhwp-cli
ls -a apps/hwp/native/rhwp/win32-x64/
./apps/hwp/native/rhwp/win32-x64/rhwp.exe --version
npm run fetch:rhwp-cli
```
Expected: 첫 실행이 `fetching rhwp-v0.8.6-windows-x86_64.zip`, SHA 검증 통과, 폴더에 `rhwp.exe`, `LICENSE`, `.rhwp-version`. `--version`은 `rhwp v0.8.6`. 두 번째 실행은 `up to date … skipping`. (SHA 불일치·미등재는 비-0 종료와 원인 출력 — 자산 이름을 바꿔 한 번 확인한다.)

- [x] **Step 7: 커밋**

```bash
npm run format && npm run lint
git add tools/build-hwp-studio.mjs tools/fetch-rhwp-cli.mjs tools/hwp-studio/vite.config.genoffice.ts apps/hwp/package.json package.json package-lock.json .gitignore eslint.config.mjs .prettierignore
git commit -m "$(cat <<'EOF'
HWP: build the rhwp studio and fetch the rhwp CLI at build time

tools/build-hwp-studio.mjs sparse-clones edwardkim/rhwp at the tag matching
the installed @rhwp/core, drops in that package's WASM, replaces the fonts
symlink with a real copy, strips the PWA plugin, and builds with CDN web
fonts disabled into apps/hwp/dist/studio (gitignored, stamped, atomically
swapped). tools/fetch-rhwp-cli.mjs downloads the same release's CLI binary
for this platform and verifies it against SHA256SUMS.txt. @rhwp/* are pinned
exactly so SDK, studio, WASM and CLI share one version; @hwpforge/mcp moves
to apps/hwp where its binary is used.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 렌더러 — 로컬 스튜디오 연결, CSP

**Files:**
- Modify: `apps/hwp/src/renderer/App.tsx:55-73`
- Modify: `apps/hwp/src/renderer/index.html:5-9`

**Interfaces:**
- Consumes: `HwpApi.getStudioUrl()` (Task 4).

- [x] **Step 1: `App.tsx`**

55-58행 주석을 다음으로 교체:
```ts
  // One-shot boot: consume the queued intent (file path or blank), embed the
  // rhwp editor iframe from the bundled studio (served by main on the loopback
  // origin), and either load the file or start on the studio's blank document.
  // The container div stays mounted for the whole tab lifetime; the iframe is
  // owned by the rhwp editor and must not be re-parented.
```

69-73행
```ts
      const editor = await withTimeout(
        createEditor(container),
        STUDIO_TIMEOUT_MS,
        'Cannot reach the embedded HWP editor studio — check the network connection and reopen the file.',
      )
```
을 다음으로 교체:
```ts
      const studio = await api.getStudioUrl()
      if (!studio.ok) throw new Error(studio.error)
      const editor = await withTimeout(
        createEditor(container, { studioUrl: studio.url }),
        STUDIO_TIMEOUT_MS,
        'The bundled HWP editor could not be loaded — the installation may be damaged. Reinstall Open GenOffice and reopen the file.',
      )
```

- [x] **Step 2: `index.html` CSP**

5-9행을 다음으로 교체:
```html
    <!-- frame-src: the bundled rhwp studio iframe — same loopback origin in production ('self'),
         the loopback port while the renderer runs on the Vite dev server (127.0.0.1:*).
         The studio document applies its own CSP inside; WASM runs there, not here. -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' http://127.0.0.1:*; connect-src 'self' ws://localhost:*"
    />
```

- [x] **Step 3: 정적 검증**

Run:
```bash
npm run typecheck -w @genoffice/hwp && npm run lint
npm run build -w @genoffice/hwp
grep -rho "https://edwardkim.github.io[^\"' ]*" apps/hwp/out/renderer | sort | uniq -c
grep -rl "edwardkim.github.io" apps/hwp/out/main apps/hwp/out/preload || echo "main/preload: none"
```
Expected: 렌더러 번들에 `https://edwardkim.github.io/rhwp/` **정확히 1건**(SDK의 미사용 기본값 `DEFAULT_STUDIO_URL`), main/preload에는 0건.

- [x] **Step 4: 오프라인 동작 검증 (스펙 §8 수용 2)**

셸 dev로 기동:
```bash
npm run dev
```
셸 창이 뜨면 **Wi-Fi/이더넷을 끊는다.** Home → 새 문서 카드 **`.hwp`**.
Expected: HWP 탭에 스튜디오 UI(툴바·빈 페이지)가 뜬다 — 이전 코드라면 오프라인에서 45초 후 오류였을 지점. 텍스트를 입력하고 상단 메뉴 저장(또는 탭 닫기 → 저장) → `.hwpx`로 저장 → Home 최근 파일에서 다시 열어 내용 확인.
동일 세션에서 스튜디오가 `http://127.0.0.1:<port>/rhwp/`에서 로드되었는지 확인하려면 셸 창에서 `Ctrl+Shift+I`로 DevTools를 열고 `document.querySelector('iframe')?.src`를 평가한다(DevTools 단축키가 막혀 있으면 이 확인은 건너뛴다 — 오프라인 로드 성공 자체가 결정적 증거다).
네트워크를 복구한다.

- [x] **Step 5: 커밋**

```bash
npm run format
git add apps/hwp/src/renderer/App.tsx apps/hwp/src/renderer/index.html
git commit -m "$(cat <<'EOF'
HWP: load the studio iframe from the bundled build, not edwardkim.github.io

The renderer asks main for the loopback studio URL and passes it to
createEditor; the CSP frame-src no longer allows the remote origin. Hangul
editing now works offline and no third-party script is fetched next to
document bytes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 패키징 — extraResources, 존재 검사, 고지 병합

**Files:**
- Modify: `apps/shell/electron-builder.cjs:46-60` (검사 루프), `:71-112` (extraResources), `:124-129` (mac), `:139-146` (win)
- Modify: `tools/gen-third-party-notices.mjs:52-62` (정규식), 폰트 섹션 뒤(`const dest = …` 앞)

**Interfaces:**
- Consumes: `apps/hwp/dist/studio/` (Task 5), `apps/hwp/dist/studio/THIRD-PARTY.md`.
- Produces: 설치본 `resources/modules/hwp-studio/`, `resources/native/hwpforge-mcp[.exe]`.

- [x] **Step 1: `electron-builder.cjs` — 존재 검사**

46-60행의 검사 루프를 다음으로 교체:
```js
// Resources below are copied verbatim rather than bundled, so a missing source
// would ship a silently broken installer. Fail the build with a clear message
// instead: the gsk CLI tree (its nested commander path depends on npm's current
// hoisting), the built rhwp studio (tools/build-hwp-studio.mjs), and the
// HwpForge platform binary for the OS we are packaging on (npm installs only the
// current platform's optional package).
// Note: electron-builder also copies the ROOT package.json `dependencies` into
// app.asar. HwpForge used to ride along that way (@hwpforge/mcp at the root);
// it now ships explicitly here, so that dependency must stay in apps/hwp — at
// the root it would be packaged twice.
// Only the two packaging targets check for a HwpForge binary. This module is
// also required outside packaging (tools/gen-third-party-notices.mjs reads
// extraResources), possibly on Linux, where no platform package is installed
// and nothing is packaged — do not fail there.
const HWPFORGE_PKG =
  process.platform === 'win32'
    ? 'mcp-win32-x64'
    : process.platform === 'darwin'
      ? 'mcp-darwin-arm64'
      : null
const HWPFORGE_EXE = process.platform === 'win32' ? 'hwpforge-mcp.exe' : 'hwpforge-mcp'
const HWPFORGE_SRC = HWPFORGE_PKG
  ? `../../node_modules/@hwpforge/${HWPFORGE_PKG}/bin/${HWPFORGE_EXE}`
  : null
// rhwp CLI fetched by tools/fetch-rhwp-cli.mjs for this platform (same version as @rhwp/core)
const RHWP_EXE = process.platform === 'win32' ? 'rhwp.exe' : 'rhwp'
const RHWP_SRC = HWPFORGE_PKG ? `../hwp/native/rhwp/${process.platform}-${process.arch}/${RHWP_EXE}` : null
for (const rel of [
  '../../node_modules/@genspark/cli',
  '../../node_modules/@genspark/cli/node_modules/commander',
  '../../node_modules/ws',
  '../hwp/dist/studio/index.html',
  ...(HWPFORGE_SRC ? [HWPFORGE_SRC] : []),
  ...(RHWP_SRC ? [RHWP_SRC] : []),
]) {
  if (!existsSync(join(__dirname, rel))) {
    throw new Error(
      `electron-builder extraResources source missing: ${rel} ` +
        `(npm hoisting changed? run npm run build:hwp-studio?)`,
    )
  }
}
```

- [x] **Step 2: `electron-builder.cjs` — extraResources**

`extraResources` 배열의 `{ from: '../hwp/out', to: 'modules/hwp' }` 항목 아래에 추가:
```js
    {
      from: '../hwp/dist/studio',
      to: 'modules/hwp-studio',
    },
```

`mac.extraResources`의 사이드카 항목 아래에 추가:
```js
      {
        from: '../../node_modules/@hwpforge/mcp-darwin-arm64/bin/hwpforge-mcp',
        to: 'native/hwpforge-mcp',
      },
      {
        from: '../hwp/native/rhwp/darwin-arm64/rhwp',
        to: 'native/rhwp',
      },
```

`win.extraResources`의 사이드카 항목 아래에 추가:
```js
      {
        from: '../../node_modules/@hwpforge/mcp-win32-x64/bin/hwpforge-mcp.exe',
        to: 'native/hwpforge-mcp.exe',
      },
      {
        from: '../hwp/native/rhwp/win32-x64/rhwp.exe',
        to: 'native/rhwp.exe',
      },
```

- [x] **Step 3: `gen-third-party-notices.mjs`**

(a) `extraResourceSeeds()`의 정규식(57행)
```js
    const m = e?.from && /node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(e.from)
```
을 패키지 하위 경로(`…/bin/hwpforge-mcp.exe`)도 잡도록 교체:
```js
    const m = e?.from && /node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/|$)/.exec(e.from)
```

(b) 폰트 섹션이 끝나는 줄(`readFileSync(join(ROOT, 'apps/docs/src/renderer/fonts/LICENSE-OFL.txt'), 'utf8').trim() + '\n'`) 바로 아래, `const dest = …` 앞에 추가:
```js
// The bundled rhwp studio is built from an upstream clone whose npm tree is not
// ours; tools/build-hwp-studio.mjs assembles its notices into dist/studio.
const studioNotices = join(ROOT, 'apps/hwp/dist/studio/THIRD-PARTY.md')
if (existsSync(studioNotices)) {
  out += hr('4. Bundled rhwp studio (Hangul editor) and its dependencies')
  out += readFileSync(studioNotices, 'utf8').trim() + '\n'
} else {
  console.warn('apps/hwp/dist/studio/THIRD-PARTY.md not found — run npm run build:hwp-studio first')
}
```

- [x] **Step 4: 검증**

Run:
```bash
node -e "const c=require('./apps/shell/electron-builder.cjs'); console.log(c.extraResources.filter(e=>/hwp/.test(e.to)).map(e=>e.to), c.win.extraResources.map(e=>e.to))"
mv apps/hwp/dist/studio apps/hwp/dist/studio.bak && (node -e "require('./apps/shell/electron-builder.cjs')" 2>&1 | grep -c "dist/studio/index.html"); mv apps/hwp/dist/studio.bak apps/hwp/dist/studio
npm run notices
grep -n "^=\+$\|^4\. Bundled rhwp studio\|hwpforge\|^## rhwp v" apps/shell/build/THIRD-PARTY-NOTICES.txt | head
```
Expected: 첫 명령은 `[ 'modules/hwp', 'modules/hwp-studio' ] [ 'native/xlsx-sidecar.exe', 'native/hwpforge-mcp.exe', 'native/rhwp.exe' ]`. 두 번째는 `1`(dist/studio 부재 시 throw 메시지 출력). `npm run notices`는 완료하며 산출물에 `4. Bundled rhwp studio…` 구획, `@hwpforge/mcp-win32-x64` 항목, `## rhwp v0.8.6 — MIT`가 보인다. 경고는 정확히 하나 — `not installed, skipped: @hwpforge/mcp-darwin-arm64`(Windows에는 darwin 플랫폼 패키지가 설치되지 않으므로 정상; 기존 optional 의존성과 같은 처리).

Run: `npm run lint`
Expected: 통과.

- [x] **Step 5: 커밋**

```bash
npm run format
git add apps/shell/electron-builder.cjs tools/gen-third-party-notices.mjs
git commit -m "$(cat <<'EOF'
HWP: package the studio bundle and the native binaries as extraResources

dist/studio ships under resources/modules/hwp-studio; the platform HwpForge
binary and the rhwp CLI ship under resources/native next to the sheets
sidecar; the builder config fails fast when any source is missing. Third-party
notices pick up the studio's own notice file and packages referenced by a
path inside node_modules.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: CI 단계, 문서, 스펙 정정

**Files:**
- Modify: `.github/workflows/ci.yml:51-52` 뒤
- Modify: `README.md:69` (HWP 행), `:113-122` (Development 블록)
- Modify: `MODIFICATIONS.md:14-15`
- Modify: `docs/upstream-provenance.md` (절 추가)
- Modify: `docs/superpowers/specs/2026-09-21-hwp-local-self-hosting-design.md` §8 CI 단락

- [x] **Step 1: `ci.yml`**

`Install dependencies` 단계 바로 아래에 추가:
```yaml
      - name: Build HWP studio (bundled rhwp editor)
        # Exercises tools/build-hwp-studio.mjs on every run: sparse-clones the
        # pinned rhwp tag and builds the studio the hwp module serves locally.
        # No Rust needed — the WASM comes from @rhwp/core.
        run: npm run build:hwp-studio

      - name: Fetch rhwp CLI (bundled Hangul engine binary)
        # Exercises tools/fetch-rhwp-cli.mjs: downloads this platform's release
        # binary at the same pinned version and verifies it against SHA256SUMS.
        run: npm run fetch:rhwp-cli
```

- [x] **Step 2: `README.md`**

HWP 행(69행)의 `(Rust + WASM, embedded as an iframe studio)`를 다음으로 교체:
```
(Rust + WASM; the rhwp studio UI is built from the pinned rhwp release at build time and bundled with the app, so Hangul editing works offline)
```

Development 블록의 `npm run fixtures     # generate test .docx fixtures` 줄 아래에 추가:
```bash
npm run build:hwp-studio  # build the bundled Hangul editor (rhwp studio); needs git + network once, before npm run dev
npm run fetch:rhwp-cli    # download + verify the matching rhwp CLI binary for this platform
```

- [x] **Step 3: `MODIFICATIONS.md`**

```
- a Hangul document (`.hwp`/`.hwpx`) editor module built on the MIT-licensed
  rhwp engine, embedded as a fifth shell tab;
```
을 다음으로 교체:
```
- a Hangul document (`.hwp`/`.hwpx`) editor module built on the MIT-licensed
  rhwp engine, embedded as a fifth shell tab; the rhwp studio UI is built from
  the pinned upstream release and bundled with the app (served from a loopback
  origin, no remote dependency), and the HwpForge document generator binary is
  packaged as an application resource;
```

- [x] **Step 4: `docs/upstream-provenance.md`**

파일 끝에 추가:
```markdown

## Bundled rhwp studio (Hangul editor)

The Hangul module embeds the rhwp studio UI from
[`edwardkim/rhwp`](https://github.com/edwardkim/rhwp) (MIT). It is not
vendored: `tools/build-hwp-studio.mjs` sparse-clones the upstream tag whose
version equals the installed `@rhwp/core` (pinned exactly in
`apps/hwp/package.json`), drops in that package's WASM, removes the PWA
plugin, disables CDN web fonts (`RHWP_DISABLE_EXTERNAL_WEBFONTS=1`; the
Hamchorom CDN is licensed for non-commercial use only), and builds into
`apps/hwp/dist/studio/` (gitignored). electron-builder copies that directory
to `resources/modules/hwp-studio`, and the hwp main process serves it under
`/rhwp/` on its loopback origin. The studio's own third-party notices are
assembled into `dist/studio/THIRD-PARTY.md` and merged into the installer's
notices.

To move to a new rhwp release: set `@rhwp/core` and `@rhwp/editor` to the
same exact version in `apps/hwp/package.json`, run `npm install`, then
`npm run build:hwp-studio -- --force`, and open a `.hwp` and a `.hwpx` with
the network disconnected. The SDK, the studio and the WASM must share one
version; mixed versions fall back to the SDK's legacy handshake and are not
supported here.

## Packaged native helpers

electron-builder copies the root `package.json` `dependencies` into
`app.asar` automatically. Native helper binaries are deliberately not shipped
that way: the sheets xlsx sidecar, the HwpForge MCP binary (`@hwpforge/mcp`,
declared in `apps/hwp`) and the rhwp CLI (fetched from the pinned upstream
release by `tools/fetch-rhwp-cli.mjs` and verified against its
`SHA256SUMS.txt`) are listed as platform `extraResources` in
`apps/shell/electron-builder.cjs`, which fails the build when a binary is
missing, and the main process spawns them directly from `resources/native/`.
```

- [x] **Step 5: 검증·커밋**

Run: `npm run format && npm run format:check && npm run lint`
Expected: 통과.

```bash
git add .github/workflows/ci.yml README.md MODIFICATIONS.md docs/upstream-provenance.md
git commit -m "$(cat <<'EOF'
HWP: document the bundled studio and build it in CI

CI never ran a build step, so the studio script needs its own step to be
exercised on every push. README, MODIFICATIONS and the provenance record
describe the pinned-release bundle and how to move to a new rhwp version.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 패키징 수용 테스트 (스펙 §8 수용 3~5)

**Files:**
- Modify: 이 계획 문서의 §"수용 로그"에 결과 기록. 결함이 나오면 해당 Task로 돌아가 수정 후 재실행.

- [ ] **Step 1: Windows 설치본 생성**

Run:
```bash
npm run dist:win
ls apps/shell/release/OpenGenOfficeSetup-v*-x64.exe
```
Expected: 설치 파일 생성. (`notices`가 스튜디오 구획을 포함하고, builder 검사 루프가 통과함.)

- [ ] **Step 2: 설치본 내용 확인**

PowerShell:
```powershell
$installer = Get-ChildItem 'apps/shell/release/OpenGenOfficeSetup-v*-x64.exe' | Select-Object -First 1
$installDir = 'C:\Temp\OpenGenOffice-accept'
Start-Process -FilePath $installer.FullName -ArgumentList '/S', "/D=$installDir" -Wait
Test-Path (Join-Path $installDir 'resources\modules\hwp-studio\index.html')
Test-Path (Join-Path $installDir 'resources\modules\hwp-studio\rhwp_bg.wasm')
Test-Path (Join-Path $installDir 'resources\native\hwpforge-mcp.exe')
Select-String -Path (Join-Path $installDir 'resources\THIRD-PARTY-NOTICES.txt') -Pattern 'Bundled rhwp studio' -Quiet
-not (Test-Path (Join-Path $installDir 'resources\app.asar.unpacked\node_modules\@hwpforge'))
Test-Path (Join-Path $installDir 'resources\native\rhwp.exe')
& (Join-Path $installDir 'resources\native\rhwp.exe') --version
```
Expected: `Test-Path` 여섯 줄 모두 `True`(다섯째 줄은 HwpForge가 더는 asar 경로로 **중복** 배포되지 않음을 뜻한다), 마지막 명령은 `rhwp v0.8.6`.

- [ ] **Step 3: 오프라인 기능 검증**

**네트워크를 끊은 뒤** `Open GenOffice.exe` 실행.
1. Home → 새 문서 **`.hwp`** → 스튜디오가 뜬다. 텍스트 입력 → 저장(`.hwpx`) → 탭 닫기 → Home 최근 파일에서 재열기 → 내용 유지.
2. Task 0에서 고른 샘플 `.hwp`(rhwp `samples/`)를 Home → 열기로 연다 → 렌더된다.
3. HwpForge 회귀: 앱을 닫고 오프라인 상태에서 `node scripts/drivers/driver.hwp-k12.mjs "C:\Temp\OpenGenOffice-accept\Open GenOffice.exe"` → `notice.ok: true`, `newTab.ok: true`. 이제 바이너리는 `resources/native/hwpforge-mcp.exe`에서 직접 spawn된다(Task 0 Step 2의 기준선과 같은 결과, 다른 경로). AI 프로바이더가 설정된 환경이면 AI 패널의 **가정통신문** 버튼으로도 확인한다(`가정통신문_현장체험학습-<timestamp>.hwpx`, 표 포함).
4. 앱 종료 후 네트워크 복구.

Expected: 1~3 모두 성공. 실패 시 어느 단계인지와 오류 문구를 기록하고 해당 Task로 돌아간다.

- [ ] **Step 4: 원격 origin 잔존 확인 (스펙 §8 수용 4)**

Run:
```bash
grep -rho "https://edwardkim.github.io[^\"' ]*" apps/hwp/out/renderer | sort | uniq -c
grep -rl "edwardkim.github.io" apps/shell/out || echo "shell: none"
grep -o "frame-src[^;]*" apps/hwp/out/renderer/index.html
```
Expected: 렌더러 번들 1건(SDK 상수), 셸 0건, `frame-src 'self' http://127.0.0.1:*`.

- [ ] **Step 5: 정리·기록**

```powershell
Start-Process -FilePath (Join-Path $installDir 'Uninstall Open GenOffice.exe') -ArgumentList '/S' -Wait
```
아래 §"수용 로그"를 채우고 커밋:
```bash
git add docs/superpowers/plans/2026-09-21-hwp-local-self-hosting.md
git commit -m "$(cat <<'EOF'
HWP: record packaged acceptance results for the self-hosted studio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: macOS 미검증 항목 명시**

이 머신에서는 검증할 수 없는 항목 — PR 설명의 테스트 계획에 체크되지 않은 항목으로 남긴다:
- `mac.extraResources`의 `native/hwpforge-mcp`가 서명·노터라이즈를 통과하는지(사이드카와 같은 경로이므로 통과 예상).
- macOS에서 `.hwpx` 열기·저장·K-12 생성 오프라인 동작.

---

## 수용 로그

Task 0 Step 2와 Task 9에서 채운다.

| 항목 | 결과 | 비고 |
|---|---|---|
| 수정 전 패키지 앱: `createDocument` IPC | **성공** (2026-09-21) | 가설(실패) 반증. asar에 루트 deps 수집됨. K-12 버튼은 AI 모델 0개라 숨김 |
| 스파이크: `@rhwp/core` WASM으로 스튜디오 렌더 | **GO** (2026-09-21) | 23페이지 렌더, 외부 요청 0, CDN 폰트→동봉 폰트. `public/rhwp.js` vs core: DIFFERENT(커밋본 stale, 빌드 무관). 발견: git 2.35 cone 모드, MSYS 경로 변환, 미참조 17MB |
| 설치본 리소스 4종 존재 | | |
| 오프라인: 새 문서 → 저장 → 재열기 | | |
| 오프라인: 샘플 `.hwp` 열기 | | |
| 오프라인: 가정통신문 생성 → 새 탭 | | |
| 원격 origin 잔존 | | 렌더러 1건 / 셸 0건 |
| macOS | 미검증 | 별도 머신 |
