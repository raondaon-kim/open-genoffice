#!/usr/bin/env node
/**
 * Build the rhwp studio — the Hangul editor UI that apps/hwp embeds in an
 * iframe — from the upstream tag matching the installed @rhwp/core, so the app
 * serves it from its loopback origin instead of edwardkim.github.io and Hangul
 * editing works offline.
 *
 *   node tools/build-hwp-studio.mjs [--force]
 *
 * Output: apps/hwp/dist/studio/ (gitignored; `dist/` is also what eslint and
 * prettier already skip). The upstream clone lives in apps/hwp/.build/rhwp/ for
 * the same reason. Skipped when the .rhwp-version stamp already matches;
 * --force rebuilds. Needs git and network on the first run (sparse clone of
 * edwardkim/rhwp + npm ci inside rhwp-studio). No Rust: the WASM comes from the
 * @rhwp/core npm package.
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

// resolve @rhwp/core from the hwp app: npm may keep it in apps/hwp/node_modules instead of the root
const require = createRequire(join(HWP_DIR, 'package.json'))
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
  // upstream ships a package-lock.json (v0.8.7); fall back to install if a later tag drops it
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
    'The bundled studio UI, the WASM engine (@rhwp/core) and the rhwp CLI binary all come from this project.',
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
  if (!existsSync(join(STAGING_DIR, 'index.html'))) {
    throw new Error('studio build is missing index.html')
  }
  const assetsDir = join(STAGING_DIR, 'assets')
  const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : []
  if (!assets.some((f) => /^rhwp_bg-.*\.wasm$/.test(f))) {
    throw new Error('studio build is missing the bundled assets/rhwp_bg-*.wasm')
  }
  if (!assets.some((f) => /^studio-plugin-.*\.js$/.test(f))) {
    throw new Error(
      'studio build is missing the hwpctrl studio-plugin chunk (RHWP_WITHOUT_HWPCTRL set?)',
    )
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
  // a fresh checkout has no apps/hwp/dist yet; rename needs the parent to exist
  mkdirSync(dirname(DIST_DIR), { recursive: true })
  renameSync(STAGING_DIR, DIST_DIR)
  console.log(`hwp studio: built rhwp ${tag} → ${relative(ROOT, DIST_DIR)}`)
} catch (err) {
  console.error(`hwp studio: build failed — ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
