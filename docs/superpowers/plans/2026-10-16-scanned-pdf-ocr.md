# Scanned PDF text recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scanned (image-only) PDF added to the work wiki is learned with nothing but the Open GenOffice installer: the LLM Wiki fork renders its pages with pdfium and reads them with a bundled Tesseract (Korean + English).

**Architecture:** A new `ocr` module in the LLM Wiki fork renders pages to PNG (pdfium-render) and runs the bundled `tesseract.exe` per page; `extract_pdf_text` tries it before the old Python tools. Open GenOffice stages a pinned Tesseract build (27 files plus trained data) next to `llm-wiki.exe` in the installer.

**Tech Stack:** Rust (Tauri 2, pdfium-render 0.9, image 0.25), Node build scripts, 7-Zip on the build machine, electron-builder.

**Spec:** `docs/superpowers/specs/2026-10-16-scanned-pdf-ocr-design.md`

## Global Constraints

- Repositories: the fork is `D:\llm_wiki_ubion\llm_wiki` (branch `genoffice`, remote `genoffice` = github.com/raondaon-kim/llm_wiki); Open GenOffice is `D:\genoffice-next` (push `HEAD:main` and `HEAD:migrate/upstream-2026-10` to the remote `private` only).
- Tesseract build: `https://github.com/UB-Mannheim/tesseract/releases/download/v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe`, sha256 `c885fff6998e0608ba4bb8ab51436e1c6775c2bafc2559a19b423e18678b60c9`.
- Trained data: `kor` = `https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/kor.traineddata` (sha256 `f888d4038348a0c3d25151e7f452bda0d74ca275b18cab146798bcbb94084fff`); `eng` = `https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata` (sha256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`).
- OCR call: `tesseract <page.png> <outbase> -l kor+eng --psm 3`, `TESSDATA_PREFIX=<tessdata>`, hidden window; 300 dpi; at most 200 pages; 120 s per page.
- Lookup: `LLM_WIKI_TESSERACT_DIR`, else `<folder of llm-wiki.exe>/tesseract`; present when `tesseract.exe` and `tessdata/kor.traineddata` exist.
- Installer location: `resources/llm-wiki/tesseract/`. Users need nothing; 7-Zip is a build-machine tool only.
- Commit messages through `git commit -F <file>` in a command of their own, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Source comments in English.

## Review Focus

1. A PDF with a text layer must never run OCR (the sparse-text check decides).
2. One page whose OCR fails or times out: skipped, the other pages kept, the temp folder removed.
3. No bundled Tesseract (standalone fork, dev run without staging): the old pymupdf/OCRmyPDF path still runs.
4. Paths with Hangul (the user's profile and temp folder): rendering, the Tesseract call and reading its output.
5. A missing DLL in the staged Tesseract: the fetch script's smoke run fails the build instead of shipping a broken OCR.

---

# Part A: LLM Wiki fork

### Task 1: The `ocr` module helpers

**Files:**

- Create: `src-tauri/src/commands/ocr.rs`
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod ocr;`), `src-tauri/src/commands/fs.rs` (`hide_console` becomes `pub(crate)`)

**Interfaces:**

- Produces: `TesseractPaths { exe: PathBuf, tessdata: PathBuf }`, `find_tesseract(env_dir: Option<&str>, exe_dir: Option<&Path>) -> Option<TesseractPaths>`, `bundled_tesseract() -> Option<TesseractPaths>`, `tesseract_args(image: &Path, out_base: &Path) -> Vec<OsString>`, `assemble_pages(pages: &[String]) -> String`, `render_width(width_pt: f32) -> i32`, constants `MAX_OCR_PAGES = 200`, `OCR_LANGS = "kor+eng"`.

