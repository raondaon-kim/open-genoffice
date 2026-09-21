# HWP 모듈 로컬 자립화 설계

- 날짜: 2026-09-21
- 상태: 설계 승인, 구현 전
- 범위: `apps/hwp`, `apps/shell` 패키징, `tools/` 빌드 스크립트
- 후속: `docs/superpowers/plans/`에 구현 계획 작성 (writing-plans)

## 1. 배경과 문제

`apps/hwp`는 한글(`.hwp`/`.hwpx`) 편집기 모듈이지만 자체 렌더링·파싱 코드가 없다.
편집기 본체는 `@rhwp/editor` SDK가 만드는 iframe이고, 그 iframe은 **rhwp 제작자의
개인 GitHub Pages(`https://edwardkim.github.io/rhwp/`)에서 로드된다**
(`apps/hwp/src/renderer/index.html:8` CSP `frame-src`, SDK 내부 기본값
`DEFAULT_STUDIO_URL`). 결과:

1. 인터넷이 없으면 한글 문서를 열 수도 편집할 수도 없다.
2. 가용성이 서드파티 정적 호스팅에 종속된다.
3. 문서 바이트를 다루는 컨텍스트에서 원격 서드파티 JS가 실행된다 (보안 경계 구멍).

두 번째 결함은 AI 문서 생성 경로에 있다. `create_document`와 K-12 서식 8종은
HwpForge MCP 바이너리를 호출하는데, `apps/hwp/src/main/hwpforge-client.ts:24`가
런타임에 `require.resolve('@hwpforge/mcp/package.json')`을 한다. 셸은 hwp main을
소스째 번들하고(`apps/shell/electron.vite.config.ts:6-9`), 패키징은
`files: ['out/**']`에 `dependencies: {}`라 **설치본에는 node_modules가 없다**.
따라서 설치된 앱에서 `create_document`는 항상 실패한다. 같은 성격의 `@genspark/cli`는
`apps/shell/electron-builder.cjs:100-111`에서 수동 복사하는데, 뒤에 추가된 HwpForge만
그 단계가 누락되었다. (패키징 빌드로 실측 재현은 구현 계획의 첫 검증 항목.)

## 2. 조사 요약 (설계의 근거)

모두 2026-09-21 직접 확인.

| 사실 | 근거 |
|---|---|
| `@rhwp/editor`는 `studioUrl` 옵션으로 스튜디오 URL 교체를 공식 지원 | 타르볼 `index.js:50` `options.studioUrl \|\| DEFAULT_STUDIO_URL`, README:135 |
| 현재 호스트는 옵션을 넘기지 않음 | `apps/hwp/src/renderer/App.tsx:70` `createEditor(container)` |
| `studioUrl`은 `http:`/`https:`만 허용, `file:`/`data:` 거부 | `transport.js:71`, README:16-17 |
| 그 조건을 만족하는 루프백 HTTP 정적 서버가 이미 존재 | `apps/hwp/src/main/hwp-main.ts:431-474` |
| 스튜디오 소스는 rhwp 리포 `rhwp-studio/`에 공개, 태그 `v0.8.6`이 npm 버전과 일치 | `git ls-remote --tags` |
| 컴파일된 WASM(9.9MB)을 `@rhwp/core@0.8.6`이 배포 — Rust 툴체인 불필요 | `npm pack --dry-run`: `rhwp.js`, `rhwp_bg.wasm`, `.d.ts` |
| 업스트림 배포 레시피: `pkg/` → `public/` 복사 후 `vite build --base=/rhwp/` | `.github/workflows/deploy-pages.yml` |
| 셀프호스팅 시 CDN 웹폰트를 꺼야 함 — **함초롬체 CDN은 비상업 조건** | README:599-606, `RHWP_DISABLE_EXTERNAL_WEBFONTS=1` |
| 스튜디오 `main.ts`(v0.8.6)는 `virtual:pwa-register`를 import하지 않음 | 소스 grep — PWA 플러그인 제거 시 스텁 불필요 |
| `public/fonts`는 `../../assets/fonts` 심볼릭 링크 | GitHub contents API `type: symlink` |
| `@hwpforge/mcp` 런처는 플랫폼 패키지를 `require.resolve` 후 `execFileSync`하는 껍데기 | 타르볼 `bin/hwpforge-mcp.js` |
| HwpForge는 네트워크를 쓰지 않음 — 바이너리만 있으면 오프라인 동작 | `hwpforge-client.ts` stdio JSON-RPC만 사용 |
| 대안 엔진 없음: rhwp(MIT, 3,825★, 당일 커밋)가 파싱·렌더·편집·저장을 갖춘 유일한 WASM HWP 에디터. hwp.js 20개월 정체·쓰기 불가, hwpers 쓰기 불가, hwp-rs 방치, pyhwp AGPL | GitHub API 실측 |

