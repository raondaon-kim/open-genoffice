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

두 번째 주제는 AI 문서 생성 경로의 **패키징 계약**이다. `create_document`와 K-12 서식 8종은
HwpForge MCP 바이너리를 호출하는데, `apps/hwp/src/main/hwpforge-client.ts:24`가 런타임에
`require.resolve('@hwpforge/mcp/package.json')`으로 npm 런처를 찾아 `process.execPath`를
`ELECTRON_RUN_AS_NODE=1`로 띄우고, 그 런처가 플랫폼 바이너리를 `execFileSync`한다. 설계 초기에는
이 경로가 설치본에서 실패한다고 판단했으나 **실측 결과 동작한다**(§2): electron-builder가 워크스페이스
루트 `package.json`의 `dependencies`(`@hwpforge/mcp`, `ws`)를 `app.asar/node_modules`에 수집하고
`.exe`를 `asar.unpacked`로 꺼내 서명하며, Electron의 asar 인식 `require`/`execFile`이 그 경로를
해석한다. 즉 결함은 없다. 다만 이 경로는 (a) "루트 `dependencies`가 곧 패키징 목록"이라는 암묵적
규약에 의존하고(빌더 설정 어디에도 적혀 있지 않음 — `@genspark/cli`는 루트 dep이 아니라서 수동
복사된 것), (b) optional 플랫폼 패키지 설치 실패를 빌드 시점에 잡지 못해 깨진 설치본을 조용히 만들 수
있으며, (c) Electron을 Node로 한 번 더 띄우는 중간 프로세스를 거친다. 이 스펙은 이를 sheets Rust
사이드카와 같은 **명시적 `extraResources` + 바이너리 직접 spawn** 계약으로 바꾼다 — 결함 수정이
아니라 구조 개선이다.

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
| git 2.35의 `clone --sparse`는 cone 모드를 켜지 않아 `sparse-checkout set`이 패턴 모드로 동작, 루트 파일(LICENSE 등)이 빠짐 → `git config core.sparseCheckoutCone true` 필요 | 스파이크 실측 |
| 스튜디오는 `pkg/`를 번들해 런타임에 해시된 `assets/rhwp_bg-*.wasm`만 참조. `public/`의 WASM·js·d.ts 복사본과 `public/samples`는 미참조(약 17MB) | 스파이크 dist grep + 렌더 검증 |
| **수정 전 패키지 앱에서 `createDocument` 성공** — electron-builder가 루트 `dependencies`(`@hwpforge/mcp`, `ws`)를 `app.asar/node_modules`에 수집, `.exe`는 `asar.unpacked`에 서명되어 존재 | `scripts/drivers/driver.hwp-k12.mjs`로 `release/win-unpacked` 구동, asar 헤더 파싱 |
| K-12 서식 버튼은 AI 모델이 0개면 렌더되지 않음(`AiPanel.tsx:575` `models.length > 0`) — HwpForge 자체는 LLM 불필요 | 실측; 이번 범위 밖 UX 메모 |
| `rhwp` CLI v0.8.6 릴리스 자산: `rhwp-v0.8.6-windows-x86_64.zip`(9.8MB, 안에 `rhwp/rhwp.exe`), `macos-aarch64.tar.gz`(8.6MB), `macos-x86_64`, `linux-x86_64`, `linux-aarch64`, `SHA256SUMS.txt`. npm 패키지 없음 | GitHub releases API |

## 3. 목표와 비목표

### 목표

- G1. 인터넷 없이 `.hwp`/`.hwpx` 열기·편집·저장이 동작한다.
- G2. AI 문서 생성(`create_document`)과 K-12 서식 8종이 설치본에서 계속 오프라인 동작하되, 바이너리 위치가
  빌더 설정에 **명시적으로** 적히고 누락 시 빌드가 실패한다.
- G3. 앱이 `edwardkim.github.io`로 어떤 요청도 보내지 않는다.
- G4. 런타임 계약(`RhwpEditor` 12개 메서드 + hwpctrl 8개 호출)은 변경하지 않는다.
- G5. `rhwp` 네이티브 CLI(같은 0.8.6)를 같은 패키징 계약으로 동봉해 Phase 2(AI 엔진 표면,
  `2026-09-21-hwp-ai-engine-surface-design.md`)의 토대를 만든다. 이 단계에서는 동봉·경로 해석까지만 하고 호출하지 않는다.

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
   https://github.com/edwardkim/rhwp apps/hwp/.rhwp`, `git config core.sparseCheckoutCone true`
   (git < 2.37은 cone 모드가 꺼져 있어 `set`이 패턴 모드로 동작하며 루트 파일을 잃는다), 그 뒤
   `git sparse-checkout set rhwp-studio npm/hwpctrl-ocx npm/editor assets/fonts assets/logo`.
   리포 전체는 2.9GB이지만 필요한 경로는 약 40MB다.
