import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupBeforeOverwrite, backupPathFor, bytesMatchPath } from '../src/main/save-guard'

const OLE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0])
const tmp = () => mkdtempSync(join(tmpdir(), 'hwp-save-'))

describe('bytesMatchPath', () => {
  it('accepts a compound file for .hwp and a zip for .hwpx', () => {
    expect(bytesMatchPath(OLE, 'D:/a/문서.hwp')).toBe(true)
    expect(bytesMatchPath(ZIP, 'D:/a/문서.HWPX')).toBe(true)
  })

  it('refuses bytes of the other format and anything too short', () => {
    expect(bytesMatchPath(ZIP, 'D:/a/문서.hwp')).toBe(false)
    expect(bytesMatchPath(OLE, 'D:/a/문서.hwpx')).toBe(false)
    expect(bytesMatchPath(OLE.subarray(0, 4), 'D:/a/문서.hwp')).toBe(false)
  })

  it('has no opinion about other extensions', () => {
    expect(bytesMatchPath(new Uint8Array([1, 2, 3]), 'D:/a/notes.txt')).toBe(true)
  })
})

describe('backupBeforeOverwrite', () => {
  it('copies an existing file to <name>.bak once per session', async () => {
    const dir = tmp()
    const target = join(dir, '제안서.hwp')
    writeFileSync(target, 'original')
    const written = new Set<string>()

    const first = await backupBeforeOverwrite(target, written)
    expect(first).toBe(backupPathFor(target))
    expect(readFileSync(`${target}.bak`, 'utf8')).toBe('original')

    // the app's own earlier save is not the user's original: no second backup
    writeFileSync(target, 'saved by the app')
    const second = await backupBeforeOverwrite(target, written)
    expect(second).toBeUndefined()
    expect(readFileSync(`${target}.bak`, 'utf8')).toBe('original')
  })

  it('makes no backup for a file that does not exist yet', async () => {
    const dir = tmp()
    const target = join(dir, 'new.hwpx')
    expect(await backupBeforeOverwrite(target, new Set())).toBeUndefined()
    expect(existsSync(`${target}.bak`)).toBe(false)
  })

  it('a backup that cannot be made fails the save instead of losing the original', async () => {
    const dir = tmp()
    const target = join(dir, 'a.hwp')
    writeFileSync(target, 'original')
    // a directory where the .bak file would go
    const { mkdirSync } = await import('node:fs')
    mkdirSync(`${target}.bak`)
    await expect(backupBeforeOverwrite(target, new Set())).rejects.toThrow()
  })

  it('a failed backup is tried again on the next save, never skipped', async () => {
    const dir = tmp()
    const target = join(dir, 'a.hwp')
    writeFileSync(target, 'original')
    const written = new Set<string>()
    const { mkdirSync, rmSync } = await import('node:fs')
    mkdirSync(`${target}.bak`)
    await expect(backupBeforeOverwrite(target, written)).rejects.toThrow()
    rmSync(`${target}.bak`, { recursive: true })
    // the user fixed the problem and saves again: the original is still unbacked-up
    expect(await backupBeforeOverwrite(target, written)).toBe(`${target}.bak`)
    expect(readFileSync(`${target}.bak`, 'utf8')).toBe('original')
  })
})
