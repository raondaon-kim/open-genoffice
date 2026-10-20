// A split-view copy of a workbook is a second view of the same path: opening it must not
// offer (and on "discard" delete) the crash-recovery copy of the view that holds it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '../src/main/sheets-main.ts'), 'utf8')

describe('sheets recovery with split-view copies', () => {
  it('skips the recovery offer when another sheets view already has the workbook open', () => {
    expect(source).toMatch(
      /options\?\.skipRecoveryPrompt \|\| sheetsPathOpenInOtherView\(contents, path\)\s*\?\s*undefined\s*:\s*pendingRecoveryFor\(path\)/,
    )
  })

  it('looks at the sessions of the other sheets views', () => {
    expect(source).toMatch(/function sheetsPathOpenInOtherView\(/)
    expect(source).toMatch(/pathOpenInOtherView\(/)
  })
})
