/**
 * The status line after a save that did not land. A cancel (the Save As dialog closed,
 * or the user kept the disk copy a sibling split-pane copy wrote) is quiet; a failure
 * says why.
 */
export function saveFailedStatus(result: { canceled?: boolean; error?: string }): string {
  return result.canceled ? '' : `Save failed: ${result.error ?? 'unknown error'}`
}
