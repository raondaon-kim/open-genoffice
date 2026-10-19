/**
 * Rebuild the layout boxes of Univer's hidden editor inputs (the empty
 * contenteditables named `__editor_<unitId>` that receive every keystroke).
 *
 * The app is inert while a workbook opens. When the input's layout box is
 * rebuilt during that time (the workbook swap re-renders the grid), Chromium
 * lays it out as a 0px, non-editable box and keeps that layout after the inert
 * ancestor is lifted: the input still holds focus and a caret, but typed
 * characters go nowhere (no beforeinput/input; insertText is disabled). A view
 * prewarmed before the open (the Sheets spare) hits this, so typing into a
 * freshly opened workbook did nothing until something rebuilt the box.
 *
 * Toggling `display` forces a fresh layout box; focus is handed back to the
 * input that held it, because `display: none` blurs it.
 *
 * Self-contained (no imports, no outer references): the e2e injects its source
 * into a page.
 */
export function relayoutEditableHosts(root: ParentNode): void {
  const inputs = root.querySelectorAll<HTMLElement>('[id^="__editor_"][contenteditable="true"]')
  for (const input of Array.from(inputs)) {
    const hadFocus = input.ownerDocument.activeElement === input
    const display = input.style.display
    input.style.display = 'none'
    void input.offsetHeight
    input.style.display = display
    if (hadFocus) input.focus()
  }
}
