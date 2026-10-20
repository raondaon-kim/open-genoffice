import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleWikiMaterialRequest } from '../src/main/wiki-material-request'

const ctx = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wmr-'))
  const file = join(dir, 'rfp.pdf')
  writeFileSync(file, 'PDF')
  return {
    dir,
    file,
    base: {
      enabled: true,
      rawSources: join(dir, 'raw', 'sources'),
      indexPath: join(dir, 'state', 'material-index.json'),
      extractText: async () => null,
      gate: () => null as boolean | null,
    },
  }
}

describe('wiki:add-material', () => {
  it('adds an attached file to raw/sources', async () => {
    const { file, base } = ctx()
    expect(await handleWikiMaterialRequest([file], base)).toEqual([{ path: file, status: 'added' }])
    expect(existsSync(join(base.rawSources, 'rfp.pdf'))).toBe(true)
  })

  it('reports wiki-off for every path and copies nothing when the wiki is off', async () => {
    const { file, base } = ctx()
    expect(await handleWikiMaterialRequest([file], { ...base, enabled: false })).toEqual([
      { path: file, status: 'skipped', reason: 'wiki-off' },
    ])
    expect(existsSync(base.rawSources)).toBe(false)
  })

  it('refuses a Hangul view’s path it never attached, keeps order with the others', async () => {
    const { dir, file, base } = ctx()
    const other = join(dir, 'b.md')
    writeFileSync(other, 'B')
    const r = await handleWikiMaterialRequest([file, other], {
      ...base,
      gate: (p) => p === other,
    })
    expect(r).toEqual([
      { path: file, status: 'skipped', reason: 'not-attached' },
      { path: other, status: 'added' },
    ])
    expect(existsSync(join(base.rawSources, 'rfp.pdf'))).toBe(false)
  })

  it('rejects malformed requests outright', async () => {
    const { file, base } = ctx()
    for (const bad of [
      null,
      'x',
      [1],
      [''],
      ['relative/a.pdf'],
      Array(51).fill(file),
      ['C:/' + 'a'.repeat(5000)],
    ]) {
      expect(await handleWikiMaterialRequest(bad, base)).toEqual([])
    }
  })
})
