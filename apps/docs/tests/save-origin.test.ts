/**
 * The shell collects only the saves the user starts. Word's main process has no handler-level
 * test harness, so this pins the origin each save path reports by reading the sources.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const main = readFileSync(join(__dirname, '../src/main/docs-main.ts'), 'utf8')
const preload = readFileSync(join(__dirname, '../src/preload/index.ts'), 'utf8')
const actions = readFileSync(join(__dirname, '../src/renderer/file-actions.ts'), 'utf8')

function handler(channel: string): string {
  const start = main.indexOf(`'${channel}'`)
  expect(start, channel).toBeGreaterThan(0)
  const next = main.indexOf('ipcMain.handle(', start)
  return main.slice(start, next < 0 ? undefined : next)
}

describe('Word saves report who saved', () => {
  it('the hook carries the origin', () => {
    expect(main).toMatch(/export type SaveOrigin = 'user' \| 'auto' \| 'agent'/)
    expect(main).toMatch(
      /setDocsDocumentSavedHook\(\s*fn: \(\(filePath: string, origin: SaveOrigin\) => void\) \| null/,
    )
  })

  it('docs:save is auto for the AutoSave pass and user otherwise', () => {
    expect(handler('docs:save')).toMatch(
      /notifyDocumentSaved\(filePath, auto === true \? 'auto' : 'user'\)/,
    )
  })

  it('docs:save-as is the user', () => {
    expect(handler('docs:save-as')).toMatch(/notifyDocumentSaved\(result\.filePath, 'user'\)/)
  })

  it('docs:save-new takes the flag from the renderer and is auto when it is missing', () => {
    const h = handler('docs:save-new')
    expect(h).toMatch(/auto\?: boolean/)
    expect(h).toMatch(/notifyDocumentSaved\(filePath, auto === false \? 'user' : 'auto'\)/)
    expect(preload).toMatch(
      /saveDocxNew: \(defaultName: string, data: ArrayBuffer, auto\?: boolean\)/,
    )
    expect(preload).toMatch(/invoke\('docs:save-new', defaultName, data, auto\)/)
    // the renderer passes its own auto flag: Ctrl+S on an untitled document is the user's save,
    // the recovery tick and the AI's create_document save with auto = true
    expect(actions).toMatch(
      /saveDocxNew\(newDocName \?\? autoName \?\? doc\.fileName, buffer, auto\)/,
    )
  })

  it('docs:save-to (MCP) is an agent', () => {
    expect(handler('docs:save-to')).toMatch(/notifyDocumentSaved\(filePath, 'agent'\)/)
  })
})
