import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDocStyles } from '../src/main/doc-styles'

const DIR = join(__dirname, '..', 'resources', 'doc-styles')

describe('bundled document-style wiki', () => {
  const { pages, errors } = loadDocStyles(DIR)

  it('has no invalid page', () => {
    expect(errors).toEqual([])
  })

  it('has the first three document types', () => {
    expect(pages.map((p) => p.style.id).sort()).toEqual(
      expect.arrayContaining(['press-release', 'seoul-gian', 'seoul-report']),
    )
  })

  it.each(['seoul-gian', 'seoul-report', 'press-release'])(
    '%s states its evidence and is usable',
    (id) => {
      const page = pages.find((p) => p.style.id === id)!
      expect(page.style.evidence.documents).toBeGreaterThan(0)
      expect(page.style.evidence.note.length).toBeGreaterThan(10)
      expect(page.description.length).toBeGreaterThan(100)
      // every role is reachable from the skeleton
      const used = new Set(page.style.skeleton.flatMap((s) => s.roles ?? (s.role ? [s.role] : [])))
      for (const role of page.style.roles) expect(used.has(role.id), role.id).toBe(true)
    },
  )

  it('has centered or right-aligned roles where the document type has them', () => {
    const gian = pages.find((p) => p.style.id === 'seoul-gian')!
    expect(gian.style.roles.some((r) => r.align === 'center')).toBe(true)
  })
})

describe('the narrative report style (write_report default in Hangul)', () => {
  const { pages } = loadDocStyles(DIR)
  const page = pages.find((p) => p.style.id === 'report')

  it('loads with the roles write_report maps onto', () => {
    expect(page?.style.roles.map((r) => r.id)).toEqual([
      'title',
      'chapter',
      'section',
      'subsection',
      'body',
      'bullet',
      'numbered',
    ])
  })

  it('reaches every role from its skeleton and explains itself', () => {
    const used = new Set(page!.style.skeleton.flatMap((s) => s.roles ?? (s.role ? [s.role] : [])))
    for (const role of page!.style.roles) expect(used.has(role.id), role.id).toBe(true)
    expect(page!.description.length).toBeGreaterThan(100)
    expect(page!.style.evidence.documents).toBeGreaterThan(0)
  })
})
