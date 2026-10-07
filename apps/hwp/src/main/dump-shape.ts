import { open, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { RhwpResult } from '../shared/ai-contract'
import type { RunRhwpFn } from './rhwp-cli'

/**
 * `rhwp dump` for reading paragraph shapes. The engine reports a run's weight (bold) only
 * for HWP5: on an HWPX it prints bold=false even when the file marks the run bold. A
 * conversion to HWP5 keeps paragraphs, text, sizes, margins and spacing exactly and adds the
 * weight (checked on 1,508 paragraphs of 25 press releases, ~60 ms per document), so HWPX
 * files are dumped through a temporary conversion. Any failure falls back to the plain dump.
 */

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

async function isZip(file: string): Promise<boolean> {
  let handle
  try {
    handle = await open(file, 'r')
    const head = Buffer.alloc(4)
    const { bytesRead } = await handle.read(head, 0, 4, 0)
    return bytesRead === 4 && ZIP_MAGIC.every((byte, i) => head[i] === byte)
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}

export async function dumpForShape(
  run: RunRhwpFn,
  rhwpPath: string,
  file: string,
): Promise<RhwpResult> {
  const plain = () => run(rhwpPath, ['dump', file], { keepStdout: true })
  if (!(await isZip(file))) return plain()
  const converted = `${file}.shape-${randomUUID().slice(0, 8)}.hwp`
  try {
    const conversion = await run(rhwpPath, ['convert', file, converted])
    if (conversion.exitCode !== 0) return await plain()
    const dumped = await run(rhwpPath, ['dump', converted], { keepStdout: true })
    return dumped.exitCode === 0 ? dumped : await plain()
  } catch {
    return plain()
  } finally {
    // best effort: a temp file still held by antivirus or a killed child must not hide the dump
    await rm(converted, { force: true }).catch(() => undefined)
  }
}
