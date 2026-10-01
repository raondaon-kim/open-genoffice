import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM build tool without type declarations
import { CODEX_ASSETS, CODEX_VERSION } from '../../../tools/codex-assets.mjs'

/**
 * tools/fetch-codex.mjs runs in CI (ubuntu-latest) and in packaging builds
 * (windows, macOS); every one of those platforms needs a pinned asset with
 * its SHA-256, or the fetch exits 1 before lint/typecheck/tests run.
 */
describe('pinned Codex app-server assets', () => {
  it.each(['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'])(
    'pins %s with a release asset and a SHA-256',
    (target) => {
      const asset = (CODEX_ASSETS as Record<string, { file: string; sha256: string; exe: string }>)[
        target
      ]
      expect(asset, `${target} is not pinned`).toBeDefined()
      expect(asset.file).toMatch(/^codex-app-server-[\w-]+\.(exe\.zip|tar\.gz)$/)
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(asset.exe).toBe(
        target.startsWith('win32') ? 'codex-app-server.exe' : 'codex-app-server',
      )
    },
  )

  it('pins the version the app was tested against', () => {
    expect(CODEX_VERSION).toBe('0.159.3')
  })
})

describe('release scripts', () => {
  it('fetch Codex before generating notices, so the installer carries its Apache-2.0 LICENSE', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const name of ['dist:win', 'dist:mac']) {
      const script = root.scripts[name]!
      const fetchAt = script.indexOf('npm run fetch:codex')
      expect(fetchAt, `${name} must run fetch:codex`).toBeGreaterThanOrEqual(0)
      expect(fetchAt).toBeLessThan(script.indexOf('npm run notices'))
    }
  })
})
