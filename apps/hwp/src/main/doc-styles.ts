import { exportStylePages, loadStylePages } from '@genoffice/doc-styles/node'
import type { DocStyle } from '../shared/doc-style'

/** the bundled document-style wiki (spec §4.1, §4.5): the Hangul app reads the Hangul pages of the shared folder */

export interface DocStylePage {
  style: DocStyle
  description: string
  file: string
}

export function loadDocStyles(dir: string): { pages: DocStylePage[]; errors: string[] } {
  const { pages, errors } = loadStylePages(dir)
  return {
    pages: pages
      .filter((p) => p.style.format === 'hwp')
      .map((p) => ({ style: p.style as DocStyle, description: p.description, file: p.file })),
    errors,
  }
}

export { EXPORT_FOLDER } from '@genoffice/doc-styles/node'

/** copy the markdown pages (every format) to <targetParent>/genoffice-doc-styles; never overwrites unless asked */
export const exportDocStyles = exportStylePages
