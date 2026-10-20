import { resolve } from 'node:path'

const canonical = (path: string): string => {
  const full = resolve(path)
  return process.platform === 'win32' ? full.toLowerCase() : full
}

/**
 * Whether a view other than `wcId` holds `path` (one entry per view: its open file).
 * A split-view copy of a document is a second view of the same path; things owned by
 * the document rather than the view, such as its crash-recovery copy, stay with the
 * view that opened it first.
 */
export function pathOpenInOtherView(
  openPathByView: Iterable<[number, string]>,
  wcId: number,
  path: string,
): boolean {
  const wanted = canonical(path)
  for (const [id, open] of openPathByView)
    if (id !== wcId && canonical(open) === wanted) return true
  return false
}
