import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { loadStylePages } from '@genoffice/doc-styles/node'
import type { PptxStyle } from '@genoffice/doc-styles'
import {
  isWikiTemplate,
  resolveWikiColor,
  wikiLayoutSkeleton,
  wikiStyleSkill,
  wikiTemplateName,
} from '../src/renderer/ai/wiki-template'

const WIKI = join(__dirname, '../../hwp/resources/doc-styles')
const page = (id: string) => {
  const found = loadStylePages(WIKI).pages.find((p) => p.style.id === id)
  if (!found) throw new Error(`no wiki page ${id}`)
  return { style: found.style as PptxStyle, description: found.description }
}

describe('wiki deck pages as generate_deck style templates', () => {
  it('names wiki templates with a prefix that cannot clash with saved ones', () => {
    expect(wikiTemplateName('deck-business')).toBe('wiki:deck-business')
    expect(isWikiTemplate('wiki:deck-business')).toBe(true)
    expect(isWikiTemplate('my style')).toBe(false)
  })

  it('resolves the color tokens of a page', () => {
    const { style } = page('deck-business')
    expect(resolveWikiColor(style, 'dark')).toBe(style.theme.colors.dark)
    expect(resolveWikiColor(style, 'accent2')).toBe(style.theme.colors.accent[1])
    expect(resolveWikiColor(style, 'tint')).toMatch(/^#[0-9A-F]{6}$/)
    expect(resolveWikiColor(style, '#123456')).toBe('#123456')
  })

  it('writes a Style Skill with concrete colors, the theme fonts and size ranges', () => {
    const { style, description } = page('deck-business')
    const skill = wikiStyleSkill(style, description)
    expect(skill).toContain(`cover: ${style.theme.colors.dark}`)
    expect(skill).toContain(`Primary accent: ${style.theme.colors.accent[0]}`)
    expect(skill).toContain(`CJK title font: ${style.theme.fontEastAsian ?? style.theme.fontMajor}`)
    // slide title 32pt -> about 43px on the 1280 canvas
    expect(skill).toMatch(/Title size: \d+-\d+px/)
    // the deck type's own layouts are offered by id
    for (const layout of style.layouts) expect(skill).toContain(`${layout.id}: `)
    expect(skill).not.toMatch(/undefined|NaN/)
  })

  it('pins the cover, content and closing title boxes and backgrounds on the 1280 canvas', () => {
    const { style } = page('deck-business')
    const skeleton = wikiLayoutSkeleton(style)
    expect(skeleton.canvas).toEqual({ w: 1280, h: 720 })
    expect(skeleton.cover?.background).toBe(style.theme.colors.dark)
    expect(skeleton.content?.background).toBe(style.theme.colors.light)
    const title = skeleton.content?.title
    expect(title).toBeDefined()
    expect(title!.sizePt).toBe(style.roles.find((r) => r.id === 'slide-title')!.size)
    expect(title!.x + title!.w).toBeLessThanOrEqual(1280)
    expect(title!.y + title!.h).toBeLessThanOrEqual(720)
    // the cover title is light text on the dark cover
    expect(skeleton.cover?.title?.color).toBe(style.theme.colors.light)
  })

  it('converts every bundled deck page without gaps', () => {
    const decks = loadStylePages(WIKI).pages.filter((p) => p.style.format === 'pptx')
    expect(decks.length).toBeGreaterThanOrEqual(3)
    for (const p of decks) {
      const style = p.style as PptxStyle
      const skeleton = wikiLayoutSkeleton(style)
      expect(skeleton.cover?.title, style.id).toBeDefined()
      expect(skeleton.content?.title, style.id).toBeDefined()
      expect(wikiStyleSkill(style, p.description)).not.toMatch(/undefined|NaN/)
    }
  })
})
