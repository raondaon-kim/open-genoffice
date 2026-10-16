import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/**
 * The bytes a save is about to write must be the format the file name says: an .hwp is a
 * compound file, an .hwpx a zip. Other extensions are not judged.
 */
export function bytesMatchPath(bytes: Uint8Array, path: string): boolean {
  const magic = /\.hwp$/i.test(path) ? OLE_MAGIC : /\.hwpx$/i.test(path) ? ZIP_MAGIC : null
  if (!magic) return true
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b)
}

export const backupPathFor = (path: string): string => `${path}.bak`

/**
 * Keep the user's original before the app overwrites it: the first overwrite of an existing
 * file in a session copies it to `<name>.bak`. Later saves of the same file are the app's own
 * writes, so they leave that backup alone. Returns the backup path when one was made.
 * A backup that cannot be made throws: the original must not be replaced without it.
 */
export async function backupBeforeOverwrite(
  target: string,
  written: Set<string>,
): Promise<string | undefined> {
  const key = target.replace(/\\/g, '/').toLowerCase()
  if (written.has(key)) return undefined
  if (!existsSync(target)) {
    // the app creates the file now; its later saves are its own writes
    written.add(key)
    return undefined
  }
  const backup = backupPathFor(target)
  await copyFile(target, backup)
  // marked only after the copy worked: a failed backup is tried again on the next save
  written.add(key)
  return backup
}
