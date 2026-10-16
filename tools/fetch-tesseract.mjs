// Stage Tesseract (UB-Mannheim Windows build) and its Korean/English data for the installer.
//   node tools/fetch-tesseract.mjs [--force]
// 7-Zip unpacks the installer on the build machine (SEVENZIP, else the default install, else
// 7z on PATH); users of the installer need nothing. A smoke run proves the files are complete.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'shell', 'build', 'tesseract')
const pin = JSON.parse(readFileSync(join(ROOT, 'tools', 'tesseract.pin.json'), 'utf8'))
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
  readFileSync(stamp, 'utf8') === pin.version
) {
  console.log(`tesseract: up to date (${pin.version}), skipping`)
  process.exit(0)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function download(url, expected) {
  const res = await fetch(url)
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
    'Libraries (from the MSYS2 MINGW64 packages the build uses; sources at https://packages.msys2.org):',
    '  leptonica (BSD-2-Clause), libarchive (BSD-2-Clause), libb2 (CC0-1.0), bzip2 (bzip2 license),',
    '  OpenSSL libcrypto (Apache-2.0), libdeflate (MIT), expat (MIT), libgcc and libstdc++ (GPL-3.0',
    '  with the GCC Runtime Library Exception), giflib (MIT), libiconv (LGPL-2.1), JBIG-KIT libjbig',
    '  (GPL-2.0), libjpeg-turbo (IJG and BSD-3-Clause), lerc (Apache-2.0), lz4 (BSD-2-Clause),',
    '  xz liblzma (0BSD), openjpeg (BSD-2-Clause), libpng (libpng-2.0), libwebp and sharpyuv',
    '  (BSD-3-Clause), libtiff (libtiff), winpthreads (MIT and BSD-3-Clause), zstd (BSD-3-Clause),',
    '  zlib (Zlib).',
    'The Tesseract license text is in LICENSE next to this file.',
    '',
  ].join('\n')
}

const work = mkdtempSync(join(tmpdir(), 'tesseract-fetch-'))
try {
  const installer = join(work, 'setup.exe')
  writeFileSync(installer, await download(pin.installer.url, pin.installer.sha256))
  const unpacked = join(work, 'x')
  execFileSync(sevenZip, ['x', '-y', `-o${unpacked}`, installer], { stdio: 'ignore' })
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, 'tessdata'), { recursive: true })
  for (const name of pin.files) {
    const src = join(unpacked, name)
    if (!existsSync(src)) throw new Error(`tesseract: ${name} is not in the installer`)
    copyFileSync(src, join(OUT, name))
  }
  copyFileSync(join(unpacked, 'doc', 'LICENSE'), join(OUT, 'LICENSE'))
  for (const d of pin.tessdata) {
    writeFileSync(join(OUT, 'tessdata', `${d.name}.traineddata`), await download(d.url, d.sha256))
  }
  // a missing DLL makes Windows refuse to start the program: fail the build, not the user
  const env = { ...process.env, TESSDATA_PREFIX: join(OUT, 'tessdata') }
  const exe = join(OUT, 'tesseract.exe')
  execFileSync(exe, ['--version'], { env, stdio: 'ignore', windowsHide: true })
  const langs = execFileSync(exe, ['--list-langs'], { env, encoding: 'utf8', windowsHide: true })
    .split(/\r?\n/)
    .map((l) => l.trim())
  for (const d of pin.tessdata) {
    if (!langs.includes(d.name)) throw new Error(`tesseract: language ${d.name} did not load`)
  }
  writeFileSync(join(OUT, 'SOURCE.txt'), sourceText(pin))
  writeFileSync(stamp, pin.version)
  console.log(
    `tesseract: staged ${pin.version} (${pin.files.length} files, ${pin.tessdata.length} languages) in ${OUT}`,
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