3. **WASM 배치**: `apps/hwp/.rhwp/pkg/`를 만들고 `@rhwp/core`의 `rhwp.js`, `rhwp_bg.wasm`,
   `rhwp.d.ts`, `rhwp_bg.wasm.d.ts`를 복사한다. 업스트림 워크플로가 `wasm-pack` 산출물을 두는 자리다.
   스튜디오는 `@wasm` 별칭으로 `pkg/`를 번들하고 런타임에 해시된 `assets/rhwp_bg-*.wasm`만 참조하므로,
   업스트림이 `public/`에도 넣는 복사본과 리포에 커밋된 stale 복사본(`public/rhwp.js`, `rhwp.d.ts`,
   `rhwp_bg.wasm.d.ts`)은 **삭제**한다(약 10MB).
4. **폰트·아이콘·정리**: `rhwp-studio/public/fonts` (심볼릭 링크, Windows 체크아웃에서 텍스트 파일로
   깨짐)를 삭제하고 `assets/fonts/*`를 실제 디렉터리로 복사한다. `assets/logo/favicon.ico`를
   `public/favicon.ico`로 복사한다(업스트림 워크플로와 동일). 참조되지 않는 `public/samples`(약 7MB)를 삭제한다.
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
- `hwp-main.ts` 핸들러: `StudioUrlResult = { ok: true; url } | { ok: false; error }`를 반환한다.
  `studioDir`가 없거나 `studioDir/index.html`이 없으면 `{ ok: false, error }` — 메시지는 dev와
  packaged를 구분한다(§7). reject 대신 결과 객체를 쓰는 이유: Electron이 `ipcMain.handle`의 reject를
  `Error invoking remote method …` 접두어로 감싸 사용자 문구를 오염시키기 때문. 렌더러는
  `if (!studio.ok) throw new Error(studio.error)`로 기존 오류 화면 경로에 합류한다.
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

### 5.4 HwpForge — 직접 spawn + 경로 해석 (구조 개선)

현재 경로(루트 dep → asar → 런처 JS → `execFileSync`)는 동작하지만 §1의 세 이유로 바꾼다. 바이너리는
§5.5의 `extraResources`로 `resources/native/`에 놓이고, `@hwpforge/mcp`는 루트에서 빠져 asar에
더 이상 수집되지 않는다(그대로 두면 바이너리가 `asar.unpacked`와 `native/`에 **두 번** 실린다).

`apps/hwp/src/main/hwpforge-client.ts`:

- `forgeWrapperPath()`(`require.resolve` 기반) 제거. `spawn(process.execPath, [wrapper],
  { ELECTRON_RUN_AS_NODE })` → **`spawn(binPath, [], { stdio: ['pipe','pipe','pipe'] })`**.
  런처 JS는 플랫폼 바이너리를 찾아 `execFileSync`하는 껍데기라, 직접 실행해도 stdio JSON-RPC
  프로토콜은 동일하다.
- 테스트 가능하도록 의존성 주입: `mcpCall(toolName, args, { binPath, spawnImpl?, timeoutMs? })`.
  `createHwpFromMarkdown`은 `resolveNativeBinary('hwpforge-mcp', …)`로 얻은 경로를 넘긴다.
- `child.on('error')`(ENOENT 등)를 무시하지 않고 pending 요청을 reject한다:
  `hwpforge binary not found or not executable: <binPath>`.

`apps/hwp/src/main/native-binary-path.ts` (신규, 순수 함수) — HwpForge와 `rhwp` CLI가 공유한다:

```ts
export type NativeBinaryName = 'hwpforge-mcp' | 'rhwp'
export interface NativeBinaryInput {
  runtimePath?: string; envPath?: string; isPackaged: boolean;
  resourcesPath: string; repoRoot: string; platform: NodeJS.Platform; arch: string
}
export function nativeExecutableName(name: NativeBinaryName, platform: NodeJS.Platform): string  // win32면 '.exe'
export function resolveNativeBinary(name: NativeBinaryName, input: NativeBinaryInput): string
```

우선순위 — `apps/sheets/src/main/sheets-main.ts:2631` `resolveSidecarPath`와 동일:

1. `runtimePath` (셸이 주입)
2. `envPath` (`HWPFORGE_MCP_PATH` / `RHWP_CLI_PATH` — 호출자가 읽어 넘긴다)
3. packaged: `<resourcesPath>/native/<exe>`
4. dev: `hwpforge-mcp` → `<repoRoot>/node_modules/@hwpforge/mcp-<platform>-<arch>/bin/<exe>`,
   `rhwp` → `<repoRoot>/apps/hwp/native/rhwp/<platform>-<arch>/<exe>` (§5.9가 만든다)

