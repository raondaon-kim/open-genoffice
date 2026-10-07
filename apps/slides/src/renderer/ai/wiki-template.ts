import type { PptxElement, PptxLayout, PptxRole, PptxStyle } from '@genoffice/doc-styles'
import type { LayoutSkeleton, RoleSkeleton } from './layout-skeleton'

/**
 * The PowerPoint pages of the document-style wiki, offered to generate_deck as style templates.
 *
 * A wiki page names the organization's deck types (business, lecture, pitch …): its theme colors,
 * fonts, text sizes and the title box of the cover, content and closing slides. generate_deck
 * already takes a saved style template (a Style Skill text plus a layout skeleton) and then skips
 * its own style step; a wiki page becomes exactly that pair, so the deck is composed page by page
 * by the normal pipeline (outline, measured text boxes, QC) while the colors, fonts, sizes and
 * title geometry come from the wiki.
 */

export const WIKI_TEMPLATE_PREFIX = 'wiki:'

/** pixels per point on the 1280-px-wide generation canvas (13.333 in at 96 dpi) */
const PX_PER_PT = 96 / 72
const CANVAS_W = 1280

export function isWikiTemplate(name: string): boolean {
  return name.startsWith(WIKI_TEMPLATE_PREFIX)
}

export function wikiTemplateName(id: string): string {
  return `${WIKI_TEMPLATE_PREFIX}${id}`
}

const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16)
const mix = (a: string, b: string, toB: number): string =>
  '#' +
  [1, 3, 5]
    .map((at) => Math.round(channel(a, at) * (1 - toB) + channel(b, at) * toB))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

/** a color token of the page (dark, light, mute, tint, accent1-6) or #RRGGBB -> #RRGGBB */
export function resolveWikiColor(style: PptxStyle, ref: string): string {
  const { dark, light, accent } = style.theme.colors
  const accentAt = (i: number): string => accent[i] ?? accent[accent.length - 1] ?? dark
  const m = /^accent([1-6])$/.exec(ref)
  if (m) return accentAt(Number(m[1]) - 1)
  if (ref === 'dark') return dark
  if (ref === 'light') return light
  if (ref === 'mute') return mix(dark, light, 0.4)
  if (ref === 'tint') return mix(accentAt(0), light, 0.9)
  return ref
}

const px = (pt: number): number => Math.round(pt * PX_PER_PT)

function canvasOf(style: PptxStyle): { w: number; h: number } {
  return { w: CANVAS_W, h: style.slide.ratio === '4:3' ? 960 : 720 }
}

function roleOf(style: PptxStyle, id: string): PptxRole | undefined {
  return style.roles.find((r) => r.id === id)
}

/** the layout the wiki uses for a slot of the deck (cover, content, closing) */
function layoutFor(
  style: PptxStyle,
  slot: 'cover' | 'content' | 'closing',
): PptxLayout | undefined {
  const byId = style.layouts.find((l) => l.id === slot)
  if (byId) return byId
  const skeletonSlot = style.skeleton.find((s) => s.slot === slot)
  const id = skeletonSlot?.layout ?? skeletonSlot?.layouts?.[0]
  return style.layouts.find((l) => l.id === id)
}

/** the first title-kind text of a layout, with its role */
function titleElement(
  style: PptxStyle,
  layout: PptxLayout,
): { element: PptxElement; role: PptxRole } | undefined {
  for (const element of layout.elements) {
    const role = roleOf(style, element.role)
    if (role?.kind === 'title') return { element, role }
  }
  return undefined
}

function roleSkeleton(style: PptxStyle, layout: PptxLayout | undefined): RoleSkeleton | undefined {
  if (!layout) return undefined
  const canvas = canvasOf(style)
  const out: RoleSkeleton = {}
  if (layout.background) out.background = resolveWikiColor(style, layout.background)
  const title = titleElement(style, layout)
  const box = title ? (title.element.box ?? title.role.box) : undefined
  if (title && box) {
    const color = title.element.color ?? title.role.color
    out.title = {
      x: Math.round(box.x * canvas.w),
      y: Math.round(box.y * canvas.h),
      w: Math.round(box.w * canvas.w),
      h: Math.round(box.h * canvas.h),
      sizePt: title.role.size,
      ...(color ? { color: resolveWikiColor(style, color) } : {}),
    }
  }
  return out.background || out.title ? out : undefined
}

