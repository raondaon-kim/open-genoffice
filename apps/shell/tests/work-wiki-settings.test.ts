import { describe, expect, it } from 'vitest'
import { normalizeWorkWikiSettings, workWikiNeedsRestart } from '../src/main/work-wiki-settings'

describe('normalizeWorkWikiSettings', () => {
  it('defaults to on with the Documents folder', () => {
    expect(normalizeWorkWikiSettings(undefined, 'C:/Users/u/Documents/GenOffice 업무위키')).toEqual(
      {
        enabled: true,
        folder: 'C:/Users/u/Documents/GenOffice 업무위키',
        exclude: [],
        mirrorSaved: true,
        mirrorNoticeShown: false,
      },
    )
  })

  it('keeps valid values and drops junk', () => {
    // an absolute path on this platform (a drive path is not absolute on Linux or macOS)
    const root = process.platform === 'win32' ? 'D:' : ''
    expect(
      normalizeWorkWikiSettings(
        { enabled: false, folder: `  ${root}/share/wiki `, exclude: [`${root}/private`, 3, ''] },
        'X',
      ),
    ).toEqual({
      enabled: false,
      folder: `${root}/share/wiki`,
      exclude: [`${root}/private`],
      mirrorSaved: true,
      mirrorNoticeShown: false,
    })
    expect(normalizeWorkWikiSettings({ folder: 'relative/path' }, 'X').folder).toBe('X')
  })

  it('copies saved documents by default, and keeps a switched-off copy and the notice flag', () => {
    expect(normalizeWorkWikiSettings({}, 'X').mirrorSaved).toBe(true)
    expect(normalizeWorkWikiSettings({ mirrorSaved: 'no' }, 'X').mirrorSaved).toBe(true)
    expect(normalizeWorkWikiSettings({ mirrorSaved: false }, 'X').mirrorSaved).toBe(false)
    expect(normalizeWorkWikiSettings({ mirrorNoticeShown: true }, 'X').mirrorNoticeShown).toBe(true)
  })
})

describe('workWikiNeedsRestart', () => {
  const base = {
    enabled: true,
    folder: 'D:/wiki',
    exclude: [],
    mirrorSaved: true,
    mirrorNoticeShown: false,
  }
  it('the saved-copies switch and the notice flag are read live: no restart', () => {
    expect(workWikiNeedsRestart(base, { ...base, mirrorSaved: false })).toBe(false)
    expect(workWikiNeedsRestart(base, { ...base, mirrorNoticeShown: true })).toBe(false)
  })
  it('turning the wiki on or off, the folder and the exclude list restart the engine', () => {
    expect(workWikiNeedsRestart(base, { ...base, enabled: false })).toBe(true)
    expect(workWikiNeedsRestart(base, { ...base, folder: 'D:/other' })).toBe(true)
    expect(workWikiNeedsRestart(base, { ...base, exclude: ['D:/private'] })).toBe(true)
  })
})

describe('the settings handler', () => {
  it('restarts the engine only when workWikiNeedsRestart says so', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '../src/main/work-wiki.ts'), 'utf8')
    const body = src.slice(src.indexOf('HOME_CHANNELS.setWorkWikiSettings'))
    const handler = body.slice(0, body.indexOf('\n  })\n'))
    expect(handler).toMatch(/if \(workWikiNeedsRestart\(prev, next\)\) await restart\(\)/)
    expect(handler).not.toMatch(/^\s*await restart\(\)/m)
  })
})
