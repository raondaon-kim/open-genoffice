// Stage the Codex CLI for the Windows x64 installer.
//   node tools/fetch-codex-cli.mjs [--force]
// Downloads the pinned npm tarball, checks its integrity hash, and keeps only what chat needs
// (the voice resources are most of the size and are not used). The tarball is unpacked here in
// Node: the `tar` on PATH may be Git's GNU tar, which reads a drive letter as a remote host.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'shell', 'build', 'codex')
const pin = JSON.parse(readFileSync(join(ROOT, 'tools', 'codex-cli.pin.json'), 'utf8'))
const FORCE = process.argv.includes('--force')
const VENDOR = 'package/vendor/x86_64-pc-windows-msvc/'
/** what chat needs, relative to the vendor folder */
const KEEP = [
  /^bin\/codex\.exe$/,
  /^bin\/codex-code-mode-host\.exe$/,
  /^codex-resources\/codex-command-runner\.exe$/,
  /^codex-resources\/codex-windows-sandbox-setup\.exe$/,
  /^codex-path\/rg\.exe$/,
  /^codex-package\.json$/,
]

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('codex: only Windows x64 builds ship it; skipping')
  process.exit(0)
}
const stamp = join(OUT, '.version')
if (
  !FORCE &&
  existsSync(join(OUT, 'bin', 'codex.exe')) &&
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8') === pin.version
) {
  console.log(`codex: up to date (${pin.version}), skipping`)
  process.exit(0)
}

/** the entries of a tar archive: ustar names (prefix + name), GNU long names and pax paths */
function* tarEntries(buf) {
  let offset = 0
  let longName = null
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) return
    const field = (start, len) =>
      header
        .subarray(start, start + len)
        .toString('utf8')
        .replace(/\0.*$/s, '')
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = String.fromCharCode(header[156] || 48)
    const prefix = field(345, 155)
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100)
    const body = buf.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '')
      continue
    }
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))
      if (m) longName = m[1]
      continue
    }
    const path = longName ?? name
    longName = null
    if (type === '0' || type === '\0') yield { path, body }
  }
}

const res = await fetch(pin.tarball)
if (!res.ok) throw new Error(`codex: download failed: HTTP ${res.status}`)
const bytes = Buffer.from(await res.arrayBuffer())
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
if (integrity !== pin.integrity) throw new Error(`codex: integrity mismatch: got ${integrity}`)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
let kept = 0
for (const { path, body } of tarEntries(gunzipSync(bytes))) {
  if (!path.startsWith(VENDOR)) continue
  const rel = path.slice(VENDOR.length)
  if (!KEEP.some((re) => re.test(rel))) continue
  const target = resolve(OUT, ...rel.split('/'))
  if (!target.startsWith(OUT + sep)) throw new Error(`codex: unsafe path in archive: ${path}`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body)
  kept++
}
if (kept !== KEEP.length) throw new Error(`codex: expected ${KEEP.length} files, found ${kept}`)

const license = await fetch(pin.licenseUrl)
if (!license.ok) throw new Error(`codex: license download failed: HTTP ${license.status}`)
writeFileSync(join(OUT, 'LICENSE'), await license.text())
writeFileSync(
  join(OUT, 'SOURCE.txt'),
  [
    'Codex CLI (Apache-2.0), unmodified.',
    '',
    `Package: ${pin.package}@${pin.version}`,
    `Integrity: ${pin.integrity}`,
    'Source: https://github.com/openai/codex',
    'Only the files chat needs are included; the voice resources are left out.',
    '',
  ].join('\n'),
)
writeFileSync(stamp, pin.version)
console.log(`codex: staged ${pin.version} (${kept} files) in ${OUT}`)