## 3. 목표와 비목표

### 목표

- G1. 인터넷 없이 `.hwp`/`.hwpx` 열기·편집·저장이 동작한다.
- G2. 인터넷 없이 AI 문서 생성(`create_document`)과 K-12 서식 8종이 **설치본에서** 동작한다.
- G3. 앱이 `edwardkim.github.io`로 어떤 요청도 보내지 않는다.
- G4. 런타임 계약(`RhwpEditor` 12개 메서드 + hwpctrl 8개 호출)은 변경하지 않는다.

### 비목표

- iframe을 제거하고 `@rhwp/core`로 자체 편집 UI 구축 — 스튜디오는 e2e 50개+의 완성형 에디터, 재작성은 불필요.
- AI 도구 10개의 능력 확장 — §11 Phase 2.
- 폰트 서브셋팅, Intel Mac·Linux 지원.
- 루프백 서버를 커스텀 프로토콜로 대체 — SDK가 `http(s):`만 허용해 불가. §11에 기록.
- 루프백 서버 무인증 문제(기존) 해결 — 공격면 종류는 바뀌지 않으며, 추가되는 스튜디오 자산은 공개 정적 파일.

## 4. 아키텍처

```
[현재]
 HWP 탭 renderer (prod: 127.0.0.1:P / dev: Vite localhost:5177)
   └─ <iframe src="https://edwardkim.github.io/rhwp/">      원격, 오프라인 불가
 AI create_document → require.resolve('@hwpforge/mcp')      설치본에서 실패

[변경 후]
 HWP 탭 renderer (prod: 127.0.0.1:P / dev: Vite localhost:5177)
   └─ <iframe src="http://127.0.0.1:P/rhwp/">               같은 루프백 서버, 로컬 dist
 루프백 정적 서버: /rhwp/* → studio-dist/ ,  그 외 → renderer out/
 AI create_document → spawn(resources/native/hwpforge-mcp[.exe])   사이드카와 동일 패턴
```

바뀌는 것은 iframe이 어디서 로드되는지, 바이너리가 어디 있는지 둘뿐이다.

## 5. 컴포넌트 변경

### 5.1 `tools/build-hwp-studio.mjs` (신규) — 스튜디오 획득·빌드

Node 스크립트. 네트워크는 첫 실행(또는 `--force`, 버전 변경)에만 필요하다.

1. **버전 단일 출처**: `require.resolve('@rhwp/core/package.json')`의 `version`을 읽어 태그
   `v<version>`을 결정한다. `apps/hwp/package.json`의 `@rhwp/core`·`@rhwp/editor`는
   `^`를 제거하고 정확히 고정한다(`0.8.6`). SDK·스튜디오·WASM 세 버전이 강제로 일치한다.
2. **sparse clone**: `git clone --filter=blob:none --sparse --depth 1 --branch v<version>
   https://github.com/edwardkim/rhwp apps/hwp/.rhwp` 후
   `git sparse-checkout set rhwp-studio npm/hwpctrl-ocx npm/editor assets/fonts assets/logo`.
   리포 전체는 2.9GB이지만 필요한 경로만 수십 MB다.
3. **WASM 배치**: `apps/hwp/.rhwp/pkg/`를 만들고 `@rhwp/core`의 `rhwp.js`, `rhwp_bg.wasm`,
   `rhwp.d.ts`, `rhwp_bg.wasm.d.ts`를 복사한다. 업스트림 워크플로가 `wasm-pack` 산출물을 두는 자리다.
4. **폰트·아이콘**: `rhwp-studio/public/fonts` (심볼릭 링크, Windows 체크아웃에서 텍스트 파일로
   깨짐)를 삭제하고 `assets/fonts/*`를 실제 디렉터리로 복사한다. `assets/logo/favicon.ico`를
   `public/favicon.ico`로 복사한다(업스트림 워크플로와 동일).
