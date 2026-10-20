// A split-view copy of a document is a second view of the same path: opening it must not
// offer (and on "discard" delete) the first view's crash-recovery copy, and closing one
// copy must not sweep the recovery copy the other copy still writes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '../src/main/docs-main.ts'), 'utf8')

describe('docs recovery with split-view copies', () => {
  it('skips the recovery offer when another view already has the document open', () => {
    expect(source).toMatch(
      /pathOpenInOtherView\(openDocByWc, wcId, filePath\)\s*\?\s*\{ bytes: plainBytes, recovered: false \}\s*:\s*await maybeRecoverDocBytes\(filePath, plainBytes\)/,
    )
  })

  it('keeps the recovery copy of a path another view still holds when a view closes', () => {
    expect(source).toMatch(
      /if \(!pathOpenInOtherView\(openDocByWc, contents\.id, p\)\) clearRecoveryCopy\(p\)/,
    )
  })
})
