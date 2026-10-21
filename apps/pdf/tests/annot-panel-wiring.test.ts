/**
 * How the editor mounts the annotation list: a third left-sidebar view next to thumbnails
 * and outline, switched from the View tab, with clicks going to the place and flashing it.
 * Checked on the source, like the other wiring tests: App.tsx needs a running editor.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANNOT_PANEL_MIN_W } from '../src/renderer/view-config'

const app = readFileSync(join(__dirname, '../src/renderer/App.tsx'), 'utf8')

describe('annotation list wiring', () => {
  it('is a sidebar view next to thumbnails and outline', () => {
    expect(app).toMatch(/useState<'thumbs' \| 'outline' \| 'annots' \| null>\('thumbs'\)/)
  })

  it('has a View tab button that toggles it', () => {
    expect(app).toMatch(
      /onClick=\{\(\) => setSidebar\(\(v\) => \(v === 'annots' \? null : 'annots'\)\)\}/,
    )
    expect(app).toMatch(/aria-pressed=\{sidebar === 'annots'\}/)
  })

  it('mounts the panel host only while that view is shown', () => {
    expect(app).toMatch(/\{sidebar === 'annots' && \(\s*<AnnotPanelHost/)
  })

  it('offers document creation only where the shell provides it', () => {
    expect(app).toMatch(/window\.pdfApi\?\.createDocument\s*\?/)
  })

  it('keeps the sidebar resizer for the new view', () => {
    expect(app).toMatch(/sidebar === 'annots' \|\|/)
  })

  it('is never narrower than its filters need, whatever the thumbnail width', () => {
    expect(app).toMatch(/width=\{Math\.max\(sidebarW, ANNOT_PANEL_MIN_W\)\}/)
    expect(ANNOT_PANEL_MIN_W).toBeGreaterThanOrEqual(240)
  })

  it('flashes the clicked item on its page', () => {
    expect(app).toMatch(/<AnnotFlash target=\{annotFlash\}/)
  })
})
