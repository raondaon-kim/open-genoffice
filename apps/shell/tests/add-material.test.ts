import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addMaterial } from '../src/main/add-material'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mat-'))
  const rawSources = join(dir, 'raw', 'sources')
  const indexPath = join(dir, 'state', 'material-index.json')
  const src = (name: string, text = 'x') => {
    const p = join(dir, name)
    writeFileSync(p, text)
    return p
  }
  return { dir, rawSources, indexPath, src }
}
const none = async () => null

describe('addMaterial', () => {
  it('converts Hangul to Markdown without page markers and copies the other formats', async () => {
    const { rawSources, src } = setup()
    const hwp = src('회사소개서.hwp')
    const pdf = src('실적.pdf', 'PDFDATA')
    const r = await addMaterial({
      files: [hwp, pdf],
      rawSources,
      extractText: async () => '[page 1]\n회사 개요\n주요 실적\n\n[page 2]\n연락처',
    })
    expect(r).toEqual([
      { path: hwp, status: 'added' },
      { path: pdf, status: 'added' },
    ])
    const md = readFileSync(join(rawSources, '회사소개서.md'), 'utf8')
    expect(md).toContain('# 회사소개서')
    expect(md).not.toContain('[page')
    expect(readFileSync(join(rawSources, '실적.pdf'), 'utf8')).toBe('PDFDATA')
  })

  it('never overwrites: a different file with the same name gets a number', async () => {
    const { rawSources, src } = setup()
    const a = src('a.md', 'first')
    await addMaterial({ files: [a], rawSources, extractText: none })
    writeFileSync(a, 'second')
    const r = await addMaterial({ files: [a], rawSources, extractText: none })
    expect(r).toEqual([{ path: a, status: 'added' }])
    expect(readFileSync(join(rawSources, 'a.md'), 'utf8')).toBe('first')
    expect(readFileSync(join(rawSources, 'a (2).md'), 'utf8')).toBe('second')
  })

  it('reports files it cannot use with reason codes', async () => {
    const { rawSources, src } = setup()
    const bad = src('x.exe')
    const empty = src('빈문서.hwpx')
    const missing = join(rawSources, '..', 'no-such.docx')
    const r = await addMaterial({
      files: [bad, empty, missing],
      rawSources,
      extractText: async () => '  ',
    })
    expect(r).toEqual([
      { path: bad, status: 'skipped', reason: 'unsupported' },
      { path: empty, status: 'skipped', reason: 'no-text' },
      { path: missing, status: 'skipped', reason: 'unreadable' },
    ])
    expect(existsSync(join(rawSources, '빈문서.md'))).toBe(false)
  })

  it('does not take more than fifty files at once', async () => {
    const { rawSources, src } = setup()
    const files = Array.from({ length: 52 }, (_, i) => src(`f${i}.md`, `f${i}`))
    const r = await addMaterial({ files, rawSources, extractText: none })
    expect(r.filter((x) => x.status === 'added')).toHaveLength(50)
    expect(r.slice(50)).toEqual(
      files.slice(50).map((path) => ({ path, status: 'skipped', reason: 'too-many' })),
    )
  })

  it('skips content already added, under any name, across calls and within one call', async () => {
    const { rawSources, indexPath, src } = setup()
    const a = src('rfp.pdf', 'SAME')
    const b = src('rfp-copy.pdf', 'SAME')
    expect(await addMaterial({ files: [a, b], rawSources, extractText: none, indexPath })).toEqual([
      { path: a, status: 'added' },
      { path: b, status: 'duplicate' },
    ])
    expect(await addMaterial({ files: [b], rawSources, extractText: none, indexPath })).toEqual([
      { path: b, status: 'duplicate' },
    ])
    expect(existsSync(join(rawSources, 'rfp-copy.pdf'))).toBe(false)
  })

  it('adds the file again when the earlier copy was deleted from the wiki', async () => {
    const { rawSources, indexPath, src } = setup()
    const a = src('rfp.pdf', 'SAME')
    await addMaterial({ files: [a], rawSources, extractText: none, indexPath })
    rmSync(join(rawSources, 'rfp.pdf'))
    expect(await addMaterial({ files: [a], rawSources, extractText: none, indexPath })).toEqual([
      { path: a, status: 'added' },
    ])
    expect(existsSync(join(rawSources, 'rfp.pdf'))).toBe(true)
  })

  it('runs overlapping adds one at a time: no lost index entries, no double copies', async () => {
    const { rawSources, indexPath, src } = setup()
    const hwp = src('보고서.hwp', 'HWPBYTES')
    const pdf = src('rfp.pdf', 'PDFBYTES')
    // the Hangul conversion is a child process: slow enough for another add to start meanwhile
    const slowText = () => new Promise<string>((r) => setTimeout(() => r('본문'), 150))
    const [a, b, c] = await Promise.all([
      addMaterial({ files: [hwp], rawSources, extractText: slowText, indexPath }),
      addMaterial({ files: [pdf], rawSources, extractText: slowText, indexPath }),
      addMaterial({ files: [hwp], rawSources, extractText: slowText, indexPath }),
    ])
    expect([a, b, c]).toEqual([
      [{ path: hwp, status: 'added' }],
      [{ path: pdf, status: 'added' }],
      [{ path: hwp, status: 'duplicate' }],
    ])
    // both entries survived: the pdf again is a duplicate, not "rfp (2).pdf"
    expect(await addMaterial({ files: [pdf], rawSources, extractText: none, indexPath })).toEqual([
      { path: pdf, status: 'duplicate' },
    ])
    expect(readdirSync(rawSources).sort()).toEqual(['rfp.pdf', '보고서.md'])
  })

  it('dedupes Hangul by the source file, and survives a broken index', async () => {
    const { rawSources, indexPath, src } = setup()
    const h = src('보고서.hwp', 'HWPBYTES')
    const text = async () => '본문'
    await addMaterial({ files: [h], rawSources, extractText: text, indexPath })
    expect(await addMaterial({ files: [h], rawSources, extractText: text, indexPath })).toEqual([
      { path: h, status: 'duplicate' },
    ])
    writeFileSync(indexPath, '{not json')
    const other = src('다른.md', 'new')
    expect(await addMaterial({ files: [other], rawSources, extractText: none, indexPath })).toEqual(
      [{ path: other, status: 'added' }],
    )
  })
})
