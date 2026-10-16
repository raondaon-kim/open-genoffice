import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importClosure, peImports } from '../../../tools/lib/pe-imports.mjs'

const STAGED = join(__dirname, '..', 'build', 'tesseract')

describe('peImports', () => {
  it.runIf(process.platform === 'win32')('lists the DLLs a Windows program imports', () => {
    expect(peImports(readFileSync(process.execPath))).toContain('kernel32.dll')
  })

  it('refuses a file that is not a Windows program', () => {
    expect(() => peImports(Buffer.from('not a program'.padEnd(512, ' ')))).toThrow()
  })
})

describe('importClosure', () => {
  it.runIf(existsSync(join(STAGED, 'tesseract.exe')))(
    'follows the imports through the DLLs in the folder, never the system ones',
    () => {
      const reached = importClosure(STAGED, 'tesseract.exe')
      expect(reached.has('tesseract.exe')).toBe(true)
      expect(reached.has('libtesseract-5.dll')).toBe(true)
      expect(reached.has('libleptonica-6.dll')).toBe(true)
      expect(reached.has('kernel32.dll')).toBe(false)
      expect(reached.size).toBe(27)
    },
  )
})
