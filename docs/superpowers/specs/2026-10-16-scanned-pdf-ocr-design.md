# Scanned PDF text recognition in the installer

Status: design, approved in conversation 2026-10-16; this file awaits the user's review.

## Understanding

A scanned PDF (pages that are images, no text layer) added to the work wiki must be learned with
nothing but the Open GenOffice installer: no Python, OCRmyPDF, Ghostscript or Tesseract installed
by the user. Korean and English text must be recognized.

What the user said: everything scanned PDFs need goes into the installer; approach A (pdfium renders
the pages, a bundled Tesseract reads them).
Today: the LLM Wiki fork extracts PDF text with pdfium (bundled); when the text is sparse it tries
pymupdf (Python) and then OCRmyPDF (Python + Tesseract + Ghostscript), none of which the installer
carries.

## 1. LLM Wiki fork: the PDF path

1. pdfium extracts the text, as today.
2. When the existing sparse-text check says the PDF is scanned, the **bundled Tesseract** reads it:
   - pdfium renders each page to a PNG at about 300 dpi (the `image` feature pdfium-render already
     enables), into a temporary folder;
   - `tesseract.exe <page.png> stdout -l kor+eng --psm 3` runs per page, hidden (no console window),
     with `TESSDATA_PREFIX` pointing at the bundled `tessdata`;
   - the pages become `## Page N` sections, the same shape the text path returns, so ingest needs no
     change;
   - limits: at most 200 pages, 120 s per page; a page that fails or times out is skipped and named
     in the log; the temporary folder is removed at the end.
3. Only when no bundled Tesseract is found does the old path (pymupdf, then OCRmyPDF) run, so the
   fork still works as a standalone program on a machine that has those tools.

Where Tesseract is found: `LLM_WIKI_TESSERACT_DIR` when set, else `<folder of llm-wiki.exe>/tesseract`.
It counts as present when `tesseract.exe` and `tessdata/kor.traineddata` exist there.

## 2. Installer

- New `tools/fetch-tesseract.mjs` with `tools/tesseract.pin.json`:
  - downloads the pinned UB-Mannheim Windows build
    (`tesseract-ocr-w64-setup-5.4.0.20240606.exe`, sha256
    `c885fff6998e0608ba4bb8ab51436e1c6775c2bafc2559a19b423e18678b60c9`) and checks the hash;
  - unpacks it with 7-Zip (`7z.exe` from `SEVENZIP` or `C:\Program Files\7-Zip`) and keeps only
    `tesseract.exe` and the DLLs it loads (27 files, found by walking the PE import tables from
    `tesseract.exe` and checked against the pinned list);
  - downloads the trained data and checks each hash: `kor` from tessdata_best 4.1.0 (sha256
    `f888d4038348a0c3d25151e7f452bda0d74ca275b18cab146798bcbb94084fff`, 12.5 MB) and `eng` from
    tessdata_fast 4.1.0 (sha256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`,
    4.1 MB);
  - stages `apps/shell/build/tesseract/` with the binaries, `tessdata/`, the Tesseract `LICENSE`, and
    a `SOURCE.txt` naming the build, the trained data and the libraries with their licenses.
- `electron-builder.cjs` ships it as `resources/llm-wiki/tesseract/`; a Windows x64 build fails
  without it, like LLM Wiki and Codex. `dist:win` runs the fetch first.
- Expected growth: about 50–60 MB compressed (121 MB of binaries plus 17 MB of data before
  compression); measured at build time and reported.
- GenOffice passes nothing new: LLM Wiki finds the folder next to itself.

## 3. Licenses

- Tesseract and the trained data: Apache-2.0.
- Libraries loaded by `tesseract.exe` (from the MSYS2 packages UB-Mannheim builds with): mostly
  BSD/MIT-style (leptonica, libpng, libtiff, libjpeg, libwebp, openjp2, zlib, zstd, lz4, xz,
  libdeflate, expat, libarchive, OpenSSL under Apache-2.0); `libiconv` is LGPL-2.1 and `libjbig`
  (JBIG-KIT) is GPL-2.0; `libstdc++`, `libgcc` carry the GCC runtime exception.
- They ship unmodified as part of a separate program; `SOURCE.txt` names each library, its license
  and where its source is, and `ACKNOWLEDGMENTS.md` and `MODIFICATIONS.md` mention the bundle.

## 4. Errors

- No bundled Tesseract and no old tools: the PDF is skipped with the existing "could not read"
  log line; other files still learn.
- Tesseract fails on one page: that page is skipped, the rest are kept.
- A PDF with a text layer never runs OCR (the sparse-text check decides, as today).

## 5. Testing

- Fork, Rust unit tests: finding Tesseract (env var, next to the exe, missing data file), the command
  line (language, hidden window, `TESSDATA_PREFIX`), assembling page text, the page limit.
- Fork, an integration test that OCRs a small image-only PDF with the real bundled Tesseract when
  `LLM_WIKI_TESSERACT_DIR` is set (skipped otherwise).
- GenOffice: the fetch script (hash mismatch refused, file list check) and the installer contents.
- Acceptance on this PC with the existing Tesseract and Python taken off PATH: an image-only PDF
  made from the KOICA RFP pages, added through Home → "add material", becomes a `wiki/sources` page
  with Korean text, in the installed build.

## Out of scope

Layout-preserving OCR (tables, columns), languages other than Korean and English, OCR of images
inside Word or PowerPoint files, macOS/Linux.
