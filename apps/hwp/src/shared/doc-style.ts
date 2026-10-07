/**
 * The Hangul document-style wiki pages: the types and the page reader live in the shared
 * @genoffice/doc-styles package (which also reads the Word and PowerPoint pages); this file keeps
 * the names the Hangul app has always imported.
 */
export { ALIGNMENTS, parseStylePage } from '@genoffice/doc-styles'
export type { DocStyle, SkeletonSlot, StyleAlign, StyleRole } from '@genoffice/doc-styles'