5. **의존성**: `rhwp-studio`에서 lock 파일이 있으면 `npm ci`, 없으면 `npm install`.
6. **래퍼 설정**: `tools/hwp-studio/vite.config.genoffice.ts`(리포에 추적)를
   `rhwp-studio/`로 복사한다. 이 설정은 업스트림 `./vite.config`를 import해 `plugins`를 평탄화한 뒤
   이름이 `vite-plugin-pwa`로 시작하는 항목만 제거하고 나머지를 그대로 반환한다.
7. **빌드**: 스테이징 디렉터리 `apps/hwp/.rhwp/dist-staging/`으로 빌드한다 —
   `RHWP_DISABLE_EXTERNAL_WEBFONTS=1 npx vite build --base=/rhwp/
   --config vite.config.genoffice.ts --outDir <abs>/apps/hwp/.rhwp/dist-staging --emptyOutDir`.
   `RHWP_WITHOUT_HWPCTRL`은 설정하지 않는다 — 우리 AI 도구가 `plugins.load('hwpctrl')`을
   호출하므로(`apps/hwp/src/renderer/ai/tools.ts:22`) hwpctrl 플러그인이 반드시 포함되어야 한다.
8. **고지 파일**: §5.7의 `THIRD-PARTY.md`를 스테이징 디렉터리에 생성한다.
9. **스탬프**: 스테이징 디렉터리의 `.rhwp-version`에 `{ rhwpVersion, disableExternalWebFonts: true,
   hwpctrl: true, scriptVersion }` JSON을 쓴다. `scriptVersion`은 스크립트 안의 상수로, 산출물에
   영향을 주는 변경 시 올린다.
10. **원자적 교체**: 기존 `apps/hwp/studio-dist/`를 제거하고 스테이징 디렉터리를 그 자리로 rename한다.
    실행 시작 시 기존 `studio-dist/.rhwp-version`이 계산한 스탬프와 일치하면 2~10단계를 건너뛴다(skip).
    `--force`로 강제 재빌드.
11. 어느 단계든 실패하면 원인을 출력하고 비-0으로 종료한다. 실패는 스테이징 디렉터리 안에서만
    일어나므로 기존 `studio-dist`는 손상되지 않는다.

**결정 — PWA 제거**: 루프백 포트가 기동마다 바뀌어 origin이 매번 새로 생긴다. PWA 서비스워커를
두면 등록과 캐시(precache + WASM 10MB CacheFirst)가 기동 횟수만큼 userData에 누적된다.
오프라인 Electron 앱에 SW는 쓸모가 없으므로 근원 제거한다.

**결정 — 빌드타임 생성 + gitignore** (dist 커밋 대신): sheets Rust 사이드카와 같은 선례.
35MB 블롭을 버전업마다 커밋하면 히스토리가 부푼다.

### 5.2 `apps/hwp/src/main/static-server.ts` (신규) — 서버 모듈 분리

`hwp-main.ts:431-474`의 클로저를 Electron 의존이 없는 순수 모듈로 추출한다.

```ts
export interface StaticRoot {
  prefix: string          // '/rhwp/' 또는 '/'
  dir: string             // 절대 경로
  spaFallback: boolean    // 미존재 경로를 dir/index.html로 대체할지
}
export function createStaticServer(opts: { roots: StaticRoot[] }):
  Promise<{ origin: string; close(): Promise<void> }>
```

- 라우팅: 요청 경로에 대해 **가장 긴 prefix**가 일치하는 root를 선택한다.
- 기존 동작 유지: GET/HEAD만(그 외 405), `decodeURIComponent` + `normalize` + `..` 제거 + root 밖 경로 403,
  `cache-control: no-store`, MIME 표.
- MIME 추가: `.wasm` → `application/wasm` (WASM 스트리밍 컴파일에 필요), `.otf` → `font/otf`.
- `spaFallback`은 renderer root(`/`)에만 `true`. studio root(`/rhwp/`)는 미존재 시 **404** —
  SPA 폴백을 잘못 주면 WASM 로드 실패가 HTML 200으로 가려진다.
- `server.listen(0, '127.0.0.1')`, origin은 `http://127.0.0.1:<port>`.

