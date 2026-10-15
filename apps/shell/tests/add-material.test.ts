import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addMaterial } from '../src/main/add-material'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mat-'))
  const rawSources = join(dir, 'raw', 'sources')
  const src = (name: string, text = 'x') => {
    const p = join(dir, name)
    writeFileSync(p, text)
    return p
  }
  return { dir, rawSources, src }
}

describe('addMaterial', () => {
  it('converts Hangul files to Markdown text without page markers, and copies the other formats as they are', async () => {
    const { rawSources, src } = setup()
    const hwp = src('회사소개서.hwp')
    const pdf = src('실적.pdf', 'PDFDATA')
    const r = await addMaterial({
      files: [hwp, pdf],
      rawSources,
      extractText: async () => '[page 1]\n회사 개요\n주요 실적\n\n[page 2]\n연락처',
    })
    expect(r.skipped).toEqual([])
    const md = readFileSync(join(rawSources, '회사소개서.md'), 'utf8')
    expect(md).toContain('# 회사소개서')
    expect(md).toContain('주요 실적')
    expect(md).not.toContain('[page')
    expect(readFileSync(join(rawSources, '실적.pdf'), 'utf8')).toBe('PDFDATA')
    expect(r.added.sort()).toEqual(
      [join(rawSources, '실적.pdf'), join(rawSources, '회사소개서.md')].sort(),
    )
  })

  it('never overwrites an existing file: a name clash gets a number', async () => {
    const { rawSources, src } = setup()
    const a = src('a.md', 'first')
    await addMaterial({ files: [a], rawSources, extractText: async () => null })
    writeFileSync(a, 'second')
    const r = await addMaterial({ files: [a], rawSources, extractText: async () => null })
    expect(readFileSync(join(rawSources, 'a.md'), 'utf8')).toBe('first')
    expect(readFileSync(join(rawSources, 'a (2).md'), 'utf8')).toBe('second')
    expect(r.added).toEqual([join(rawSources, 'a (2).md')])
  })

  it('reports files it cannot use instead of dropping them silently', async () => {
    const { rawSources, src } = setup()
    const bad = src('x.exe')
    const empty = src('빈문서.hwpx')
    const missing = join(rawSources, '..', 'no-such.docx')
    const r = await addMaterial({
      files: [bad, empty, missing],
      rawSources,
      extractText: async () => '   ',
    })
    expect(r.added).toEqual([])
    expect(r.skipped.map((s) => s.file)).toEqual([bad, empty, missing])
    expect(r.skipped[0]!.reason).toMatch(/format/i)
    expect(r.skipped[1]!.reason).toMatch(/text/i)
    expect(r.skipped[2]!.reason).toMatch(/read|found/i)
    expect(existsSync(join(rawSources, '빈문서.md'))).toBe(false)
  })

  it('does not take more than fifty files at once', async () => {
    const { rawSources, src } = setup()
    const files = Array.from({ length: 52 }, (_, i) => src(`f${i}.md`))
    const r = await addMaterial({ files, rawSources, extractText: async () => null })
    expect(r.added).toHaveLength(50)
    expect(r.skipped).toHaveLength(2)
  })
})
