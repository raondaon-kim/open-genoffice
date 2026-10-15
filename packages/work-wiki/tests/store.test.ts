import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WikiStore } from '../src/node/store'
import type { WikiPage } from '../src/types'

const fixed = () => new Date('2026-10-14T09:00:00')
const page = (over: Partial<WikiPage>): WikiPage => ({
  slug: 'w',
  type: 'work',
  title: 'W',
  aliases: [],
  summary: 's',
  tags: [],
  related: [],
  sources: [],
  created: '2026-10-01',
  updated: '2026-10-01',
  body: '## 개요\n내용\n',
  ...over,
})
const newStore = () => {
  const store = new WikiStore(mkdtempSync(join(tmpdir(), 'ww-')), fixed)
  store.bootstrap()
  return store
}

describe('WikiStore', () => {
  it('bootstraps the LLM Wiki folder layout once', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    const store = new WikiStore(root, fixed)
    store.bootstrap()
    store.bootstrap()
    for (const p of [
      'purpose.md',
      'schema.md',
      'raw/genoffice-notes',
      'wiki/work',
      'wiki/methods',
      'wiki/clients',
    ]) {
      expect(existsSync(join(root, p))).toBe(true)
    }
    // LLM Wiki owns these: the store neither creates nor writes them
    for (const p of ['wiki/index.md', 'wiki/log.md', 'raw/sources']) {
      expect(existsSync(join(root, p))).toBe(false)
    }
  })

  it("seeds a schema that names both programs' folders", () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    new WikiStore(root, fixed).bootstrap()
    const schema = readFileSync(join(root, 'schema.md'), 'utf8')
    for (const name of [
      'wiki/work',
      'wiki/methods',
      'wiki/clients',
      'entities',
      'concepts',
      'raw/sources',
    ]) {
      expect(schema).toContain(name)
    }
  })

  it('writes pages into their type folder and lists them back', () => {
    const store = newStore()
    store.writePage(page({ slug: 'koica-health', type: 'work', title: 'KOICA 보건' }))
    store.writePage(page({ slug: 'proposal-method', type: 'method', title: '제안서 작성 방식' }))
    expect(store.readPage('koica-health')?.title).toBe('KOICA 보건')
    expect(
      store
        .listPages()
        .map((p) => p.slug)
        .sort(),
    ).toEqual(['koica-health', 'proposal-method'])
    expect(readFileSync(join(store.root, 'wiki/methods/proposal-method.md'), 'utf8')).toContain(
      'type: method',
    )
  })

  it('appends dated log lines and gives unique slugs', () => {
    const store = newStore()
    store.appendLog('학습: 제안서.hwp')
    expect(readFileSync(join(store.stateDir, 'log.md'), 'utf8')).toMatch(
      /- 2026-10-14 09:00 학습: 제안서\.hwp/,
    )
    store.writePage(page({ slug: 'koica', title: 'KOICA' }))
    expect(store.uniqueSlug('KOICA')).toBe('koica-2')
    expect(store.today()).toBe('2026-10-14')
  })

  it('masks sensitive numbers on write', () => {
    const store = newStore()
    store.writePage(page({ slug: 'p', body: '## 개요\n대표 900101-1234567\n' }))
    expect(store.readPage('p')?.body).not.toContain('1234567')
  })
})