`hwp-main.ts`는 이 모듈을 써서 `ensureLoopbackOrigin(): Promise<string>`(싱글턴, origin 반환)을
제공하고, 렌더러 URL은 `${origin}/index.html`, 스튜디오 URL은 `${origin}/rhwp/`로 조립한다.
서버는 **dev 모드에서도 항상 기동**한다 — 렌더러는 Vite에서 오되 스튜디오는 루프백에서 서빙.
studio root는 `studioDir/index.html`이 존재할 때만 roots에 넣는다. 없어도 서버는 renderer root만으로
기동한다 — §7의 오류 화면을 그리려면 렌더러가 떠야 하기 때문이다.

이 추출은 유닛 테스트를 가능하게 하는 조치이기도 하다. 현재 `hwp-main.ts`는 `electron` import
때문에 vitest에서 로드할 수 없다.

### 5.3 렌더러 연결

- `apps/hwp/src/shared/ipc.ts`: `HWP_CHANNELS.getStudioUrl = 'hwp:get-studio-url'`,
  `HwpApi.getStudioUrl(): Promise<string>`.
- `apps/hwp/src/preload/index.ts`: `getStudioUrl: () => ipcRenderer.invoke(HWP_CHANNELS.getStudioUrl)`.
- `hwp-main.ts` 핸들러: `ensureLoopbackOrigin().then(o => \`${o}/rhwp/\`)`. `studioDir`가 없거나
  `studioDir/index.html`이 없으면 reject — 메시지는 dev와 packaged를 구분한다(§7).
- `App.tsx:70`: `const studioUrl = await api.getStudioUrl()` 후
  `createEditor(container, { studioUrl })`. 기존 `withTimeout(…, STUDIO_TIMEOUT_MS)`는 유지한다
  (첫 WASM 컴파일 수 초 예상, 45초 충분).
- `App.tsx:72` 오류 문구: `"Cannot reach the embedded HWP editor studio — check the network
  connection and reopen the file."` → `"The bundled HWP editor could not be loaded — the
  installation may be damaged. Reinstall Open GenOffice and reopen the file."`
- `apps/hwp/src/renderer/index.html:8` CSP: `frame-src https://edwardkim.github.io` →
  `frame-src 'self' http://127.0.0.1:*`. 프로덕션은 renderer·studio가 동일 origin이라 `'self'`로
  충분하고, `http://127.0.0.1:*`는 dev(렌더러가 Vite `localhost:5177`)용이다.
  호스트 CSP에 `'wasm-unsafe-eval'`은 **추가하지 않는다** — WASM은 iframe 문서 안에서 실행되고
  그 문서는 자기 CSP를 따른다.

### 5.4 HwpForge — 직접 spawn + 경로 해석

`apps/hwp/src/main/hwpforge-client.ts`:

- `forgeWrapperPath()`(`require.resolve` 기반) 제거. `spawn(process.execPath, [wrapper],
  { ELECTRON_RUN_AS_NODE })` → **`spawn(binPath, [], { stdio: ['pipe','pipe','pipe'] })`**.
  런처 JS는 플랫폼 바이너리를 찾아 `execFileSync`하는 껍데기라, 직접 실행해도 stdio JSON-RPC
  프로토콜은 동일하다.
- 테스트 가능하도록 의존성 주입: `mcpCall(toolName, args, { binPath, spawnImpl?, timeoutMs? })`.
  `createHwpFromMarkdown`은 `resolveHwpforgePath()`로 얻은 경로를 넘긴다.
- `child.on('error')`(ENOENT 등)를 무시하지 않고 pending 요청을 reject한다:
  `hwpforge binary not found or not executable: <binPath>`.

`apps/hwp/src/main/hwpforge-path.ts` (신규, 순수 함수):

```ts
export function resolveHwpforgePath(input: {
  runtimePath?: string; envPath?: string; isPackaged: boolean;
  resourcesPath: string; repoRoot: string; platform: NodeJS.Platform; arch: string
}): string
```

우선순위 — `apps/sheets/src/main/sheets-main.ts:2631` `resolveSidecarPath`와 동일:

1. `runtimePath` (셸이 주입)
2. `envPath` (`HWPFORGE_MCP_PATH`)
3. packaged: `<resourcesPath>/native/hwpforge-mcp[.exe]`
4. dev: `<repoRoot>/node_modules/@hwpforge/mcp-<platform>-<arch>/bin/hwpforge-mcp[.exe]`

