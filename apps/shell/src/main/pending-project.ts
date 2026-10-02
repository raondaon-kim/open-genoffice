import { extname } from 'node:path'

/** which "new file from a project view" a saved file answers (key of pendingNewFileProject) */
export function pendingProjectKey(filePath: string): 'doc' | 'sheet' | 'slide' | 'hwp' | undefined {
  const ext = extname(filePath).slice(1).toLowerCase()
  if (ext === 'docx') return 'doc'
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'sheet'
  if (ext === 'pptx') return 'slide'
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp'
  return undefined
}
