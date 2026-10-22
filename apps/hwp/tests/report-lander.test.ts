/** @vitest-environment node */
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadDocStyles } from '../src/main/doc-styles'
import { ROLE_MAPS, createHwpLander } from '../src/renderer/ai/report/hwp-lander'
import type { StyledBlockInput } from '../src/shared/ipc'

const pages = loadDocStyles(join(__dirname, '..', 'resources', 'doc-styles')).pages
const styleOf = (id: string) => pages.find((p) => p.style.id === id)!.style

const skeleton = {
  title: '보고서 제목',
  withSummary: true,
  chapters: [
    { no: 1, title: '원칙', sections: ['1.1 범위'] },
    { no: 2, title: '규제', sections: [] },
  ],
}

function setup(live: boolean, styleId = 'report') {
  const built: StyledBlockInput[][] = []
  const deps = {
    style: styleOf(styleId),
    styleId,
    live,
    build: vi.fn(async (blocks: StyledBlockInput[]) => {
      built.push(blocks)
      return { ok: true as const, data: new Uint8Array([built.length]) }
    }),
    load: vi.fn(async () => undefined),
    saveUndo: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ ok: true })),
  }
  return { lander: createHwpLander(deps), deps, built }
}
const textsOf = (blocks: StyledBlockInput[]) =>
  blocks.map((b) => ('text' in b ? b.text : `[table ${b.rows.length}]`))

describe('Hangul lander, live (the document was blank)', () => {
  it('builds and loads the skeleton, keeping the old document for undo once', async () => {
    const s = setup(true)
    await s.lander.skeleton(skeleton)
    expect(s.deps.saveUndo).toHaveBeenCalledTimes(1)
    expect(s.deps.load).toHaveBeenCalledTimes(1)
    const t = textsOf(s.built[0]!)
    expect(s.built[0]![0]).toEqual({ role: 'title', text: '보고서 제목' })
    expect(t).toContain('목차')
    expect(t).toContain('2. 규제')
    expect(t.filter((x) => x.includes('쓰는 중'))).toHaveLength(4)
  })

  it('a chapter replaces only its own placeholder and maps blocks onto the roles', async () => {
    const s = setup(true)
    await s.lander.skeleton(skeleton)
    await s.lander.chapter(2, [
      { type: 'chapter', text: '2. 규제' },
      { type: 'paragraph', text: '본문.' },
      { type: 'bullet', text: '데이터' },
      { type: 'numbered', text: '하나' },
      { type: 'table', rows: [['a', 'b']] },
    ])
    const last = s.built.at(-1)!
    expect(last).toEqual(
      expect.arrayContaining([
        { role: 'chapter', text: '2. 규제' },
        { role: 'body', text: '본문.' },
        { role: 'bullet', text: '- 데이터' },
        { role: 'numbered', text: '1. 하나' },
        { role: 'table', rows: [['a', 'b']] },
      ]),
    )
    const t = textsOf(last)
    expect(t.some((x) => x.includes('2. 규제 — 쓰는 중'))).toBe(false)
    expect(t.some((x) => x.includes('1. 원칙 — 쓰는 중'))).toBe(true)
    expect(s.deps.saveUndo).toHaveBeenCalledTimes(1)
    expect(s.deps.load).toHaveBeenCalledTimes(2)
  })

  it('abandon rebuilds without the open placeholders', async () => {
    const s = setup(true)
    await s.lander.skeleton(skeleton)
    await s.lander.chapter(1, [{ type: 'paragraph', text: '1장 본문' }])
    await s.lander.abandon()
    const t = textsOf(s.built.at(-1)!)
    expect(t).toContain('1장 본문')
    expect(t.some((x) => x.includes('쓰는 중'))).toBe(false)
  })

  it('splits a paragraph longer than the engine allows', async () => {
    const s = setup(true)
    await s.lander.skeleton(skeleton)
    await s.lander.chapter(1, [
      { type: 'paragraph', text: `${'가'.repeat(1500)}. ${'나'.repeat(1500)}.` },
    ])
    const body = s.built.at(-1)!.filter((b) => 'text' in b && /[가나]{100}/.test(b.text))
    expect(body.length).toBe(2)
    expect(body.every((b) => 'text' in b && b.text.length <= 2000)).toBe(true)
  })
})

describe('Hangul lander, not live', () => {
  it('builds nothing until finish, then creates one document without placeholders', async () => {
    const s = setup(false)
    await s.lander.skeleton(skeleton)
    await s.lander.chapter(1, [{ type: 'paragraph', text: '1장' }])
    await s.lander.chapterFailed(2, '규제')
    await s.lander.summary([{ type: 'paragraph', text: '요약' }])
    await s.lander.gaps([])
    expect(s.deps.build).not.toHaveBeenCalled()
    expect(s.deps.load).not.toHaveBeenCalled()
    await s.lander.finish()
    expect(s.deps.create).toHaveBeenCalledTimes(1)
    const t = textsOf(s.deps.create.mock.calls[0]![0] as StyledBlockInput[])
    expect(t).toContain('1장')
    expect(t).toContain('이 장을 쓰지 못했습니다: 2. 규제')
    expect(t.some((x) => x.includes('쓰는 중'))).toBe(false)
  })
})

describe('Hangul lander, not live, cancelled', () => {
  it('still creates the document from the chapters already written', async () => {
    const s = setup(false)
    await s.lander.skeleton(skeleton)
    await s.lander.chapter(1, [{ type: 'paragraph', text: '1장' }])
    await s.lander.abandon()
    expect(s.deps.create).toHaveBeenCalledTimes(1)
    const t = textsOf(s.deps.create.mock.calls[0]![0] as StyledBlockInput[])
    expect(t).toContain('1장')
    expect(t.some((x) => x.includes('쓰는 중'))).toBe(false)
  })

  it('creates nothing when no chapter was written yet', async () => {
    const s = setup(false)
    await s.lander.skeleton(skeleton)
    await s.lander.abandon()
    expect(s.deps.create).not.toHaveBeenCalled()
  })
})

describe('role maps', () => {
  it.each(Object.keys(ROLE_MAPS))('%s maps every block type onto a role of the style', (id) => {
    const style = styleOf(id)
    const ids = new Set(style.roles.map((r) => r.id))
    for (const role of Object.values(ROLE_MAPS[id]!))
      expect(ids.has(role), `${id}: ${role}`).toBe(true)
  })

  it('a style without a map is refused', () => {
    expect(() => setup(true, 'press-release')).toThrow(/report/)
  })
})
