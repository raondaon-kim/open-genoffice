# Move Open GenOffice onto the latest upstream

Date: 2026-10-07. Branch: `migrate/upstream-2026-10` (worktree `D:/genoffice-next`), created from
upstream `genspark-ai/genoffice` main `2490e20d`.

## Why

The fork started from upstream `4da673d4` (2026-08-02) and has taken upstream changes only by
hand since. Upstream is now 874 commits ahead (3,890 files differ). It has since added much of what
the fork added on its own (bring-your-own-key providers including DeepSeek and a custom
OpenAI-compatible endpoint, a Codex app-server bridge, thinking display, encrypted keys), plus
things the fork lacks: local deck generation without a Genspark login (page spec → pptx), a design
guide and layout skeletons, per-page visual/geometry QC, measured text boxes, `pptx-ops`,
`pipelines`, agent-loop guards, and the Markdown and HTML apps.

Instead of porting those into the fork, the new base is upstream main, and only the fork features
upstream lacks are re-applied on top of it.

## What is re-applied

| Area                | Source in the fork (`D:/genoffice`, branch `feat/hwp-template-roles`)                                                                                                    | Notes                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity            | appId, product name, icons, update feed, README/NOTICE/MODIFICATIONS                                                                                                     | so the build installs beside upstream's GenOffice, not over it                                                                                                                                 |
| Hangul module       | `apps/hwp`, `tools/build-hwp-studio.mjs`, `tools/fetch-rhwp-cli.mjs`, `tools/hwp-studio`, shell tab/Home/form-open, packaging (`modules/hwp*`, `native/rhwp*`, HwpForge) | AI panel adapted to upstream's agent-core / ai-provider / ui APIs; renderer dev port 5179 (5177/5178 are markdown/html upstream)                                                               |
| Document-style wiki | `packages/doc-styles`, `apps/hwp/resources/doc-styles`, docs `styles-skill.ts`, slides `styles-skill.ts`, docx-engine explicit-zero spacing                              | docs tool fixes from the 2026-10-07 review; the slides side goes through upstream's local deck generation (wiki = style guide + layout skeleton) instead of the fork's per-element IPC builder |
| Provider gaps       | filled in from the fork-vs-upstream comparison                                                                                                                           | only what upstream lacks; DeepSeek seed key for test builds; LiteLLM preset (custom endpoint as the default) for the in-house rollout                                                          |
| Drivers             | `scripts/drivers/*` (gitignored)                                                                                                                                         | Playwright drivers used for acceptance runs                                                                                                                                                    |

### Provider decisions (from the fork-vs-upstream comparison)

| Fork feature                                                                    | Upstream                                        | Decision                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenRouter / Anthropic / OpenAI / DeepSeek / GLM / Kimi / MiniMax routes        | has them (plus ~15 more and a custom endpoint)  | drop, use upstream                                                                                                                                                             |
| DeepSeek V4 names, thinking mode                                                | has them                                        | drop                                                                                                                                                                           |
| Encrypted provider keys (`safeStorage`)                                         | keys are plaintext in `ai-settings.json`        | **port** around upstream's settings read/write (docs, sheets, slides handlers, `ai-search` media tools)                                                                        |
| LiteLLM preset (new)                                                            | custom provider exists, one slot                | **add** a dedicated `litellm` provider id (fixed in-house base URL), default provider for new installs; the per-user virtual key is entered in Settings or seeded on first run |
| Seed key for test builds                                                        | none                                            | adapt to seed the LiteLLM / DeepSeek key                                                                                                                                       |
| Codex bundled app-server, sign-in card, Codex as default                        | bridge only, uses an installed `codex`          | not ported now: the in-house rollout uses LiteLLM only                                                                                                                         |
| Per-document model picker, global default route, catalog, cross-model switching | settings-wide model choice                      | not ported: upstream's single choice in Settings; with LiteLLM the model list is managed centrally                                                                             |
| Thinking box + reasoning persistence                                            | `'reasoning'` chunks, no UI                     | later, optional                                                                                                                                                                |
| JSON error-message extraction (`http-error.ts`)                                 | partial                                         | port (small)                                                                                                                                                                   |
| docx `spaceBefore = 0` on save                                                  | parse/convert/render fixed, save still drops it | port the one-line fix                                                                                                                                                          |
| Identity (appId, product name, icons, update feed, download page)               | `com.genoffice.app`                             | port by hand onto upstream's packaging                                                                                                                                         |

Dropped: fork changes upstream now covers (format-changed via Node, beforePack resource check).

## Order

1. Baseline: `npm ci`, `build:all`, typecheck, lint, tests on pure upstream; record pre-existing
   failures so later failures can be told apart.
2. Identity (small, touches packaging that later steps also touch).
3. Hangul module: copy the app, wire the shell tab, packaging, build tools; adapt the AI panel;
   tests (unit, real rhwp contract tests), then a driver run.
4. Document-style wiki: package, Hangul tools (already inside the app), Word tool with the review
   fixes, slides through local deck generation; then the PPT design work on upstream's design rules.
5. Provider gaps and the LiteLLM preset.
6. Gates, Windows installer, install to `D:\Programs\Open GenOffice`, acceptance scenarios
   (Hangul form fill, styled Hangul/Word/PowerPoint documents, upstream deck generation).
7. Docs: README, MODIFICATIONS (rebased record), NOTICE kept with upstream's copyright.

Each step is committed on its own with tests passing before the next starts. The old fork branch
stays untouched as the reference and for comparison builds.

## Licence

Upstream is Apache-2.0 with `NOTICE` "Copyright 2026 Mainfunc, Inc.". The fork keeps both, marks
its own changes in MODIFICATIONS.md, and the Hangul module keeps rhwp's MIT notice.
