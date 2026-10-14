import { describe, expect, it } from 'vitest'
import { normalizeWorkWikiSettings } from '../src/main/work-wiki-settings'

describe('normalizeWorkWikiSettings', () => {
  it('defaults to on with the Documents folder', () => {
    expect(normalizeWorkWikiSettings(undefined, 'C:/Users/u/Documents/GenOffice 업무위키')).toEqual(
      {
        enabled: true,
        folder: 'C:/Users/u/Documents/GenOffice 업무위키',
        exclude: [],
      },
    )
  })

  it('keeps valid values and drops junk', () => {
    expect(
      normalizeWorkWikiSettings(
        { enabled: false, folder: '  D:/share/wiki ', exclude: ['D:/private', 3, ''] },
        'X',
      ),
    ).toEqual({ enabled: false, folder: 'D:/share/wiki', exclude: ['D:/private'] })
    expect(normalizeWorkWikiSettings({ folder: 'relative/path' }, 'X').folder).toBe('X')
  })
})
