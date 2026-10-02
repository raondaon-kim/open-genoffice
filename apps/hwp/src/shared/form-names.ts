const baseName = (name: string): string => name.split(/[\\/]/).pop() ?? name

/** names for a document started from a form: the tab label and the Save As default */
export function formCopyNames(fileName: string): { tabName: string; saveName: string } {
  const base = baseName(fileName)
  const match = /^(.*?)(\.(?:hwp|hwpx))$/i.exec(base)
  const stem = match ? match[1]! : base
  const ext = match ? match[2]! : '.hwp'
  return { tabName: `${stem} (new)`, saveName: `${stem}_작성${ext}` }
}

/** a renderer-supplied Save As default: a bare .hwp/.hwpx file name, else untitled.hwp */
export function safeDefaultSaveName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return 'untitled.hwp'
  if (/[\\/:]/.test(value) || value.startsWith('.')) return 'untitled.hwp'
  return /\.(hwp|hwpx)$/i.test(value) ? value : 'untitled.hwp'
}
