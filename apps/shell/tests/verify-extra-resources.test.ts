import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * electron-builder beforePack hook (build/verify-extra-resources.js): every
 * extraResources source for the platform being packaged must exist, because
 * electron-builder only warns about a missing source and would otherwise ship
 * an installer with the module silently absent.
 */

const require = createRequire(import.meta.url)
const { verifyExtraResources } = require('../build/verify-extra-resources.js') as {
  verifyExtraResources: (
    config: Record<string, unknown>,
    electronPlatformName: string,
    baseDir: string,
  ) => void
}

let baseDir = ''

function file(rel: string): void {
  const path = join(baseDir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'x')
}

function dir(rel: string): void {
  mkdirSync(join(baseDir, rel), { recursive: true })
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'open-genoffice-extra-resources-'))
})

afterEach(() => {
  rmSync(baseDir, { force: true, recursive: true })
  baseDir = ''
})

describe('verifyExtraResources', () => {
  it('accepts a configuration whose common and platform sources all exist', () => {
    file('build/NOTICES.txt')
    dir('../studio-out') // parent-relative sources resolve against baseDir too
    file('../studio-out/index.html')
    file('native/rhwp.exe')
    const config = {
      extraResources: [
        { from: 'build/NOTICES.txt', to: 'NOTICES.txt' },
        { from: '../studio-out', to: 'modules/hwp-studio' },
      ],
      win: { extraResources: [{ from: 'native/rhwp.exe', to: 'native/rhwp.exe' }] },
    }
    expect(() => verifyExtraResources(config, 'win32', baseDir)).not.toThrow()
  })

  it('rejects a missing source, naming the platform and the path', () => {
    file('build/NOTICES.txt')
    const config = {
      extraResources: [{ from: 'build/NOTICES.txt', to: 'NOTICES.txt' }],
      mac: { extraResources: [{ from: 'native/hwpforge-mcp', to: 'native/hwpforge-mcp' }] },
    }
    expect(() => verifyExtraResources(config, 'darwin', baseDir)).toThrow(
      /extraResources source missing for darwin[\s\S]*native\/hwpforge-mcp/,
    )
  })

  it('only checks the sources of the platform being packaged', () => {
    file('native/rhwp.exe')
    const config = {
      mac: { extraResources: [{ from: 'native/rhwp', to: 'native/rhwp' }] },
      win: { extraResources: [{ from: 'native/rhwp.exe', to: 'native/rhwp.exe' }] },
    }
    // packaging for Windows on a machine without the macOS binaries is fine
    expect(() => verifyExtraResources(config, 'win32', baseDir)).not.toThrow()
    expect(() => verifyExtraResources(config, 'darwin', baseDir)).toThrow(/native\/rhwp\b/)
  })

  it('rejects an empty directory source (a module or studio that was never built)', () => {
    dir('../hwp/dist/studio')
    const config = {
      extraResources: [{ from: '../hwp/dist/studio', to: 'modules/hwp-studio' }],
    }
    expect(() => verifyExtraResources(config, 'linux', baseDir)).toThrow(
      /\.\.\/hwp\/dist\/studio \(empty directory\)/,
    )
  })

  it('lists every missing source in one error', () => {
    const config = {
      extraResources: [
        { from: '../docs/out', to: 'modules/docs' },
        { from: '../sheets/out', to: 'modules/sheets' },
      ],
    }
    let message = ''
    try {
      verifyExtraResources(config, 'linux', baseDir)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('../docs/out')
    expect(message).toContain('../sheets/out')
  })

  it('leaves glob sources to electron-builder', () => {
    const config = {
      extraResources: ['build/*.txt', { from: 'out/**/*.map', to: 'maps' }],
    }
    expect(() => verifyExtraResources(config, 'linux', baseDir)).not.toThrow()
  })
})