`repoRoot`는 호출자가 계산한다 — 셸에서는 `join(APPS_ROOT, '..')`, hwp 단독 dev에서는
`join(app.getAppPath(), '..', '..')`.

`RuntimePaths`에 `studioDir?: string`, `hwpforgePath?: string` 추가.
hwp 단독 dev(`hwp-main.ts:509` 자기 구성)는 `studioDir: join(__dirname, '../../studio-dist')`,
`hwpforgePath`는 미지정(폴백 체인).

### 5.5 electron-builder와 셸 경로 주입

`apps/shell/electron-builder.cjs`:

- `extraResources` += `{ from: '../hwp/studio-dist', to: 'modules/hwp-studio' }`
- `mac.extraResources` += `{ from: '../../node_modules/@hwpforge/mcp-darwin-arm64/bin/hwpforge-mcp',
  to: 'native/hwpforge-mcp' }`
- `win.extraResources` += `{ from: '../../node_modules/@hwpforge/mcp-win32-x64/bin/hwpforge-mcp.exe',
  to: 'native/hwpforge-mcp.exe' }`
- 상단 존재 검사 루프(`:50-60`)에 `../hwp/studio-dist/index.html`과 **현재 빌드 OS의** HwpForge
  바이너리 경로를 추가한다. `npm ci`는 현재 OS의 optional 플랫폼 패키지만 설치하므로 플랫폼 분기가 필수다.
- macOS 서명: 사이드카 바이너리가 이미 같은 `native/` 경로에서 서명·노터라이즈를 통과하고 있으므로
  동일 메커니즘을 탄다. Windows 머신에서는 검증 불가 — 구현 계획에 별도 검증 항목으로 명시.

`apps/shell/src/main/index.ts:130-169`:

```ts
const HWP_STUDIO_DIR = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'hwp-studio')
  : join(APPS_ROOT, 'hwp', 'studio-dist')
const HWPFORGE_EXE = process.platform === 'win32' ? 'hwpforge-mcp.exe' : 'hwpforge-mcp'
const HWPFORGE_BIN = app.isPackaged
  ? join(process.resourcesPath, 'native', HWPFORGE_EXE)
  : join(APPS_ROOT, '..', 'node_modules', '@hwpforge', `mcp-${process.platform}-${process.arch}`, 'bin', HWPFORGE_EXE)
configureHwpRuntime({ …기존, studioDir: HWP_STUDIO_DIR, hwpforgePath: HWPFORGE_BIN })
```

### 5.6 의존성·스크립트·gitignore

- `apps/hwp/package.json`: `@rhwp/core`·`@rhwp/editor` → `"0.8.6"` 고정.
  `@hwpforge/mcp`를 **루트 `package.json`에서 이곳으로 이동**(실제 import 주체가 hwp main;
  호이스팅으로 설치 위치는 동일). 스크립트 `"build:studio": "node ../../tools/build-hwp-studio.mjs"`,
  `"build": "npm run build:studio && electron-vite build"`.
- 루트 `package.json`: `@hwpforge/mcp` 제거(`ws`는 gsk용이라 유지),
  `"build:hwp-studio": "node tools/build-hwp-studio.mjs"` 추가. `build:all`·`dist:*`는 변경 없음
  (hwp `build`를 거치므로 자동 포함).
- `.gitignore`: `/apps/hwp/.rhwp/`, `/apps/hwp/studio-dist/`.

### 5.7 라이선스 고지

rhwp-studio의 npm 의존성은 우리 lock 파일 밖에 있어 `tools/gen-third-party-notices.mjs`가 보지 못한다.

- 빌드 스크립트가 `studio-dist/THIRD-PARTY.md`를 생성한다. 내용: (1) 머리에 한컴 HWP 공개 스펙 참고
  고지 — "본 제품의 한글 문서 처리 기능은 한글과컴퓨터의 HWP 문서 파일 공개 문서를 참고하여 개발된
  rhwp를 포함합니다." (2) rhwp `LICENSE`(MIT) 전문, (3) `assets/fonts/FONTS.md`(폰트별 라이선스),
  (4) `rhwp-studio/package.json` `dependencies` 각 항목의 이름·버전·`license` 필드와 `LICENSE*`
  파일 전문(canvaskit-wasm, @noble/hashes, pixelmatch, pngjs).
