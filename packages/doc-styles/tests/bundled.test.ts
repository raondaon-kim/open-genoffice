import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadStylePages } from '../src/node'
import type { DocxStyle, PptxStyle } from '../src/index'

/** every page of the bundled document-style wiki (all formats) must be valid and coherent: this is a build gate */
const DIR = join(__dirname, '..', '..', '..', 'apps', 'hwp', 'resources', 'doc-styles')
const { pages, errors } = loadStylePages(DIR)
const docx = pages.filter((p) => p.style.format === 'docx').map((p) => p.style as DocxStyle)
const pptx = pages.filter((p) => p.style.format === 'pptx').map((p) => p.style as PptxStyle)

describe('bundled document-style wiki (all formats)', () => {
  it('has no invalid page', () => {
    expect(errors).toEqual([])
  })

  it('has Hangul, Word and PowerPoint pages', () => {
    expect(pages.filter((p) => p.style.format === 'hwp').length).toBeGreaterThanOrEqual(3)
    expect(docx.length).toBeGreaterThanOrEqual(4)
    expect(pptx.length).toBeGreaterThanOrEqual(3)
  })

  it('every page states its evidence and has a description', () => {
    for (const p of pages) {
      expect(p.style.evidence.documents, p.style.id).toBeGreaterThan(0)
      expect(p.style.evidence.note.length, p.style.id).toBeGreaterThan(10)
      expect(p.description.length, p.style.id).toBeGreaterThan(100)
    }
  })

  describe('Word pages', () => {
    it.each(docx.map((s) => [s.id, s] as const))(
      '%s: every role is reachable and the sizes descend',
      (_id, s) => {
        const used = new Set(
          s.skeleton.flatMap((slot) => slot.roles ?? (slot.role ? [slot.role] : [])),
        )
        for (const r of s.roles) expect(used.has(r.id), r.id).toBe(true)
        const size = (id: string) => s.roles.find((r) => r.id === id)?.size
        const body = size('body')!
        const h1 = size('heading-1')!
        const h2 = size('heading-2')!
        const h3 = size('heading-3')!
        expect(h1, 'heading-1 > body').toBeGreaterThan(body)
        expect(h1, 'heading-1 >= heading-2').toBeGreaterThanOrEqual(h2)
        expect(h2, 'heading-2 >= heading-3').toBeGreaterThanOrEqual(h3)
        expect(h3, 'heading-3 >= body').toBeGreaterThanOrEqual(body)
        const title = size('title')
        if (title !== undefined) expect(title, 'title > heading-1').toBeGreaterThan(h1)
        for (const r of s.roles) {
          expect(r.indentLeft, `${r.id} indentLeft`).toBeGreaterThanOrEqual(0)
          expect(r.lineSpacing, `${r.id} lineSpacing`).toBeLessThanOrEqual(1.6)
        }
      },
    )
  })

  describe('PowerPoint pages', () => {
    it.each(pptx.map((s) => [s.id, s] as const))(
      '%s: layouts use known roles and the sizes descend',
      (_id, s) => {
        const size = (id: string) => s.roles.find((r) => r.id === id)!.size
        expect(size('cover-title'), 'cover title >= slide title').toBeGreaterThanOrEqual(
          size('slide-title'),
        )
        expect(size('slide-title'), 'slide title >= body').toBeGreaterThanOrEqual(size('body-1'))
        const used = new Set(s.layouts.flatMap((l) => l.elements.map((e) => e.role)))
        for (const r of s.roles) expect(used.has(r.id), r.id).toBe(true)
        for (const r of s.roles) {
          if (r.box) {
            expect(r.box.x + r.box.w, `${r.id} box`).toBeLessThanOrEqual(1.001)
            expect(r.box.y + r.box.h, `${r.id} box`).toBeLessThanOrEqual(1.001)
          }
        }
      },
    )
  })
})
