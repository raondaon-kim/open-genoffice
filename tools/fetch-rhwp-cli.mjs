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
if (
  !FORCE &&
  existsSync(exePath) &&
  existsSync(stampFile) &&
  readFileSync(stampFile, 'utf8') === stamp
) {
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
  const [archive, sums] = await Promise.all([
    download(base + fileName),
    download(`${base}SHA256SUMS.txt`),
  ])
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