`repoRoot`는 호출자가 계산한다 — 셸에서는 `join(APPS_ROOT, '..')`, hwp 단독 dev에서는
`join(app.getAppPath(), '..', '..')`.

`RuntimePaths`에 `studioDir?: string`, `hwpforgePath?: string`, `rhwpPath?: string` 추가. `rhwpPath`는 이 단계에서
채워지기만 하고 호출되지 않는다(Phase 2가 사용).
hwp 단독 dev(`hwp-main.ts:509` 자기 구성)는 `studioDir: join(__dirname, '../../studio-dist')`,
`hwpforgePath`는 미지정(폴백 체인).

### 5.5 electron-builder와 셸 경로 주입

`apps/shell/electron-builder.cjs`:

- `extraResources` += `{ from: '../hwp/studio-dist', to: 'modules/hwp-studio' }`
- `mac.extraResources` += `{ from: '../../node_modules/@hwpforge/mcp-darwin-arm64/bin/hwpforge-mcp',
  to: 'native/hwpforge-mcp' }`, `{ from: '../hwp/native/rhwp/darwin-arm64/rhwp', to: 'native/rhwp' }`
- `win.extraResources` += `{ from: '../../node_modules/@hwpforge/mcp-win32-x64/bin/hwpforge-mcp.exe',
  to: 'native/hwpforge-mcp.exe' }`, `{ from: '../hwp/native/rhwp/win32-x64/rhwp.exe', to: 'native/rhwp.exe' }`
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
const RHWP_EXE = process.platform === 'win32' ? 'rhwp.exe' : 'rhwp'
const RHWP_BIN = app.isPackaged
  ? join(process.resourcesPath, 'native', RHWP_EXE)
  : join(APPS_ROOT, 'hwp', 'native', 'rhwp', `${process.platform}-${process.arch}`, RHWP_EXE)