- [ ] **Step 1: Write the failing tests** — at the end of `ocr.rs` (create the file with only the test module first, so it fails to compile):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!("ocr-test-{tag}-{nanos}"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn fake_install(dir: &Path) {
        fs::create_dir_all(dir.join("tessdata")).unwrap();
        fs::write(dir.join("tesseract.exe"), b"x").unwrap();
        fs::write(dir.join("tessdata").join("kor.traineddata"), b"x").unwrap();
    }

    #[test]
    fn finds_tesseract_from_the_env_folder_first_then_next_to_the_exe() {
        let env_dir = temp_dir("env");
        fake_install(&env_dir);
        let exe_dir = temp_dir("exe");
        fake_install(&exe_dir.join("tesseract"));
        let from_env = find_tesseract(env_dir.to_str(), Some(&exe_dir)).unwrap();
        assert_eq!(from_env.exe, env_dir.join("tesseract.exe"));
        assert_eq!(from_env.tessdata, env_dir.join("tessdata"));
        let beside = find_tesseract(None, Some(&exe_dir)).unwrap();
        assert_eq!(beside.exe, exe_dir.join("tesseract").join("tesseract.exe"));
        assert_eq!(find_tesseract(Some("  "), Some(&exe_dir)).unwrap(), beside);
    }

    #[test]
    fn a_folder_without_the_korean_data_does_not_count() {
        let d = temp_dir("nokor");
        fs::write(d.join("tesseract.exe"), b"x").unwrap();
        assert!(find_tesseract(d.to_str(), None).is_none());
        assert!(find_tesseract(None, None).is_none());
    }

    #[test]
    fn finds_tesseract_under_a_hangul_folder() {
        let d = temp_dir("한글폴더");
        fake_install(&d);
        assert!(find_tesseract(d.to_str(), None).is_some());
    }

    #[test]
    fn the_command_line_reads_korean_and_english_with_automatic_layout() {
        let args = tesseract_args(Path::new("C:/t/page-1.png"), Path::new("C:/t/page-1"));
        let args: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["C:/t/page-1.png", "C:/t/page-1", "-l", "kor+eng", "--psm", "3"]);
    }

    #[test]
    fn pages_become_numbered_sections_and_empty_pages_stay_numbered() {
        let text = assemble_pages(&["  첫 쪽\n".to_string(), String::new(), "셋째".to_string()]);
        assert_eq!(text, "## Page 1\n\n첫 쪽\n\n## Page 2\n\n\n\n## Page 3\n\n셋째\n\n");
    }

    #[test]
    fn pages_render_at_300_dpi_within_bounds() {
        assert_eq!(render_width(595.0), 2479); // A4 width in points
        assert_eq!(render_width(1.0), 200);
        assert_eq!(render_width(100_000.0), 6000);
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd src-tauri && cargo test --lib ocr::tests`
Expected: FAIL to compile (`find_tesseract` and the others are missing). (Add `pub mod ocr;` to `commands/mod.rs` first so the module is compiled.)

- [ ] **Step 3: Implement** — above the test module in `ocr.rs`:

```rust
//! Text recognition for scanned PDFs with the Tesseract that ships next to this program.
use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub const MAX_OCR_PAGES: usize = 200;
pub const OCR_LANGS: &str = "kor+eng";
const DPI: f32 = 300.0;

#[derive(Debug, Clone, PartialEq)]
pub struct TesseractPaths {
    pub exe: PathBuf,
    pub tessdata: PathBuf,
}

/// LLM_WIKI_TESSERACT_DIR when set, else `<exe dir>/tesseract`; only a folder that has the
/// executable and the Korean data counts.
pub fn find_tesseract(env_dir: Option<&str>, exe_dir: Option<&Path>) -> Option<TesseractPaths> {
    let dir = match env_dir.map(str::trim).filter(|s| !s.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => exe_dir?.join("tesseract"),
    };
    let exe = dir.join("tesseract.exe");
    let tessdata = dir.join("tessdata");
    if exe.is_file() && tessdata.join("kor.traineddata").is_file() {
        Some(TesseractPaths { exe, tessdata })
    } else {
        None
    }
}

/// the Tesseract this process can use: the env override or the folder next to the executable
pub fn bundled_tesseract() -> Option<TesseractPaths> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    find_tesseract(
        std::env::var("LLM_WIKI_TESSERACT_DIR").ok().as_deref(),
        exe_dir.as_deref(),
    )
}

