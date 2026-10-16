// Build the LLM Wiki fork from a local checkout and stage it for the installer.
//   LLM_WIKI_FORK_DIR=D:\llm_wiki_ubion\llm_wiki node tools/fetch-llm-wiki.mjs [--force]
// The checkout must be at the commit in tools/llm-wiki.pin.json.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'shell', 'build', 'llm-wiki')
const pin = JSON.parse(readFileSync(join(ROOT, 'tools', 'llm-wiki.pin.json'), 'utf8'))
const FORCE = process.argv.includes('--force')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('llm wiki: only Windows x64 builds ship it; skipping')
  process.exit(0)
}
const fork = process.env.LLM_WIKI_FORK_DIR
if (!fork || !existsSync(join(fork, 'src-tauri', 'Cargo.toml'))) {
  console.error('llm wiki: set LLM_WIKI_FORK_DIR to a checkout of the fork (' + pin.repo + ')')
  process.exit(1)
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: true })
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fork, encoding: 'utf8' }).trim()
if (head !== pin.commit) {
  console.error(`llm wiki: the checkout is at ${head}, the pin is ${pin.commit}`)
  process.exit(1)
}
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
  cwd: fork,
  encoding: 'utf8',
}).trim()
if (dirty) {
  console.error(
    'llm wiki: the checkout has uncommitted changes; the shipped build must match the pinned commit',
  )
  process.exit(1)
}
const stamp = join(OUT, '.commit')
if (
  !FORCE &&
  existsSync(join(OUT, 'llm-wiki.exe')) &&
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8') === head
) {
  console.log(`llm wiki: up to date (${head.slice(0, 8)}), skipping`)
  process.exit(0)
}

if (!existsSync(join(fork, 'node_modules'))) run('npm', ['ci'], fork)
run('npx', ['tauri', 'build', '--no-bundle'], fork)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'pdfium'), { recursive: true })
mkdirSync(join(OUT, 'scripts'), { recursive: true })
copyFileSync(
  join(fork, 'src-tauri', 'target', 'release', 'llm-wiki.exe'),
  join(OUT, 'llm-wiki.exe'),
)
copyFileSync(join(fork, 'src-tauri', 'pdfium', 'pdfium.dll'), join(OUT, 'pdfium', 'pdfium.dll'))
copyFileSync(
  join(fork, 'src-tauri', 'scripts', 'extract_pdf.py'),
  join(OUT, 'scripts', 'extract_pdf.py'),
)
copyFileSync(join(fork, 'LICENSE'), join(OUT, 'LICENSE'))
writeFileSync(
  join(OUT, 'SOURCE.txt'),
  [
    'LLM Wiki (GPL-3.0), modified for GenOffice.',
    '',
    `Source of this exact build: ${pin.repo}`,
    `Commit: ${head}`,
    '',
    'Build: npm ci && npx tauri build --no-bundle (Node 22, Rust 1.95, protoc).',
    'The license text is in LICENSE next to this file. Upstream: https://github.com/nashsu/llm_wiki',
    '',
  ].join('\n'),
)
writeFileSync(stamp, head)
console.log(`llm wiki: staged ${head.slice(0, 8)} in ${OUT}`)