/** the cover / content / closing chrome a wiki page pins: background and title box */
export function wikiLayoutSkeleton(style: PptxStyle): LayoutSkeleton {
  const skeleton: LayoutSkeleton = { canvas: canvasOf(style) }
  const cover = roleSkeleton(style, layoutFor(style, 'cover'))
  const content = roleSkeleton(style, layoutFor(style, 'content'))
  const closing = roleSkeleton(style, layoutFor(style, 'closing'))
  if (cover) skeleton.cover = cover
  if (content) skeleton.content = content
  if (closing) skeleton.closing = closing
  return skeleton
}

function sizeRange(role: PptxRole | undefined, fallbackPt: number): string {
  const p = px(role?.size ?? fallbackPt)
  return `${Math.round(p * 0.9)}-${Math.round(p * 1.1)}`
}

/**
 * The Style Skill (the visual guide generate_deck's page step reads) for a wiki page, in the same
 * structure generate_deck's own style step writes, plus the page's deck-type rules.
 */
export function wikiStyleSkill(style: PptxStyle, description: string): string {
  const c = (ref: string) => resolveWikiColor(style, ref)
  const { dark, light } = style.theme.colors
  const bg = (slot: 'cover' | 'content' | 'closing') =>
    c(layoutFor(style, slot)?.background ?? (slot === 'content' ? 'light' : 'dark'))
  const contentBg = bg('content')
  const titleRole = roleOf(style, 'slide-title') ?? style.roles.find((r) => r.kind === 'title')
  const bodyRole = roleOf(style, 'body-1') ?? style.roles.find((r) => r.kind === 'body')
  const coverTitle = roleOf(style, 'cover-title')
  const eastAsian = style.theme.fontEastAsian ?? style.theme.fontMajor
  const layouts = style.layouts.map((l) => `    ${l.id}: ${l.use}`).join('\n')
  const summary = description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, 3)
    .join(' ')
    .slice(0, 600)
  return [
    `Document type: ${style.title} (the organization's style wiki${style.draft ? ', draft values' : ''})`,
    '',
    'Color rules (must use concrete hex values)',
    `  Main background: ${contentBg}`,
    '  Per-page-type backgrounds:',
    `    cover: ${bg('cover')}`,
    `    content: ${contentBg}`,
    `    data: ${contentBg}`,
    `    closing: ${bg('closing')}`,
    `  Main text color: ${dark} (on dark backgrounds use ${light})`,
    `  Primary accent: ${c('accent1')}`,
    `  Secondary accent: ${c('accent2')}`,
    '  (Iron rule: one accent color system across the whole deck — never exceed the primary + secondary accents)',
    `  Card background: ${c('tint')}`,
    `  Border color: ${mix(dark, light, 0.85)}`,
    '',
    'Fonts',
    `  CJK title font: ${eastAsian}`,
    `  Latin title font: ${style.theme.fontMajor}`,
    `  Body font: ${style.theme.fontMinor}`,
    `  Cover title size: ${sizeRange(coverTitle, 48)}px`,
    `  Title size: ${sizeRange(titleRole, 32)}px`,
    `  Body size: ${sizeRange(bodyRole, 22)}px`,
    '',
    "Layout variants per page type (the deck type's own layouts first; vary content pages, never the same layout twice in a row)",
    '  deck type layouts:',
    layouts,
    '  content variants:',
    '    two_column_comparison | timeline_horizontal | hero_big_number | three_column_cards | left_text_right_image',
    '  data variants:',
    '    kpi_cards_row | chart_with_insight',
    '',
    'Deck type rules',
    '  Content pages: 3-5 short phrases (one line each, no full sentences, no trailing periods); numbers and key terms first; split a long explanation over two pages.',
    '  Keep the title box of each page type exactly where the template chrome pins it.',
    '',
    `Overall style: ${summary || style.title}`,
  ].join('\n')
}
