/** Hangul has no AutoSave: every hwp:save comes from the user's Save / Save As */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const main = readFileSync(join(__dirname, '../src/main/hwp-main.ts'), 'utf8')

describe('Hangul saves report who saved', () => {
  it('onSaved carries the origin and hwp:save reports the user', () => {
    expect(main).toMatch(
      /onSaved\?: \(webContentsId: number, path: string, origin: 'user' \| 'auto' \| 'agent'\) => void/,
    )
    expect(main).toMatch(/runtime\.onSaved\?\.\(e\.sender\.id, path, 'user'\)/)
  })
})