- `gen-third-party-notices.mjs`: `apps/hwp/studio-dist/THIRD-PARTY.md`가 존재하면 산출물 끝에
  이어붙인다.
- `tools/check-licenses.mjs`: 우리 npm 트리에는 새 패키지가 들어오지 않으므로 변경 없음.

### 5.8 문서 갱신

- `README.md` HWP 행: 편집기가 앱에 동봉되어 오프라인 동작함을 명시. "check the network" 류 표현 제거.
  Development 절에 `npm run build:hwp-studio` 한 줄 추가 — `npm run dev`는 hwp `build`를 거치지 않으므로
  스튜디오를 처음 한 번은 직접 빌드해야 한다(없으면 §7의 dev 오류 메시지가 이 명령을 안내한다).
- `MODIFICATIONS.md`: 파생 변경 기록에 항목 추가 (rhwp-studio 셀프호스팅, HwpForge 패키징).
- `docs/upstream-provenance.md`: rhwp 버전 고정과 갱신 절차(태그 = npm 버전) 한 단락.

## 6. 기동 시퀀스

```
shell 기동
  → configureHwpRuntime({ …, studioDir, hwpforgePath })
HWP 탭 생성 (createHwpView)
  → ensureLoopbackOrigin()  [싱글턴]  → http://127.0.0.1:P
  → 렌더러 로드: prod ${origin}/index.html / dev Vite URL
  → App.tsx: studioUrl = await hwpApi.getStudioUrl()  → "http://127.0.0.1:P/rhwp/"
  → createEditor(container, { studioUrl })  → iframe 로드 → WASM 컴파일 → ready
  → 기존 흐름 (consumePending → loadFile / file:new-doc …)
AI create_document
  → hwpApi.createDocument → hwp-main → createHwpFromMarkdown
  → resolveHwpforgePath() → spawn(bin) → initialize → tools/call hwpforge_convert
  → userData/ai-created/<name>.hwpx → runtime.onCreateDocument → 셸이 새 탭
```

## 7. 에러 처리

| 상황 | 동작 |
|---|---|
| `studioDir` 미지정 또는 `studioDir/index.html` 부재 | `getStudioUrl` reject. dev: `"HWP studio is not built — run: npm run build -w @genoffice/hwp"`. packaged: `"Bundled HWP editor assets are missing — reinstall Open GenOffice."` 렌더러는 이 메시지를 오류 화면에 그대로 표시 |
| 스튜디오 로드 45초 초과 | 기존 `withTimeout` 경로, §5.3의 새 문구 |
| HwpForge 바이너리 부재/실행 불가 | `child.on('error')` → `{ ok:false, error:'hwpforge binary not found or not executable: <path>' }`. 현재처럼 `Cannot find module`로 뭉개지지 않고 경로를 노출 |
| 스튜디오 빌드 스크립트 실패(네트워크, 태그 없음, vite 오류) | 비-0 종료 + 원인 출력. `electron-vite build`로 진행하지 않음. 부분 산출물 없음(임시 디렉터리 빌드 후 rename) |
| 이전 `studio-dist`가 다른 rhwp 버전 | `.rhwp-version` 불일치 → 자동 재빌드 |
| electron-builder 실행 시 `studio-dist` 또는 HwpForge 바이너리 부재 | 설정 로드 시점에 throw — 깨진 설치본을 만들지 않음 |

## 8. 테스트

`apps/hwp`는 현재 테스트 0건(`--passWithNoTests`). 이번에 처음 생긴다.

### 유닛 (vitest, `apps/hwp/tests/`)

- `static-server.test.ts`: 임시 디렉터리 두 개를 roots로 서버를 띄워
  `/rhwp/index.html`은 studio root에서, `/index.html`은 renderer root에서 서빙;
  `/rhwp/../index.html` 등 탈출 403; `/rhwp/x.wasm` → `application/wasm`; POST 405; HEAD는 본문 없음;
  renderer root 미존재 경로는 `index.html` 폴백, studio root 미존재 경로는 404.
- `hwpforge-path.test.ts`: 우선순위 4단계, win32 `.exe` 접미, platform/arch 조합.
- `hwpforge-client.test.ts`: `spawnImpl`에 가짜 child(EventEmitter + PassThrough)를 주입해
  initialize→`notifications/initialized`→`tools/call` 응답 조립, `isError` → throw, 타임아웃,
  `error` 이벤트(ENOENT) → reject 경로. 선례: `apps/sheets/tests/xlsx-sidecar.test.ts`.

