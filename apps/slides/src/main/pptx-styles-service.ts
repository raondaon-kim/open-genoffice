import { loadStylePages } from '@genoffice/doc-styles/node'
import type { PptxStyle } from '@genoffice/doc-styles'
import type { PptxStyleSummary } from '../shared/ipc'

/** the PowerPoint pages of the shared document-style wiki folder (spec §4.1) */

export function listPptxStyles(
  dir: string | undefined,
): { ok: true; styles: PptxStyleSummary[]; errors: string[] } | { ok: false; error: string } {
  if (!dir) return { ok: false, error: 'the style wiki is not available in this build' }
  const { pages, errors } = loadStylePages(dir)
  return {
    ok: true,
    styles: pages
      .filter((p) => p.style.format === 'pptx')
      .map((p) => ({
        id: p.style.id,
        title: p.style.title,
        draft: p.style.draft === true,
        evidence: p.style.evidence,
      })),
    errors,
  }
}

export function readPptxStyle(
  dir: string | undefined,
  id: unknown,
): { ok: true; style: PptxStyle; description: string } | { ok: false; error: string } {
  if (typeof id !== 'string' || !dir) return { ok: false, error: 'unknown style' }
  const page = loadStylePages(dir).pages.find((p) => p.style.id === id && p.style.format === 'pptx')
  if (!page) return { ok: false, error: `no PowerPoint style "${id}"` }
  return { ok: true, style: page.style as PptxStyle, description: page.description }
}
