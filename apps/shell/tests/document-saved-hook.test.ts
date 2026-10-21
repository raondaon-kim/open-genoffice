/**
 * Every editor's saves feed the work wiki: the shell registers each app's
 * document-saved hook with workWikiDocumentSaved.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const index = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')

describe('document saves reach the work wiki', () => {
  it.each([
    'setDocsDocumentSavedHook',
    'setSlidesDocumentSavedHook',
    'setSheetsDocumentSavedHook',
    'setPdfDocumentSavedHook',
    'setMarkdownDocumentSavedHook',
    'setHtmlDocumentSavedHook',
  ])('%s is registered with workWikiDocumentSaved', (setter) => {
    expect(index).toMatch(
      new RegExp(`${setter}\\(\\s*\\(path\\)\\s*=>\\s*workWikiDocumentSaved\\(path\\)\\s*\\)`),
    )
  })
})
