import { loadStylePages } from '@genoffice/doc-styles/node'
import type { DocxStyle } from '@genoffice/doc-styles'
import type { DocStyleSummary } from '../shared/ipc'

/** the Word pages of the shared document-style wiki folder (spec §4.1) */

export function listDocxStyles(
  dir: string | undefined,
): { ok: true; styles: DocStyleSummary[]; errors: string[] } | { ok: false; error: string } {
  if (!dir) return { ok: false, error: 'the style wiki is not available in this build' }
  const { pages, errors } = loadStylePages(dir)
  return {
    ok: true,
    styles: pages
      .filter((p) => p.style.format === 'docx')
      .map((p) => ({
        id: p.style.id,
        title: p.style.title,
        draft: p.style.draft === true,
        evidence: p.style.evidence,
      })),
    errors,
  }
}

export function readDocxStyle(
  dir: string | undefined,
  id: unknown,
): { ok: true; style: DocxStyle; description: string } | { ok: false; error: string } {
  if (typeof id !== 'string' || !dir) return { ok: false, error: 'unknown style' }
  const page = loadStylePages(dir).pages.find((p) => p.style.id === id && p.style.format === 'docx')
  if (!page) return { ok: false, error: `no Word style "${id}"` }
  return { ok: true, style: page.style as DocxStyle, description: page.description }
}
