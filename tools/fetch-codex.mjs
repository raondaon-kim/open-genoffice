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
import { CODEX_ASSETS, CODEX_VERSION } from './codex-assets.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const FORCE = process.argv.includes('--force')
const VERSION = CODEX_VERSION
const TAG = `rust-v${VERSION}`
const ASSETS = CODEX_ASSETS

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
