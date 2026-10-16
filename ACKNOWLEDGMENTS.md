# Acknowledgments

Open GenOffice is an independent fork of
[GenOffice](https://github.com/genspark-ai/genoffice), created and published by
Mainfunc, Inc. under the Apache License 2.0.

We are grateful to Mainfunc and the GenOffice contributors for opening the
substantial foundation this fork builds on: the document, spreadsheet,
presentation, PDF, Markdown and HTML applications; the OOXML engines; the
rendering and round-trip fidelity work; the deck generation pipeline; and the
AI integration.

The Hangul module is built on [rhwp](https://github.com/edwardkim/rhwp) (MIT)
for reading, rendering and editing `.hwp`/`.hwpx` documents, and uses HwpForge
to generate new Hangul documents.

The work wiki ships [LLM Wiki](https://github.com/nashsu/llm_wiki) by nashsu (GPL-3.0,
Copyright (C) 2024-2026 Yong Su) as a separate program in `resources/llm-wiki/`, next to its
license text and `SOURCE.txt`, which names the exact source of the shipped build. The changes in
our fork are listed in its `MODIFICATIONS.md`.

The Codex connection mode ships the unmodified [Codex CLI](https://github.com/openai/codex) by
OpenAI (Apache-2.0) in `resources/codex/`, next to its license and `SOURCE.txt`.

Scanned PDFs are read with [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
(Apache-2.0), shipped unmodified from the UB-Mannheim Windows build with its Korean and English
trained data in `resources/llm-wiki/tesseract/`. The libraries it loads keep their own licenses:
`SOURCE.txt` there lists each with its source, the GPL and LGPL texts are in `licenses/`, and it
carries a written offer for the corresponding source of the GPL and LGPL libraries.

This fork is based on the upstream Git history and keeps its license, copyright
and NOTICE. Its goal is complementary: Hangul documents, an organization's
document-style wiki, and in-house model routing on top of upstream GenOffice.

Open GenOffice is not affiliated with or endorsed by Mainfunc or Genspark.
Questions and bug reports about this fork belong in the Open GenOffice
repository; upstream-only issues should be reported to the upstream project.
