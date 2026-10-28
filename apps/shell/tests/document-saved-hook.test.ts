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
  ])('%s is registered with afterDocumentSaved', (setter) => {
    expect(index).toMatch(
      new RegExp(
        `${setter}\\(\\s*\\(path, origin\\)\\s*=>\\s*afterDocumentSaved\\(path, origin\\)\\s*\\)`,
      ),
    )
  })

  it('afterDocumentSaved feeds the work wiki always and the team NAS only for user saves', () => {
    const body = index.slice(index.indexOf('function afterDocumentSaved('))
    const fn = body.slice(0, body.indexOf('\n}\n'))
    expect(fn).toMatch(/function afterDocumentSaved\(path: string, origin: SaveOrigin\)/)
    expect(fn).toMatch(/workWikiDocumentSaved\(path\)/)
    expect(fn).toMatch(/if \(origin !== 'user'\) return[\s\S]*teamSync\?\.enqueue\(path\)/)
  })

  it('Hangul saves and the shell PDF copy go through afterDocumentSaved too', () => {
    expect(index).toMatch(
      /onSaved: \(webContentsId, path, origin\) => \{[\s\S]*?afterDocumentSaved\(path, origin\)/,
    )
    // Save As of a clean PDF is the user's own action
    expect(index).toMatch(/this copy bypasses it\s*afterDocumentSaved\(target, 'user'\)/)
  })
})

describe('moving a document in the app', () => {
  it('afterFileMoved tells the work wiki, so the saved copy follows', () => {
    const body = index.slice(index.indexOf('function afterFileMoved('))
    const fn = body.slice(0, body.indexOf('\n}\n'))
    expect(fn).toMatch(/workWikiDocumentMoved\(oldPath, newPath\)/)
  })
})

describe('a clean PDF Save As', () => {
  it('reports the byte-identical copy like a save (it bypasses the PDF save handler)', () => {
    const body = index.slice(index.indexOf('async function savePdfAs('))
    const fn = body.slice(0, body.indexOf('\n}\n'))
    expect(fn).toMatch(
      /await atomicCopyFile\(tab\.filePath, target\)\r?\n(\s*\/\/[^\n]*\n)?\s*afterDocumentSaved\(target, 'user'\)/,
    )
  })
})

describe('the saved-copies notice', () => {
  it('is an in-app message box (a Windows toast needs an app user model id the shell does not set)', () => {
    const wiki = readFileSync(join(__dirname, '../src/main/work-wiki.ts'), 'utf8')
    const body = wiki.slice(wiki.indexOf('function showMirrorNotice('))
    const fn = body.slice(0, body.indexOf('\n}\n'))
    expect(fn).toMatch(/dialog\.showMessageBox\(/)
    expect(fn).not.toMatch(/new Notification\(/)
  })
})