### 수용 (실측, Windows 머신)

`dist:win`은 `build:all`을 거치며 sheets Rust 사이드카를 컴파일한다 — Rust 툴체인은 리포의 기존
요구사항(`rust-toolchain.toml`)이지만, 이 머신에 설치되어 있는지 구현 계획의 준비 단계에서 확인한다.

1. **HwpForge 결함 재현**: 수정 전 `main`으로 `npm run dist:win` → 설치 → AI 패널 K-12 서식 버튼
   → 실패 확인 (에러 메시지 기록).
2. 오프라인(네트워크 어댑터 비활성)에서 `npm run shell` → 샘플 `.hwpx` 열기 → 편집 → 저장 → 재열기.
3. 수정 후 `npm run dist:win` → 설치 → 오프라인 → `.hwpx` 열기 + K-12 서식 버튼 → 새 탭에 `.hwpx`.
4. `apps/hwp/studio-dist/`와 `apps/shell/out/`에서 `edwardkim.github.io` grep —
   SDK 상수 `DEFAULT_STUDIO_URL` 1건(미사용 기본값)만 남아야 한다.
5. macOS: 서명·노터라이즈 통과와 `native/hwpforge-mcp` 실행은 이 머신에서 불가 —
   CI 또는 별도 머신에서 검증. 구현 계획에 항목으로 남긴다.

### CI

스튜디오 빌드가 hwp `build`에 체인되므로 `.github/workflows/ci.yml`의 기존 단계가 스크립트를
자동 검증한다. 추가 잡 없음. (네트워크 필요 — `npm ci`·cargo와 같은 조건.)

## 9. 리스크와 1차 스파이크

구현 계획의 **첫 태스크는 던져도 되는 스파이크**다: §5.1의 1~7단계를 수동으로 한 번 돌려 스튜디오가
빌드되고, 정적 서버 하나로 띄운 뒤 `@rhwp/editor`의 `studioUrl`로 붙여 `.hwpx` 한 장이 렌더되는지
확인한다. 여기서 걸러지는 리스크:

- **`@rhwp/core` npm의 WASM이 스튜디오가 기대하는 `pkg/`와 다를 가능성.** 리포에 커밋된
  `public/rhwp.d.ts`(107KB)와 core의 `rhwp.d.ts`(175KB) 크기가 다르다 — 커밋본이 stale일 공산이
  크지만 확인이 필요하다. **폴백**: `wasm-pack build --target web --release`로 직접 빌드.
  리포가 이미 Rust를 요구하므로(`rust-toolchain.toml`) 추가 부담은 `wasm32-unknown-unknown` 타깃과
  wasm-pack 설치.
- PWA 플러그인 제거 후 빌드·런타임 무결성.
- 첫 WASM 컴파일이 45초 안에 드는지.
- 설치 용량 **+35~40MB**(WASM 9.9 + 폰트 ~23 + 번들)는 감수하는 비용으로 확정.

## 10. 결정 기록

1. 스튜디오 셀프호스팅 — 엔진 교체 없음.
2. 빌드타임 생성 + gitignore (dist 커밋 대신).
3. PWA 플러그인 제거.
4. 기존 루프백 서버 재사용, `/rhwp/` prefix, dev에서도 항상 기동.
5. HwpForge 런처 JS 제거, 플랫폼 바이너리 직접 spawn.
6. `@hwpforge/mcp` 의존성을 `apps/hwp`로 이동.
7. rhwp 버전 `^` 제거, 정확 고정; 태그 = npm 버전.
8. 폰트는 업스트림 전부 동봉(서브셋팅 안 함).
9. 호스트 CSP `frame-src 'self' http://127.0.0.1:*`; `wasm-unsafe-eval` 미추가.

## 11. 향후 과제 (이번 범위 밖)

### Phase 2 후보 — HWP AI 도구 표면 재설계

조사 중 확인한 사실: rhwp는 포크가 거의 쓰지 않는 에이전트 표면을 세 겹 갖고 있다.

