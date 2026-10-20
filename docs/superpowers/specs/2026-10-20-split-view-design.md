# Split view (two documents side by side) — port from IeumOffice

## Goal

Show two documents at once in one window: split right or down, drag the divider, keep one AI
panel (the focused pane's), restore the arrangement on the next launch, and guard saves when the
same file is open in both panes. Ported from IeumOffice (pblsketch/openoffice, Apache-2.0, a fork
of the same upstream); its design record is `docs/tracking/decisions/0037-split-view.md` there.

## Behaviour (as IeumOffice 0037)

- Split by dragging a tab to the right or bottom edge of the window, or from the tab context menu
  (Split Right, Split Down, Unsplit). The dragged tab goes where it was dropped; the other pane
  keeps the document seen just before. With only one document open, the same document is opened a
  second time (an unsaved document gets a blank document of the same kind).
- The divider changes the ratio; double-click → 50/50; dragging to an end closes that pane (the
  document stays as a tab).
- Only one AI panel shows: the focused pane's. The other collapses to its rail; clicking a pane
  (or its rail) moves the focus. Collapsed panels keep their chat and running work.
- Saving the same file from the second copy after the first saved asks "this document changed
  elsewhere"; auto-save defers quietly. Copies are not live-synced.
- Launching without a file restores the last split; launching with a file opens only that file.
  Home and presentation tabs cannot be panes; showing them hides the split until a document tab
  is shown again.
- Out of scope (as in 0037): three or more panes, live sync of copies, split inside a detached
  window.

## Porting approach

Cherry-pick IeumOffice's split-view commits in order with `-x` (authorship kept), resolving
conflicts toward this app; drop their mindmap and help-tab parts (we have neither); re-implement
the Hangul part (our Hangul editor is different code). Commits, in order:

3e0a6fdf (contracts), d75bf7e7 (split memory), e0e1fb87 (save-conflict), 2e96dfae (pane role),
8b90811d (divider, hints, markers), 61c374de (save guard pdf/markdown/html), 89b3301f (save guard
sheets/slides), bd625c0b (two-pane state in TabManager), 962e7bed (review fixes), f35e02d7 (role
wiring pdf/markdown/html), 66f333aa (shell wiring), a6e34906 (role wiring docs/sheets/slides),
84ced840 (e2e), e7e90329 and 52bcdecd (fixes; only the parts for code we have).

Skipped: 4c994ba8 (help topics), 28b7ecbf and 535c76f6 (their Hangul), ccbb5fa1, 18487870,
9cbdaa5b, d6f219bf (docs and tests we do not have).

## Adaptations

- Remove `'help'` tab-kind checks and `mindmap` cases (types we do not have).
- Hangul: preload exposes the split bridge; `useSplitPaneFocusPing()` at the root; `HwpAiDock`
  uses `useSplitPaneRole` / `effectiveAiPanelOpen` / `onAiRailClick`; `hwp:save` records the disk
  state per view and calls `confirmOverwriteIfConflicted` before writing; the renderer treats the
  refusal as a quiet cancel. Tests modelled on IeumOffice's.
- Credit IeumOffice in README / MODIFICATIONS / ACKNOWLEDGMENTS.

## Testing

IeumOffice's tests come with the commits (split layout/state/memory/renderer/wiring, save-conflict,
pane role, per-editor save-conflict and dock-role tests, e2e `split-view.spec.ts`); Hangul tests
are written for our editor. Built-app check: split right/down, divider, role follow, same-document
copy and save prompt, relaunch restore, Home cover; light and dark.