configureHwpRuntime({ …기존, studioDir: HWP_STUDIO_DIR, hwpforgePath: HWPFORGE_BIN, rhwpPath: RHWP_BIN })
```

### 5.6 의존성·스크립트·gitignore

- `apps/hwp/package.json`: `@rhwp/core`·`@rhwp/editor` → `"0.8.6"` 고정.
  `@hwpforge/mcp`를 **루트 `package.json`에서 이곳으로 이동** — 루트 `dependencies`는 electron-builder가
  `app.asar`에 자동 수집하는 목록이므로, 바이너리를 `extraResources`로 명시 배포하는 이상 루트에 남기면
  중복 배포된다. 워크스페이스 dep은 호이스팅으로 `node_modules/@hwpforge/*`에 그대로 설치되어
  `extraResources`의 `from` 경로가 유효하다. 스크립트 `"build:studio": "node ../../tools/build-hwp-studio.mjs"`,
  `"build:cli": "node ../../tools/fetch-rhwp-cli.mjs"`,
  `"build": "npm run build:studio && npm run build:cli && electron-vite build"`.
- 루트 `package.json`: `@hwpforge/mcp` 제거(`ws`는 gsk용이라 유지),
  `"build:hwp-studio": "node tools/build-hwp-studio.mjs"`, `"fetch:rhwp-cli": "node tools/fetch-rhwp-cli.mjs"` 추가.
  `build:all`·`dist:*`는 변경 없음(hwp `build`를 거치므로 자동 포함).
- `.gitignore`: `/apps/hwp/.rhwp/`, `/apps/hwp/studio-dist/`, `/apps/hwp/native/`.
- `eslint.config.mjs` `ignores`와 `.prettierignore`에 위 세 경로 추가(클론된 rhwp 소스 수천 파일을 lint하지 않도록).

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

### 5.9 `tools/fetch-rhwp-cli.mjs` (신규) — `rhwp` CLI 획득

1. 버전은 §5.1과 같은 단일 출처(`@rhwp/core` `version`) → 릴리스 태그 `v<version>`.
2. 현재 OS/아키텍처의 자산만 받는다: `win32-x64` → `rhwp-v<ver>-windows-x86_64.zip`(안에 `rhwp/rhwp.exe`),
   `darwin-arm64` → `rhwp-v<ver>-macos-aarch64.tar.gz`, `darwin-x64` → `macos-x86_64`, `linux-x64` → `linux-x86_64`.
   URL `https://github.com/edwardkim/rhwp/releases/download/v<ver>/<asset>`.
3. `SHA256SUMS.txt`를 같은 릴리스에서 받아 자산 파일의 SHA-256과 대조한다. 불일치면 실패.
4. 압축 해제: zip은 JSZip(루트 `node_modules`에 호이스팅된 기존 의존성), tar.gz는 시스템 `tar`.
   산출: `apps/hwp/native/rhwp/<platform>-<arch>/rhwp[.exe]` + 같은 폴더에 `LICENSE`(자산에 동봉된 MIT).
   POSIX에서는 실행 권한 부여.
5. 스탬프 `.rhwp-version`(버전·플랫폼)이 일치하면 skip, `--force`로 재획득.
6. 고지: rhwp LICENSE는 스튜디오 `THIRD-PARTY.md`(§5.7)에 이미 포함되므로 별도 항목 없이 "CLI 바이너리 포함"을 그 절에 한 줄 명시.

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
  → resolveNativeBinary('hwpforge-mcp') → spawn(bin) → initialize → tools/call hwpforge_convert
  → userData/ai-created/<name>.hwpx → runtime.onCreateDocument → 셸이 새 탭
```

## 7. 에러 처리

| 상황 | 동작 |
|---|---|
| `studioDir` 미지정 또는 `studioDir/index.html` 부재 | `getStudioUrl` → `{ ok: false, error }`. dev: `"HWP studio is not built — run: npm run build -w @genoffice/hwp"`. packaged: `"Bundled HWP editor assets are missing — reinstall Open GenOffice."` 렌더러는 이 메시지를 오류 화면에 그대로 표시 |
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
- `native-binary-path.test.ts`: 우선순위 4단계, HwpForge·rhwp의 dev 경로, win32 `.exe` 접미, platform/arch 조합.
- `hwpforge-client.test.ts`: `spawnImpl`에 가짜 child(EventEmitter + PassThrough)를 주입해
  initialize→`notifications/initialized`→`tools/call` 응답 조립, `isError` → throw, 타임아웃,
  `error` 이벤트(ENOENT) → reject 경로. 선례: `apps/sheets/tests/xlsx-sidecar.test.ts`.

### 수용 (실측, Windows 머신)

`dist:win`은 `build:all`을 거치며 sheets Rust 사이드카를 컴파일한다 — Rust 툴체인은 리포의 기존
요구사항(`rust-toolchain.toml`)이지만, 이 머신에 설치되어 있는지 구현 계획의 준비 단계에서 확인한다.

1. **수정 전 기준선**(완료 2026-09-21): `main`과 동일한 코드로 `npm run dist:win` → `release/win-unpacked`를
   `scripts/drivers/driver.hwp-k12.mjs`(Playwright `_electron`, 리포 드라이버 관례)로 구동 →
   `hwpApi.createDocument()` **성공**, `.hwpx` 생성, 새 탭 오픈. 초기 가설(실패)은 반증되었고 §1에 반영했다.
   수정 후 같은 드라이버로 회귀 확인한다(바이너리 경로만 `resources/native/`로 바뀜).
2. 오프라인(네트워크 어댑터 비활성)에서 `npm run shell` → 샘플 `.hwpx` 열기 → 편집 → 저장 → 재열기.
3. 수정 후 `npm run dist:win` → 설치 → 오프라인 → `.hwpx` 열기 + K-12 서식 버튼 → 새 탭에 `.hwpx`.
4. `apps/hwp/studio-dist/`와 `apps/shell/out/`에서 `edwardkim.github.io` grep —
   SDK 상수 `DEFAULT_STUDIO_URL` 1건(미사용 기본값)만 남아야 한다.
5. macOS: 서명·노터라이즈 통과와 `native/hwpforge-mcp` 실행은 이 머신에서 불가 —
   CI 또는 별도 머신에서 검증. 구현 계획에 항목으로 남긴다.

### CI

`.github/workflows/ci.yml`은 `build`를 실행하지 않는다(lint/typecheck/fixtures/test만). 따라서 `npm ci` 직후
`npm run build:hwp-studio`와 `npm run fetch:rhwp-cli` 단계를 추가해 두 스크립트를 매 푸시마다 검증한다.
Rust는 필요 없다(WASM은 `@rhwp/core`, CLI는 릴리스 바이너리). 네트워크는 `npm ci`와 같은 조건으로 필요하다.
릴리스 워크플로(`release-windows.yml`)는 `dist:win` → `build:all` → hwp `build`를 거치므로 자동 포함된다.

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
- 설치 용량 **약 +52MB** — 스튜디오 약 42MB(폰트 22 + 번들·WASM·canvaskit 19; 스파이크 실측, 미참조 복사본
  정리 후) + `rhwp` CLI 약 10MB. 감수하는 비용으로 확정.

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
- `tools/fetch-rhwp-cli.mjs`
- `tools/hwp-studio/vite.config.genoffice.ts`
- `apps/hwp/src/main/static-server.ts`
- `apps/hwp/src/main/native-binary-path.ts`
- `apps/hwp/tests/static-server.test.ts`
- `apps/hwp/tests/native-binary-path.test.ts`
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
