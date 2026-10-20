# Split view port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two documents side by side in one window, ported from IeumOffice (see spec).

**Architecture:** IeumOffice's split view: pure layout logic (`split-layout.ts`), two-pane state in
`TabManager`, shell wiring (menus, drop zones, roles, restore), a renderer divider, a pane-role
bridge each editor uses to collapse its AI panel when not focused, and a same-document save guard.

**Tech Stack:** Electron (WebContentsView), React 19, TypeScript, Vitest, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-20-split-view-design.md`

## Global Constraints

- `git cherry-pick -x` keeps IeumOffice authorship; conflicts resolve toward this app and keep
  only split-view parts of their side; anything under `apps/mindmap` is removed (`git rm`).
- No `'help'` tab kind and no mindmap in this app: their references are removed.
- Docs/comments English-only; renderer CSS tokens only; Prettier and lint clean.
- Known Windows-only failures (not regressions): shell `default-app`, `folder-tree`,
  `headless-export`, flaky `update-resume`; sheets `promote-file-atomically`.

## Review Focus

1. Cover tabs while split: HTML full screen, slide show, Home — the split hides and comes back.
2. Tear-off / detach / close of a pane tab while split; close prompts restore the arrangement.
3. Same-document copy: duplicate tab vs single-instance routing, open-documents and MCP lists.
4. Sheets save guard `'overwrite'` path vs the existing disk-change check (CSV, restore targets).
5. Launch restore with slow-opening kinds (slides pending queue) and missing files.

---

### Task 1: Foundations (contracts, memory, save-conflict, pane role, divider)

- [ ] Cherry-pick in order: `3e0a6fdf`, `d75bf7e7`, `e0e1fb87`, `2e96dfae`, `8b90811d`.
- [ ] Each: resolve (import lists, `tabs-api`, preload, `AppFrame`/`TabBar`), run the tests the
      commit brings (`split-memory`, `save-conflict`, `split-pane-role`, `split-renderer`).
- [ ] Typecheck shell, electron-utils, ui.

### Task 2: Save guards for PDF, Markdown, HTML, Sheets, Slides

- [ ] Cherry-pick `61c374de` (drop mindmap), `89b3301f`; run each app's `save-conflict` tests.

### Task 3: Two-pane state in TabManager

- [ ] Cherry-pick `bd625c0b`, `962e7bed`; remove `'help'`/mindmap references; use our
      `openHwpTab` signature; add `trackPaneFocus` to `openHwpFormTab`.
- [ ] Tests: `split-layout`, `split-state` (fix its `'help'` kind), `window-close-guard`.

### Task 4: Role wiring and shell wiring

- [ ] Cherry-pick `f35e02d7`, `66f333aa`, `a6e34906`; remove help/mindmap checks; keep our
      launch flow and constructor arguments.
- [ ] Tests: `split-wiring` (drop help/mindmap expectations), `split-pane-wiring`,
      `split-dock-role`, `save-serialization`.

### Task 5: Fixes and e2e

- [ ] Cherry-pick `84ced840` (e2e), then the applicable parts of `e7e90329` and `52bcdecd`
      (skip their Hangul save-flow, mindmap and docs we do not have).

### Task 6: Make the whole tree green

- [ ] Typecheck every workspace; lint; Prettier; shell, ui, electron-utils, docs, sheets, slides,
      pdf, markdown, html suites; fix leftovers in one commit.

### Task 7: Hangul (re-implemented)

- [ ] Tests first (modelled on IeumOffice `apps/hwp/tests/split-pane.test.ts` and
      `save-conflict.test.ts`): the dock collapses when the pane role is secondary and its rail asks
      for focus; `hwp:save` refuses an in-place write after another copy saved unless the user confirms.
- [ ] Preload bridge (`aiOfficeSplit`), `env.d.ts`, `useSplitPaneFocusPing()` in `App.tsx`,
      `HwpAiDock` role handling, `hwp:save` guard with per-view disk states, quiet cancel in the
      renderer.

### Task 8: Credits and built-app check

- [ ] README / MODIFICATIONS / ACKNOWLEDGMENTS credit IeumOffice's split view.
- [ ] Build; e2e `split-view.spec.ts`; driver: split right/down, divider, role follow, same-document
      copy + save prompt, relaunch restore, Home cover; screenshots light/dark.
