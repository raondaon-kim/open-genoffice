import { basename } from 'node:path'

export const MAX_FORM_BYTES = 50 * 1024 * 1024

export interface FormFileDeps {
  stat(path: string): Promise<{ size: number }>
  readFile(path: string): Promise<Buffer>
}

export type FormFileResult =
  { ok: true; fileName: string; data: ArrayBuffer } | { ok: false; error: string }

/** read a user's form file for "New document from a form" (the tab gets the bytes, not the path) */
export async function loadFormFile(path: string, deps: FormFileDeps): Promise<FormFileResult> {
  const fileName = basename(path.replace(/\\/g, '/'))
  if (!/\.(hwp|hwpx)$/i.test(fileName)) {
    return { ok: false, error: 'Choose a Hangul form (.hwp or .hwpx).' }
  }
  try {
    const { size } = await deps.stat(path)
    if (size > MAX_FORM_BYTES) {
      return { ok: false, error: 'This form is larger than 50 MB and cannot be opened.' }
    }
    const buf = await deps.readFile(path)
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    return { ok: true, fileName, data }
  } catch {
    return { ok: false, error: 'The form could not be read.' }
  }
}
