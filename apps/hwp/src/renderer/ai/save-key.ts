/** the save shortcut as this platform shows it: the assistant repeats whatever it is told, and
 *  "⌘S" on Windows sent users to a key they do not have */
export function saveKeyLabel(
  platform: string = typeof navigator === 'undefined' ? '' : navigator.platform,
): string {
  return /mac/i.test(platform) ? '⌘S' : 'Ctrl+S'
}

export const SAVE_KEY = saveKeyLabel()
