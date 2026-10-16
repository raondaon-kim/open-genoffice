import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readForeignDocs, resolveWikiFile } from '../src/node/foreign'

function wikiWith(files: Record<string, string>): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'ww-')), 'wiki')
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true })
    writeFileSync(join(dir, ...rel.split('/')), text)
  }
  return dir
}

describe('readForeignDocs', () => {
  it('reads LLM Wiki pages with kinds from their folders, skipping our own folders and the catalog files', () => {
    const wiki = wikiWith({
      'entities/koica.md':
        '---\ntype: entity\ntitle: KOICA\ntags: [ODA, 기관]\n---\n한국국제협력단. 개발협력 기관.\n',
      'concepts/pdm.md': '# PDM\n\n사업 논리 모형.\n',
      'sources/회사소개서.md': '---\ntitle: 회사소개서 요약\n---\n주요 실적 12건.\n',
      'work/ours.md': '---\ntype: work\ntitle: 우리 업무\n---\n본문\n',
      'index.md': '# 목차\n',
      'log.md': '# 기록\n',
      'overview.md': '# 개요\n',
    })
    const { docs } = readForeignDocs(wiki)
    expect(docs.map((d) => d.id).sort()).toEqual([
      'concepts/pdm',
      'entities/koica',
      'sources/회사소개서',
    ])
    const koica = docs.find((d) => d.id === 'entities/koica')!
    expect(koica).toMatchObject({ kind: 'entity', title: 'KOICA', tags: ['ODA', '기관'] })
    expect(koica.summary).toContain('한국국제협력단')
    expect(docs.find((d) => d.id === 'concepts/pdm')!.title).toBe('PDM')
    expect(docs.find((d) => d.id === 'sources/회사소개서')!.kind).toBe('source')
  })

  it('returns nothing for a missing wiki folder', () => {
    expect(readForeignDocs(join(tmpdir(), 'no-such-wiki-dir')).docs).toEqual([])
  })
})

describe('resolveWikiFile', () => {
  const wiki = wikiWith({ 'entities/koica.md': 'x', 'sources/a b (1).md': 'y' })

  it('finds a page by path id, with or without .md', () => {
    expect(resolveWikiFile(wiki, 'entities/koica')).toMatch(/koica\.md$/)
    expect(resolveWikiFile(wiki, 'entities/koica.md')).toMatch(/koica\.md$/)
    expect(resolveWikiFile(wiki, 'sources/a b (1)')).toMatch(/a b \(1\)\.md$/)
  })

  it('refuses anything that could leave wiki/ or is not a plain page name', () => {
    for (const bad of [
      '../x',
      'entities/../../x',
      '/etc/passwd',
      'C:/x',
      'entities\\koica',
      '.hidden/x',
      'entities/.x',
      '',
      'entities/',
      'a//b',
    ]) {
      expect(resolveWikiFile(wiki, bad)).toBeNull()
    }
    expect(resolveWikiFile(wiki, 'entities/missing')).toBeNull()
  })
})
