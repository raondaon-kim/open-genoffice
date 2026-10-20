/** Files a user can add to the work wiki (Home's "업무 자료 추가" and the chat attachment button). */
export const WIKI_MATERIAL_EXTS = [
  'hwp',
  'hwpx',
  'docx',
  'pptx',
  'xlsx',
  'pdf',
  'md',
  'txt',
] as const

/** by extension, case-insensitive; a name without an extension is not material */
export function isWikiMaterial(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return false
  return (WIKI_MATERIAL_EXTS as readonly string[]).includes(name.slice(dot + 1).toLowerCase())
}

/** why a file was not added */
export type WikiMaterialSkip =
  'unsupported' | 'too-large' | 'no-text' | 'unreadable' | 'too-many' | 'wiki-off' | 'not-attached'

export interface WikiMaterialResult {
  path: string
  status: 'added' | 'duplicate' | 'skipped'
  reason?: WikiMaterialSkip
}

/** what an editor needs to offer "add to work material" */
export interface WikiMaterialApi {
  status(): Promise<{ enabled: boolean }>
  addMaterial(paths: string[]): Promise<WikiMaterialResult[]>
}