| rhwp 표면 (v0.8.6) | 포크의 현재 사용 |
|---|---|
| **문서 에이전트 exact command** — `editor.applyTextCommand()`/`revertTextCommand()`, `getSelectionContext()`, `focusTarget()`, `onDocumentChanged()` (`@rhwp/editor@0.8.6` `index.d.ts:319-327`; capability `document-agent-command-v1`, `selection-context-v1`, `target-navigation-v1`, `document-change-events-v1`). 본문 문단 텍스트 치환(≤4,000 code point), epoch·changeSeq·문서/원문/서식/인접문맥 SHA-256 전제조건, 스냅샷 트랜잭션, `error.recovered`. v1 제한: control·field·혼합 글자서식 없는 문단 전체 | **미사용.** `hwp-skill.ts:16-21`과 README는 "엔진이 기존 본문을 편집할 수 없다"고 선언 — 엔진 한계가 아니라 포크 쪽 공백 |
| **hwpctrl** WebHwpCtrl v2.4 호환층 — `npm/hwpctrl-ocx/spec/api_ledger.json` 200KB, `actions.json` 57KB | 메서드 8개, 액션 ID 21개 |
| **`rhwp` 네이티브 CLI + 내장 MCP 서버** — `hwp_info`/`hwp_search`/`hwp_fill_fields`, `hwp_open`→`hwp_doc_*` 세션 도구, `rhwp capabilities` 자기서술. 릴리스마다 win x64·mac arm64 프리빌트 | 미사용. `read_pages`는 SVG `<text>` 긁기(표 구조·이미지 불가시) |

Phase 2는 이 표면들 위에 AI 도구 10개를 재설계하는 작업이다. 방법론은 CLI-Anything
(HKUDS/CLI-Anything) `HARNESS.md`를 **명세 템플릿으로만** 차용한다 — 실엔진 호출(재구현 금지),
명사-동사 도구 그룹, `{ ok, command, data, error{ type, message } }` 엔벨로프, "크게 실패하라",
실백엔드 E2E. CLI-Anything의 생성기 자체(Python/Click 고정, WASM 브리지 템플릿 없음)는 이 케이스에
쓰지 않는다.

Phase 1이 선행 조건인 이유: capability 협상과 hwpctrl 플러그인 구성은 우리가 통제하는 스튜디오
빌드에서 해야 하고, `rhwp` CLI 동봉은 HwpForge와 같은 `extraResources` 패턴을 탄다.

### 그 외

- 루프백 서버를 안정 origin(커스텀 프로토콜)으로 대체 — SDK `transport.js:71`이 `http(s):`만 허용해
  현재 불가. 업스트림에 `electron:`/커스텀 스킴 허용 제안 가능.
- 폰트 서브셋팅으로 설치 용량 절감.
- `apps/hwp` e2e 스펙 추가 (현재 `e2e/`에 hwp 커버리지 0).

## 12. 변경 파일 목록

신규:
- `tools/build-hwp-studio.mjs`
- `tools/hwp-studio/vite.config.genoffice.ts`
- `apps/hwp/src/main/static-server.ts`
- `apps/hwp/src/main/hwpforge-path.ts`
- `apps/hwp/tests/static-server.test.ts`
- `apps/hwp/tests/hwpforge-path.test.ts`
- `apps/hwp/tests/hwpforge-client.test.ts`

수정:
- `apps/hwp/src/main/hwp-main.ts` — 서버 모듈 사용, `RuntimePaths` 확장, `getStudioUrl` 핸들러
- `apps/hwp/src/main/hwpforge-client.ts` — 직접 spawn, 의존성 주입, error 이벤트 처리
- `apps/hwp/src/shared/ipc.ts`, `apps/hwp/src/preload/index.ts` — `getStudioUrl`
- `apps/hwp/src/renderer/App.tsx` — `studioUrl` 전달, 오류 문구
- `apps/hwp/src/renderer/index.html` — CSP
- `apps/hwp/package.json` — 버전 고정, `@hwpforge/mcp` 이동, 스크립트
- `apps/shell/src/main/index.ts` — `HWP_STUDIO_DIR`, `HWPFORGE_BIN` 주입
- `apps/shell/electron-builder.cjs` — extraResources 3건, 존재 검사
- `package.json`(루트) — `@hwpforge/mcp` 제거, `build:hwp-studio`
- `tools/gen-third-party-notices.mjs` — studio THIRD-PARTY.md 병합
- `.gitignore`
- `README.md`, `MODIFICATIONS.md`, `docs/upstream-provenance.md`
