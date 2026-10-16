// Stage Tesseract (UB-Mannheim Windows build) and its Korean/English data for the installer.
//   node tools/fetch-tesseract.mjs [--force]
// 7-Zip unpacks the installer on the build machine (SEVENZIP, else the default install, else
// 7z on PATH); users of the installer need nothing.
// Two checks make sure the staged files are complete without help from this machine: the import
// tables (every DLL tesseract.exe needs that the installer provides is staged, nothing unused is),
// and a smoke run whose PATH holds only Windows' own folders. Everything is assembled in a
// temporary folder and moved into place only after both pass.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importClosure } from './lib/pe-imports.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'shell', 'build', 'tesseract')
const pinText = readFileSync(join(ROOT, 'tools', 'tesseract.pin.json'), 'utf8')
const pin = JSON.parse(pinText)
// the stamp is the pin itself: editing the file list or the data re-stages even without a version bump
const stampValue = createHash('sha256').update(pinText).digest('hex')
const FORCE = process.argv.includes('--force')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('tesseract: only Windows x64 builds ship it; skipping')
  process.exit(0)
}
const stamp = join(OUT, '.version')
if (
  !FORCE &&
  existsSync(join(OUT, 'tesseract.exe')) &&
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8') === stampValue
) {
  console.log(`tesseract: up to date (${pin.version}), skipping`)
  process.exit(0)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function download(url, expected) {
  // some hosts (gnu.org) refuse requests without a user agent
  const res = await fetch(url, {
    headers: { 'User-Agent': 'open-genoffice-build' },
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) throw new Error(`tesseract: download failed (${res.status}): ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (got !== expected) throw new Error(`tesseract: hash mismatch for ${url}: ${got}`)
  return buf
}

const sevenZip =
  [process.env.SEVENZIP, 'C:\\Program Files\\7-Zip\\7z.exe'].find((p) => p && existsSync(p)) ?? '7z'

function sourceText(p) {
  return [
    'Tesseract OCR (Apache-2.0), unmodified, used by LLM Wiki to read scanned PDFs.',
    '',
    `Build: UB-Mannheim Windows ${p.version} (${p.installer.url}, sha256 ${p.installer.sha256})`,
    'Source: https://github.com/tesseract-ocr/tesseract and https://github.com/UB-Mannheim/tesseract',
    ...p.tessdata.map((d) => `Trained data ${d.name}: ${d.url} (Apache-2.0, sha256 ${d.sha256})`),
    '',
    'Libraries, unmodified, from the MSYS2 MINGW64 packages this build is made with. Package',
    'definitions: https://github.com/msys2/MINGW-packages; built packages and their sources:',
    'https://packages.msys2.org and https://repo.msys2.org/mingw/sources/.',
    '  leptonica (BSD-2-Clause), libarchive (BSD-2-Clause), libb2 (CC0-1.0), bzip2 (bzip2 license),',
    '  OpenSSL libcrypto (Apache-2.0), libdeflate (MIT), expat (MIT), giflib (MIT), libjpeg-turbo',
    '  (IJG and BSD-3-Clause), lerc (Apache-2.0), lz4 (BSD-2-Clause), xz liblzma (0BSD), openjpeg',
    '  (BSD-2-Clause), libpng (libpng-2.0), libwebp and sharpyuv (BSD-3-Clause), libtiff (libtiff),',
    '  winpthreads (MIT and BSD-3-Clause), zstd (BSD-3-Clause), zlib (Zlib).',
    '  libiconv 1.17 (LGPL-2.1; licenses/COPYING.LGPL-2.1; source https://ftp.gnu.org/gnu/libiconv/).',
    '  JBIG-KIT libjbig 2.1 (GPL-2.0-or-later; licenses/COPYING.GPL-2.0; source',
    '    https://www.cl.cam.ac.uk/~mgk25/jbigkit/).',
    '  libgcc and libstdc++ (GPL-3.0 with the GCC Runtime Library Exception 3.1;',
    '    licenses/COPYING.GPL-3.0 and licenses/COPYING.RUNTIME; source https://gcc.gnu.org/).',
    '',
    'Written offer: for three years after this release, the complete corresponding source code of',
    'the GPL and LGPL libraries above, as shipped here, is available on request at no charge beyond',
    'the cost of providing it. Ask at https://github.com/raondaon-kim/open-genoffice/issues.',
    '',
    'The Tesseract license text is in LICENSE next to this file; the other license texts are in',
    'licenses/.',
    '',
  ].join('\n')
}

const work = mkdtempSync(join(tmpdir(), 'tesseract-fetch-'))
// next to OUT, so the final move never crosses drives
const stage = join(dirname(OUT), `.tesseract-staging-${process.pid}`)
try {
  const installer = join(work, 'setup.exe')
  writeFileSync(installer, await download(pin.installer.url, pin.installer.sha256))
  const unpacked = join(work, 'x')
  execFileSync(sevenZip, ['x', '-y', `-o${unpacked}`, installer], { stdio: 'ignore' })

  // what tesseract.exe needs, read from the import tables of the installer's own files
  const needed = importClosure(unpacked, 'tesseract.exe')
  const pinned = new Set(pin.files.map((f) => f.toLowerCase()))
  const missing = [...needed].filter((f) => !pinned.has(f))
  const unused = [...pinned].filter((f) => !needed.has(f))
  if (missing.length || unused.length) {
    throw new Error(
      `tesseract: the pinned file list is wrong; missing: ${missing.join(', ') || 'none'}; ` +
        `not needed: ${unused.join(', ') || 'none'}`,
    )
  }

  rmSync(stage, { recursive: true, force: true })
  mkdirSync(join(stage, 'tessdata'), { recursive: true })
  mkdirSync(join(stage, 'licenses'), { recursive: true })
  for (const name of pin.files) copyFileSync(join(unpacked, name), join(stage, name))
  copyFileSync(join(unpacked, 'doc', 'LICENSE'), join(stage, 'LICENSE'))
  for (const d of pin.tessdata) {
    writeFileSync(join(stage, 'tessdata', `${d.name}.traineddata`), await download(d.url, d.sha256))
  }
  for (const l of pin.licenses) {
    writeFileSync(join(stage, 'licenses', l.file), await download(l.url, l.sha256))
  }

  // a missing DLL makes Windows refuse to start the program; only Windows' own folders are on PATH
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const env = {
    SystemRoot: systemRoot,
    PATH: `${systemRoot}\\System32;${systemRoot}`,
    TESSDATA_PREFIX: join(stage, 'tessdata'),
  }
  const exe = join(stage, 'tesseract.exe')
  execFileSync(exe, ['--version'], { env, cwd: stage, stdio: 'ignore', windowsHide: true })
  const langs = execFileSync(exe, ['--list-langs'], {
    env,
    cwd: stage,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split(/\r?\n/)
    .map((l) => l.trim())
  for (const d of pin.tessdata) {
    if (!langs.includes(d.name)) throw new Error(`tesseract: language ${d.name} did not load`)
  }
  writeFileSync(join(stage, 'SOURCE.txt'), sourceText(pin))
  writeFileSync(join(stage, '.version'), stampValue)

  // only a complete, checked folder replaces what was there
  rmSync(OUT, { recursive: true, force: true })
  renameSync(stage, OUT)
  console.log(
    `tesseract: staged ${pin.version} (${pin.files.length} files, ${pin.tessdata.length} languages, ` +
      `${pin.licenses.length} license texts) in ${OUT}`,
  )
} finally {
  rmSync(work, { recursive: true, force: true })
  rmSync(stage, { recursive: true, force: true })
}
