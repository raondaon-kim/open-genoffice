import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import { appForPath } from '../src/main/app-routing'
import { collectLaunchPaths } from '../src/main/launch-paths'
import { OPEN_LOCAL_EXTENSIONS } from '../src/renderer/src/open-local-extensions'

const require = createRequire(import.meta.url)
// packaging metadata only: no Electron download, no sidecar checks
const configModule = { exports: {} as ReturnType<typeof require> }
runInNewContext(readFileSync(resolve(import.meta.dirname, '../electron-builder.cjs'), 'utf8'), {
  module: configModule,
  __dirname: resolve(import.meta.dirname, '..'),
  process: { platform: 'linux', arch: 'x64', env: {} },
  require: (id: string) =>
    id === 'node:fs' ? { ...require(id), existsSync: () => true } : require(id),
})
interface Association {
  ext: string
  name: string
  icon?: string
}
const associations: Association[] = configModule.exports.fileAssociations
const buildDir = resolve(import.meta.dirname, '..', 'build')

describe('OS file associations', () => {
  it('register the Hangul formats, so a double-clicked .hwp/.hwpx opens in GenOffice', () => {
    for (const ext of ['hwp', 'hwpx']) {
      const entry = associations.find((a) => a.ext === ext)
      expect(entry, `.${ext} must be associated`).toBeDefined()
      expect(entry!.icon).toBe('hwp')
    }
  })

  it('only claim extensions an app opens when the OS hands the path over', () => {
    for (const { ext } of associations) {
      const path = `C:/x/file.${ext}`
      expect(appForPath(path), `.${ext} routes to an app`).toBeDefined()
      expect(
        collectLaunchPaths([path], undefined, () => true),
        `.${ext} launch`,
      ).toEqual([path])
    }
  })

  it('ship a document icon for every association on both platforms', () => {
    for (const { ext, icon } of associations) {
      expect(icon, `.${ext} has an icon`).toBeTruthy()
      expect(existsSync(resolve(buildDir, `${icon}.ico`)), `${icon}.ico`).toBe(true)
      expect(existsSync(resolve(buildDir, `${icon}.icns`)), `${icon}.icns`).toBe(true)
    }
  })
})

describe('home "Open Local File" card', () => {
  it('names at least one extension of every app the open dialog reaches', () => {
    const listed = OPEN_LOCAL_EXTENSIONS.split('/').map((s) => s.trim())
    const kinds = new Set(listed.map((ext) => appForPath(`C:/x/file${ext}`)))
    for (const kind of ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html', 'hwp']) {
      expect(kinds.has(kind as never), `card lists a ${kind} extension`).toBe(true)
    }
    expect(listed).toContain('.hwp')
    expect(listed).toContain('.hwpx')
  })
})
