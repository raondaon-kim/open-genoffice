import { test, expect, chromium } from '@playwright/test'
import { relayoutEditableHosts } from '../apps/sheets/src/renderer/editable-relayout'

// Sheets makes the whole app inert while a workbook opens. Chromium then lays the
// Univer cell editor's hidden input (an empty contenteditable) out as a 0px,
// non-editable box and keeps that layout after the inert ancestor is lifted:
// the input still holds focus and a caret, but typed characters go nowhere
// (no beforeinput/input, execCommand('insertText') is disabled). A view that was
// prewarmed before the open (the spare) shows exactly this — the recurring
// open-focus-typing failure. Real Chromium, because jsdom has no layout.
test('an editor input laid out under an inert ancestor is editable again after the relayout', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<main class="app-shell"><div id="univer-container"></div></main>')
    await page.addScriptTag({ content: `window.relayoutEditableHosts = ${relayoutEditableHosts}` })

    const broken = await page.evaluate(() => {
      const main = document.querySelector('main')!
      const host = document.getElementById('univer-container')!
      // the Univer input: an empty contenteditable named __editor_<unitId>
      const input = document.createElement('div')
      input.id = '__editor___INTERNAL_EDITOR__DOCS_NORMAL'
      input.contentEditable = 'true'
      input.style.cssText = 'position:absolute;overflow:hidden'
      host.appendChild(input)
      input.focus()
      main.inert = true // the opening guard
      // the workbook swap re-renders the grid area: the input's layout box is
      // rebuilt while the guard is on
      host.style.display = 'none'
      void input.offsetHeight
      host.style.display = ''
      void input.offsetHeight
      main.inert = false
      input.focus()
      return {
        height: input.getBoundingClientRect().height,
        canType: document.queryCommandEnabled('insertText'),
      }
    })
    // the Chromium behavior this guards against (if it ever changes, the fix is a no-op)
    expect(broken).toEqual({ height: 0, canType: false })

    const fixed = await page.evaluate(() => {
      const input = document.getElementById('__editor___INTERNAL_EDITOR__DOCS_NORMAL')!
      ;(
        window as unknown as { relayoutEditableHosts(root: ParentNode): void }
      ).relayoutEditableHosts(document)
      return {
        tall: input.getBoundingClientRect().height > 0,
        canType: document.queryCommandEnabled('insertText'),
        stillFocused: document.activeElement === input,
        typed: (document.execCommand('insertText', false, '4242'), input.textContent),
      }
    })
    expect(fixed).toEqual({ tall: true, canType: true, stillFocused: true, typed: '4242' })
  } finally {
    await browser.close()
  }
})
