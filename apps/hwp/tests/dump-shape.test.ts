/** @vitest-environment node */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dumpForShape } from '../src/main/dump-shape'
import type { RunRhwpFn } from '../src/main/rhwp-cli'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dump-shape-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const hwpx = () => {
  const p = join(dir, 'doc.hwpx')
  writeFileSync(p, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))
  return p
}
const hwp5 = () => {
  const p = join(dir, 'doc.hwp')
  writeFileSync(p, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))
  return p
}

/** convert writes its output; dump answers with the name of the file it was asked to read */
function fake(opts: { convertExit?: number; dumpExitFor?: (file: string) => number } = {}) {
  const calls: string[][] = []
  const run: RunRhwpFn = async (_bin, args) => {
    calls.push([...args])
    if (args[0] === 'convert') {
      if ((opts.convertExit ?? 0) === 0) writeFileSync(args[2]!, 'HWP5')
      return { exitCode: (opts.convertExit ?? 0) as 0, envelope: null, stderr: '' }
    }
    const file = args[1]!
    return {
      exitCode: (opts.dumpExitFor?.(file) ?? 0) as 0,
      envelope: null,
      stderr: '',
      stdout: `DUMP-OF ${file}`,
    }
  }
  return { run, calls }
}

describe('dumpForShape', () => {
  it('dumps an HWP5 file as it is', async () => {
    const f = fake()
    const file = hwp5()
    const result = await dumpForShape(f.run, 'rhwp', file)
    expect(f.calls).toEqual([['dump', file]])
    expect(result.stdout).toBe(`DUMP-OF ${file}`)
  })

  it('converts an HWPX file to HWP5 first (the engine reports bold only for HWP5) and cleans up', async () => {
    const f = fake()
    const file = hwpx()
    const result = await dumpForShape(f.run, 'rhwp', file)
    expect(f.calls[0]![0]).toBe('convert')
    expect(f.calls[0]![1]).toBe(file)
    const converted = f.calls[0]![2]!
    expect(converted).not.toBe(file)
    expect(f.calls[1]).toEqual(['dump', converted])
    expect(result.stdout).toBe(`DUMP-OF ${converted}`)
    expect(existsSync(converted)).toBe(false)
    expect(readdirSync(dir)).toEqual(['doc.hwpx'])
  })

  it('falls back to the original file when the conversion fails', async () => {
    const f = fake({ convertExit: 1 })
    const file = hwpx()
    const result = await dumpForShape(f.run, 'rhwp', file)
    expect(f.calls.map((c) => c[0])).toEqual(['convert', 'dump'])
    expect(f.calls[1]).toEqual(['dump', file])
    expect(result.stdout).toBe(`DUMP-OF ${file}`)
  })

  it('falls back when the converted file cannot be dumped', async () => {
    const f = fake({ dumpExitFor: (file) => (file.endsWith('.hwp') ? 1 : 0) })
    const file = hwpx()
    const result = await dumpForShape(f.run, 'rhwp', file)
    expect(f.calls.map((c) => c[0])).toEqual(['convert', 'dump', 'dump'])
    expect(result.stdout).toBe(`DUMP-OF ${file}`)
    expect(readdirSync(dir)).toEqual(['doc.hwpx'])
  })

  it('dumps a file that is missing or unreadable as it is (the engine reports the error)', async () => {
    const f = fake()
    const file = join(dir, 'missing.hwpx')
    await dumpForShape(f.run, 'rhwp', file)
    expect(f.calls).toEqual([['dump', file]])
  })
})
