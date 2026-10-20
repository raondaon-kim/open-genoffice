import { test, expect, chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// The attachment card's "add to work material" button keeps its state colour on hover once the
// file is added (or failed): a check that greys out and lights up on hover reads as clickable.
test('the added, duplicate and failed states keep their colour and no hover background', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(
      '<span class="ai-attachment-card" style="position:relative;display:flex;width:190px;height:56px">' +
        '<button class="ai-attachment-wiki-btn" data-state="idle">i</button></span>',
    )
    for (const path of ['packages/ui/src/tokens.css', 'packages/ui/src/attachment-wiki.css'])
      await page.addStyleTag({ content: await readFile(join(__dirname, '..', path), 'utf8') })
    const btn = page.locator('.ai-attachment-wiki-btn')
    const look = () =>
      btn.evaluate((el) => {
        const cs = getComputedStyle(el)
        return { color: cs.color, background: cs.backgroundColor }
      })
    const token = (name: string) =>
      page.evaluate((n) => {
        const probe = document.createElement('i')
        probe.style.color = `var(${n})`
        document.body.append(probe)
        const c = getComputedStyle(probe).color
        probe.remove()
        return c
      }, name)
    const brand = await token('--color-brand-secondary')
    const danger = await token('--danger')

    // idle still gets the hover feedback
    await btn.hover()
    expect((await look()).background).not.toBe('rgba(0, 0, 0, 0)')

    for (const [state, colour] of [
      ['added', brand],
      ['duplicate', brand],
      ['failed', danger],
    ] as const) {
      await page.mouse.move(0, 300)
      await btn.evaluate((el, s) => el.setAttribute('data-state', s), state)
      await btn.hover()
      // colours ease over --transition-fast: wait for the settled value, not a mid-way frame
      await expect.poll(async () => (await look()).color, { message: state }).toBe(colour)
      if (state !== 'failed')
        await expect
          .poll(async () => (await look()).background, { message: state })
          .toBe('rgba(0, 0, 0, 0)')
    }
  } finally {
    await browser.close()
  }
})