/// `tesseract <image> <outbase> -l kor+eng --psm 3`: the text lands in `<outbase>.txt`
pub fn tesseract_args(image: &Path, out_base: &Path) -> Vec<OsString> {
    vec![
        image.into(),
        out_base.into(),
        "-l".into(),
        OCR_LANGS.into(),
        "--psm".into(),
        "3".into(),
    ]
}

/// the pages as `## Page N` sections, the shape the text path returns
pub fn assemble_pages(pages: &[String]) -> String {
    let mut out = String::new();
    for (i, text) in pages.iter().enumerate() {
        out.push_str(&format!("## Page {}\n\n{}\n\n", i + 1, text.trim()));
    }
    out
}

/// pixel width for a page `width_pt` points wide at 300 dpi, kept between 200 and 6000
pub fn render_width(width_pt: f32) -> i32 {
    ((width_pt / 72.0) * DPI).round().clamp(200.0, 6000.0) as i32
}
```

In `fs.rs` change `fn hide_console(` to `pub(crate) fn hide_console(`.

- [ ] **Step 4: Run the tests and commit**

Run: `cd src-tauri && cargo test --lib ocr::tests`
Expected: PASS (6 tests).

```bash
git add src-tauri/src/commands/ocr.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/fs.rs
git commit -F <file>   # "feat(pdf): find the bundled Tesseract and build its command line"
```

---

### Task 2: OCR a scanned PDF and use it before the Python tools

**Files:**

- Modify: `src-tauri/src/commands/ocr.rs` (`ocr_pdf_with_tesseract`, `run_with_timeout`)
- Modify: `src-tauri/src/commands/fs.rs` (`extract_pdf_text`, both scanned branches)
- Create: `src-tauri/tests/fixtures/scanned-ko.pdf` (an image-only PDF)

**Interfaces:**

- Consumes: Task 1 helpers; `crate::commands::fs::pdfium()`, `hide_console`.
- Produces: `ocr_pdf_with_tesseract(pdf_path: &str, t: &TesseractPaths) -> Result<String, String>`.

- [ ] **Step 1: Make the fixture** (outside the repository's code; the PDF is committed). A two-page image-only PDF, page 1 with Korean and English, page 2 blank:

```bash
python -I - <<'EOF'
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype(r"C:\Windows\Fonts\malgun.ttf", 64)
page = Image.new("RGB", (2480, 3508), "white")
d = ImageDraw.Draw(page)
d.text((200, 300), "한빛정보 회사소개", font=font, fill="black")
d.text((200, 450), "Hanbit Information, founded 2009", font=font, fill="black")
blank = Image.new("RGB", (2480, 3508), "white")
page.save(r"D:\llm_wiki_ubion\llm_wiki\src-tauri\tests\fixtures\scanned-ko.pdf", save_all=True, append_images=[blank], resolution=300)
EOF
```

(Create `src-tauri/tests/fixtures/` first.)

- [ ] **Step 2: Write the failing test** — in `ocr.rs`'s test module:

```rust
    /// Runs only where a real Tesseract is given (LLM_WIKI_TESSERACT_DIR) and pdfium can load
    /// (PDFIUM_DYNAMIC_LIB_PATH); otherwise it reports the skip and passes.
    #[test]
    fn reads_korean_and_english_from_an_image_only_pdf() {
        let Some(t) = std::env::var("LLM_WIKI_TESSERACT_DIR")
            .ok()
            .and_then(|d| find_tesseract(Some(&d), None))
        else {
            eprintln!("skipped: LLM_WIKI_TESSERACT_DIR is not set");
            return;
        };
        let pdf = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/scanned-ko.pdf");
        let text = ocr_pdf_with_tesseract(pdf, &t).expect("ocr");
        assert!(text.starts_with("## Page 1"));
        assert!(text.contains("## Page 2"));
        assert!(text.contains("한빛정보"), "got: {text}");
        assert!(text.contains("2009"), "got: {text}");
    }
```

- [ ] **Step 3: Run it to see it fail**

Run (the Tesseract staged by GenOffice's fetch script, or this PC's install for now):
`cd src-tauri && LLM_WIKI_TESSERACT_DIR="C:/Program Files/Tesseract-OCR" PDFIUM_DYNAMIC_LIB_PATH="$PWD/pdfium/pdfium.dll" cargo test --lib ocr::tests::reads_korean`
Expected: FAIL to compile (`ocr_pdf_with_tesseract` is missing).

- [ ] **Step 4: Implement** — in `ocr.rs` (add `use std::process::{Command, Stdio}; use std::time::{Duration, Instant};`):

```rust
const PAGE_TIMEOUT: Duration = Duration::from_secs(120);

fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| format!("tesseract did not start: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => return Err(format!("tesseract exited with {status}")),
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("tesseract timed out".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(format!("tesseract could not be waited for: {e}")),
        }
    }
}

/// Render every page (up to MAX_OCR_PAGES) at 300 dpi and read it with Tesseract. A page that
/// fails is left empty and named in the log; the temporary folder is always removed.
pub fn ocr_pdf_with_tesseract(pdf_path: &str, t: &TesseractPaths) -> Result<String, String> {
    use pdfium_render::prelude::*;
    let pdfium = crate::commands::fs::pdfium()?;
    let doc = pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|e| format!("pdfium could not open the PDF: {e}"))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let work = std::env::temp_dir().join(format!("llm-wiki-ocr-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&work).map_err(|e| format!("no temporary folder for OCR: {e}"))?;
    let mut pages = Vec::new();
    for (i, page) in doc.pages().iter().enumerate() {
        if i >= MAX_OCR_PAGES {
            eprintln!("[ocr] stopped after {MAX_OCR_PAGES} pages");
            break;
        }
        let one = || -> Result<String, String> {
            let config = PdfRenderConfig::new().set_target_width(render_width(page.width().value));
            let image = page
                .render_with_config(&config)
                .map_err(|e| format!("render: {e}"))?
                .as_image()
                .map_err(|e| format!("image: {e}"))?;
            let png = work.join(format!("page-{}.png", i + 1));
            image
                .save_with_format(&png, image::ImageFormat::Png)
                .map_err(|e| format!("png: {e}"))?;
            let base = work.join(format!("page-{}", i + 1));
            let mut cmd = Command::new(&t.exe);
            cmd.args(tesseract_args(&png, &base))
                .env("TESSDATA_PREFIX", &t.tessdata)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::commands::fs::hide_console(&mut cmd);
            run_with_timeout(&mut cmd, PAGE_TIMEOUT)?;
            std::fs::read_to_string(base.with_extension("txt")).map_err(|e| format!("output: {e}"))
        };
        match one() {
            Ok(text) => pages.push(text),
            Err(e) => {
                eprintln!("[ocr] page {} skipped: {e}", i + 1);
                pages.push(String::new());
            }
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    Ok(assemble_pages(&pages))
}
```

In `fs.rs`, in both scanned branches, right after the sparse-text check and before the `trying pymupdf` line, insert:

```rust
            // the Tesseract shipped with this program reads scanned pages without Python
            if let Some(t) = super::ocr::bundled_tesseract() {
                eprintln!("[extract_pdf_text] scanned PDF — OCR with the bundled Tesseract");
                match super::ocr::ocr_pdf_with_tesseract(path, &t) {
                    Ok(text) => return Ok(text),
                    Err(e) => eprintln!("[extract_pdf_text] bundled OCR failed: {e}; trying the other tools"),
                }
            }
```

(If `image::ImageFormat` does not resolve from `ocr.rs`, use the `image` crate the fork already depends on: `image = { version = "0.25" ... }` in `Cargo.toml`, the same version pdfium-render's `image_025` feature uses.)

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && LLM_WIKI_TESSERACT_DIR="C:/Program Files/Tesseract-OCR" PDFIUM_DYNAMIC_LIB_PATH="$PWD/pdfium/pdfium.dll" cargo test --lib ocr::tests` and then `cargo test --lib` (everything), `cd .. && npm run build`.
Expected: PASS; the OCR test prints no skip line and finds `한빛정보` and `2009`.

- [ ] **Step 6: Commit, notes, push**

Add to `MODIFICATIONS.md`: "- Scanned PDFs: pages are rendered with pdfium and read with the Tesseract shipped next to the program (`tesseract/`, or `LLM_WIKI_TESSERACT_DIR`), before the pymupdf/OCRmyPDF fallback." and one line to `README.md`'s list of changes.

```bash
git add src-tauri/src/commands src-tauri/tests/fixtures/scanned-ko.pdf MODIFICATIONS.md README.md
git commit -F <file>   # "feat(pdf): read scanned PDFs with the bundled Tesseract before the Python tools"
git push genoffice genoffice
git rev-parse HEAD     # the commit Open GenOffice pins in Task 4
```

---

# Part B: Open GenOffice

### Task 3: Stage Tesseract for the installer

**Files:**

- Create: `tools/fetch-tesseract.mjs`, `tools/tesseract.pin.json`
- Modify: `apps/shell/electron-builder.cjs`, `package.json`, `.gitignore`, `ACKNOWLEDGMENTS.md`, `MODIFICATIONS.md`

**Interfaces:**

- Produces: `apps/shell/build/tesseract/{tesseract.exe, 26 DLLs, tessdata/{kor,eng}.traineddata, LICENSE, SOURCE.txt, .version}`; installer path `resources/llm-wiki/tesseract/`.

- [ ] **Step 1: The pin** `tools/tesseract.pin.json`:

```json
{
  "version": "5.4.0.20240606",
  "installer": {
    "url": "https://github.com/UB-Mannheim/tesseract/releases/download/v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe",
    "sha256": "c885fff6998e0608ba4bb8ab51436e1c6775c2bafc2559a19b423e18678b60c9"
  },
  "files": [
    "tesseract.exe",
    "libtesseract-5.dll",
    "libleptonica-6.dll",
    "libarchive-13.dll",
    "libb2-1.dll",
    "libbz2-1.dll",
    "libcrypto-3-x64.dll",
    "libdeflate.dll",
    "libexpat-1.dll",
    "libgcc_s_seh-1.dll",
    "libgif-7.dll",
    "libiconv-2.dll",
    "libjbig-0.dll",
    "libjpeg-8.dll",
    "liblerc.dll",
    "liblz4.dll",
    "liblzma-5.dll",
    "libopenjp2-7.dll",
    "libpng16-16.dll",
    "libsharpyuv-0.dll",
    "libstdc++-6.dll",
    "libtiff-6.dll",
    "libwebp-7.dll",
    "libwebpmux-3.dll",
    "libwinpthread-1.dll",
    "libzstd.dll",
    "zlib1.dll"
  ],
  "tessdata": [
    {
      "name": "kor",
      "url": "https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/kor.traineddata",
      "sha256": "f888d4038348a0c3d25151e7f452bda0d74ca275b18cab146798bcbb94084fff"
    },
    {
      "name": "eng",
      "url": "https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata",
      "sha256": "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"
    }
  ]
}
```

- [ ] **Step 2: The fetch script** `tools/fetch-tesseract.mjs`:

```js
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
  for (const d of pin.tessdata) {
    if (!langs.split(/\r?\n/).includes(d.name))
      throw new Error(`tesseract: language ${d.name} did not load`)
  }
  writeFileSync(join(OUT, 'SOURCE.txt'), SOURCE(pin))
  writeFileSync(stamp, pin.version)
  console.log(
    `tesseract: staged ${pin.version} (${pin.files.length} files, ${pin.tessdata.length} languages) in ${OUT}`,
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}

function SOURCE(p) {
  return [
    'Tesseract OCR (Apache-2.0), unmodified, used by LLM Wiki to read scanned PDFs.',
    '',
    `Build: UB-Mannheim Windows ${p.version} (${p.installer.url}, sha256 ${p.installer.sha256})`,
    'Source: https://github.com/tesseract-ocr/tesseract and https://github.com/UB-Mannheim/tesseract',
    ...p.tessdata.map((d) => `Trained data ${d.name}: ${d.url} (Apache-2.0, sha256 ${d.sha256})`),
    '',
    'Libraries (from the MSYS2 MINGW64 packages the build uses; sources at https://packages.msys2.org):',
    '  leptonica (BSD-2-Clause), libarchive (BSD-2-Clause), libb2 (CC0-1.0), bzip2 (bzip2 license),',
    '  OpenSSL libcrypto (Apache-2.0), libdeflate (MIT), expat (MIT), libgcc and libstdc++ (GPL-3.0 with',
    '  the GCC Runtime Library Exception), giflib (MIT), libiconv (LGPL-2.1), JBIG-KIT libjbig (GPL-2.0),',
    '  libjpeg-turbo (IJG/BSD), lerc (Apache-2.0), lz4 (BSD-2-Clause), xz liblzma (0BSD), openjpeg',
    '  (BSD-2-Clause), libpng (libpng-2.0), libwebp and sharpyuv (BSD-3-Clause), libtiff (libtiff),',
    '  winpthreads (MIT and BSD-3-Clause), zstd (BSD-3-Clause), zlib (Zlib).',
    'The Tesseract license text is in LICENSE next to this file.',
    '',
  ].join('\n')
}
```

- [ ] **Step 3: Run it**

Run: `node tools/fetch-tesseract.mjs` then `node tools/fetch-tesseract.mjs` again.
Expected: first run prints `tesseract: staged 5.4.0.20240606 (27 files, 2 languages) …`; the second prints `up to date`. If `--list-langs` prints a header line, the `includes` check still finds `kor` and `eng` on their own lines.

- [ ] **Step 4: Installer config** — `electron-builder.cjs`, in the Windows `extraResources` after the Codex entry:

```js
      // Tesseract (Apache-2.0) for LLM Wiki's scanned-PDF reading (tools/fetch-tesseract.mjs)
      {
        from: 'build/tesseract',
        to: 'llm-wiki/tesseract',
        filter: ['**/*', '!.version'],
      },
```

and next to `assertCodexStaged`:

```js
function assertTesseractStaged() {
  for (const rel of [
    'build/tesseract/tesseract.exe',
    'build/tesseract/tessdata/kor.traineddata',
    'build/tesseract/LICENSE',
  ]) {
    if (!existsSync(join(__dirname, rel))) {
      throw new Error(`Tesseract is not staged: run npm run fetch:tesseract (${rel})`)
    }
  }
}
```

called in `beforePack` with `assertLlmWikiStaged()` and `assertCodexStaged()`. `package.json`: `"fetch:tesseract": "node tools/fetch-tesseract.mjs"`, and `dist:win` runs `npm run fetch:tesseract` after `fetch:codex-cli`. `.gitignore`: `/apps/shell/build/tesseract/`. `ACKNOWLEDGMENTS.md`: a paragraph naming Tesseract (Apache-2.0) and its libraries in `resources/llm-wiki/tesseract/` with `SOURCE.txt`. `MODIFICATIONS.md`: a bullet "**Scanned PDFs:** the installer carries Tesseract with Korean and English data; LLM Wiki reads scanned PDFs with it, so nothing extra is installed."

- [ ] **Step 5: Verify and commit**

Run: `npx prettier --check tools/fetch-tesseract.mjs tools/tesseract.pin.json apps/shell/electron-builder.cjs ACKNOWLEDGMENTS.md MODIFICATIONS.md && npm run check:english-comments && node -e "require('./apps/shell/electron-builder.cjs')"`
Expected: OK.

```bash
git add tools apps/shell/electron-builder.cjs package.json .gitignore ACKNOWLEDGMENTS.md MODIFICATIONS.md
git commit -F <file>   # "build: ship Tesseract with Korean and English data for scanned PDFs"
```

---

### Task 4: Pin the fork and test the real OCR against the staged Tesseract

**Files:** Modify: `tools/llm-wiki.pin.json`.

- [ ] **Step 1: Run the fork's OCR test against the staged copy** (this is the copy the installer ships):

Run: `cd D:/llm_wiki_ubion/llm_wiki/src-tauri && LLM_WIKI_TESSERACT_DIR=D:/genoffice-next/apps/shell/build/tesseract PDFIUM_DYNAMIC_LIB_PATH="$PWD/pdfium/pdfium.dll" cargo test --lib ocr::tests`
Expected: PASS with no skip line.

- [ ] **Step 2: Pin and stage**

Set `"commit"` in `tools/llm-wiki.pin.json` to the hash printed in Task 2 Step 6, then run `LLM_WIKI_FORK_DIR=D:/llm_wiki_ubion/llm_wiki npm run fetch:llm-wiki`.
Expected: `llm wiki: staged <hash8> …`.

```bash
git add tools/llm-wiki.pin.json
git commit -F <file>   # "build: pin the LLM Wiki fork that reads scanned PDFs with Tesseract"
```

---

### Task 5: Acceptance, installer, push

- [ ] **Step 1: An image-only PDF from real material** (local, not committed): render pages 1–3 of `D:/tmp/oda-survey/rfp/koica_indonesia_health_R25BK01238511_2.pdf` to images and save them as an image-only PDF:

```bash
python -I - <<'EOF'
import fitz
from PIL import Image
src = fitz.open(r"D:\tmp\oda-survey\rfp\koica_indonesia_health_R25BK01238511_2.pdf")
imgs = []
for i in range(3):
    pix = src[i].get_pixmap(dpi=200)
    imgs.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
imgs[0].save(r"D:\tmp\migrate\scanned-koica.pdf", save_all=True, append_images=imgs[1:], resolution=200)
EOF
```

Check it has no text layer: `python -I -c "import fitz; print(len(fitz.open(r'D:\tmp\migrate\scanned-koica.pdf')[0].get_text().strip()))"` → `0`.

- [ ] **Step 2: Build the installer** with the company variables on the command line only:
      `OPEN_GENOFFICE_LITELLM_URL=<address> OPEN_GENOFFICE_LITELLM_MODEL=deepseek-flash OPEN_GENOFFICE_WIN_SIDECAR_TARGET=x86_64-pc-windows-msvc LLM_WIKI_FORK_DIR=D:/llm_wiki_ubion/llm_wiki npm run dist:win`.
      Check `apps/shell/release/win-unpacked/resources/llm-wiki/tesseract/` has `tesseract.exe`, 26 DLLs, `tessdata/kor.traineddata`, `tessdata/eng.traineddata`, `LICENSE`, `SOURCE.txt`; record the installer size against 317 MB.

- [ ] **Step 3: Installed build without the PC's own OCR tools.** Run `scripts/drivers/driver.llm-wiki.mjs`-style steps against `win-unpacked\Open GenOffice.exe` with `--user-data-dir=<temp>`, a Hangul wiki folder, the LiteLLM test key, and an environment whose `PATH` drops every entry containing `Python` or `Tesseract-OCR` (and no `TESSERACT_DIR`), so only the bundled Tesseract can work. Add `scanned-koica.pdf` through Home → "add material"; wait (up to 15 minutes) for a `wiki/sources/*.md` page; check it contains Korean text from the RFP (for example `인도네시아` or `보건`). Delete everything the run created afterwards.
- [ ] **Step 4: Whole-suite check** — `cargo test --lib` in the fork; in Open GenOffice `npm run typecheck`, `npx vitest run apps/shell packages/work-wiki`, `npm run check:english-comments`, `npm run check:theme-colors`.
- [ ] **Step 5: Final review** by a fresh reviewer over both repositories' diffs; fix Critical/Important with a failing test first.
- [ ] **Step 6: Push** Open GenOffice to `private` (`HEAD:main` and `HEAD:migrate/upstream-2026-10`) and wait for CI to pass; the fork was pushed in Task 2.
