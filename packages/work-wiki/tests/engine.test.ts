import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkWikiEngine } from '../src/node/engine'
import type { EngineOptions } from '../src/node/engine'

const planJson = JSON.stringify({
  work: { slug: null, title: 'KOICA 보건 PMC', aliases: [], summary: '보건 PMC 제안' },
  document: '기술제안서',
  workPoints: ['발주처 KOICA'],
  methods: [],
  client: null,
  conflicts: [],
})
const model = () =>
  vi.fn(async (system: string) =>
    system.includes('PLAN') ? planJson : '## 개요\n요약\n\n## 이력\n',
  )

describe('WorkWikiEngine', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
  afterEach(() => vi.useRealTimers())

  const make = (over: Partial<EngineOptions> = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    const texts: Record<string, string | null> = { 'D:/docs/a.hwp': 'Ⅰ. 개요\n내용' }
    const complete = model()
    const engine = new WorkWikiEngine({
      root,
      complete,
      extractText: async (p) => texts[p] ?? null,
      debounceMs: 1000,
      ...over,
    })
    return { engine, complete, texts, root }
  }

  it('learns a saved document after the debounce, once, and skips an unchanged save', async () => {
    const { engine, complete } = make()
    expect(engine.start()).toBe(true)
    engine.onDocumentSaved('D:/docs/a.hwp')
    engine.onDocumentSaved('D:/docs/a.hwp')
    await vi.advanceTimersByTimeAsync(1100)
    await engine.runDue()
    expect(complete).toHaveBeenCalledTimes(2) // plan + work merge
    expect(engine.catalog()).toContain('KOICA 보건 PMC')
    engine.onDocumentSaved('D:/docs/a.hwp')
    await vi.advanceTimersByTimeAsync(1100)
    await engine.runDue()
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('ignores unsupported formats, the wiki folder and excluded folders', async () => {
    const { engine, complete, root } = make({ exclude: ['D:/private'] })
    engine.start()
    for (const p of ['D:/docs/a.txt', join(root, 'wiki/work/x.hwp'), 'D:/private/b.hwp']) {
      engine.onDocumentSaved(p)
    }
    await vi.advanceTimersByTimeAsync(1100)
    await engine.runDue()
    expect(complete).not.toHaveBeenCalled()
  })

  it('a save during a running job queues behind it and ends on the newest text', async () => {
    const { engine, complete, texts } = make()
    engine.start()
    engine.onDocumentSaved('D:/docs/a.hwp')
    await vi.advanceTimersByTimeAsync(1100)
    const first = engine.runDue()
    texts['D:/docs/a.hwp'] = 'Ⅰ. 개요\n바뀐 내용'
    engine.onDocumentSaved('D:/docs/a.hwp')
    await first
    await vi.advanceTimersByTimeAsync(1100)
    await engine.runDue()
    expect(complete).toHaveBeenCalledTimes(4) // first learn + revision learn
  })

  it('skips a document with no extractable text and logs it', async () => {
    const { engine, complete } = make()
    engine.start()
    engine.onDocumentSaved('D:/docs/locked.docx')
    await vi.advanceTimersByTimeAsync(1100)
    await engine.runDue()
    expect(complete).not.toHaveBeenCalled()
  })

  it('pending jobs survive a restart', async () => {
    const { engine, root, complete } = make()
    engine.start()
    engine.onDocumentSaved('D:/docs/a.hwp')
    engine.stop()
    const again = new WorkWikiEngine({
      root,
      complete,
      extractText: async () => 'Ⅰ. 개요\n내용',
      debounceMs: 1000,
    })
    again.start()
    await vi.advanceTimersByTimeAsync(1100)
    await again.runDue()
    expect(complete).toHaveBeenCalled()
  })

  it('remember writes a masked note and learns it now', async () => {
    const { engine, complete } = make()
    engine.start()
    const r = await engine.remember(['실적 표는 항상 맨 앞', '대표 주민번호 900101-1234567'])
    expect(r.ok).toBe(true)
    await engine.runDue()
    expect(complete).toHaveBeenCalled()
    expect(JSON.stringify(complete.mock.calls)).not.toContain('1234567')
  })

  it('read returns a fenced page, search finds it, unknown slugs fail softly', async () => {
    const { engine } = make()
    engine.start()
    await engine.remember(['KOICA 보건 사업'])
    await engine.runDue()
    const id = (await engine.search('KOICA'))[0]!.id
    const r = engine.read(id)
    expect(r.ok && r.page.startsWith('⟦업무 위키:')).toBe(true)
    expect(engine.read('nope').ok).toBe(false)
  })

  it('search covers LLM Wiki pages, merges the extra search and degrades when it throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    mkdirSync(join(root, 'wiki', 'entities'), { recursive: true })
    writeFileSync(
      join(root, 'wiki', 'entities', 'hanbit.md'),
      '---\ntitle: 한빛정보\n---\n우리 회사. 보건 정보시스템 구축 실적.\n',
    )
    const extra = vi.fn(async () => [
      {
        id: 'sources/profile',
        kind: 'source' as const,
        title: '회사소개서',
        summary: '',
        score: 1,
      },
    ])
    const engine = new WorkWikiEngine({
      root,
      complete: model(),
      extractText: async () => null,
      extraSearch: extra,
    })
    engine.start()
    const ids = (await engine.search('한빛정보 실적')).map((h) => h.id)
    expect(ids).toContain('entities/hanbit')
    expect(ids).toContain('sources/profile')
    const broken = new WorkWikiEngine({
      root,
      complete: model(),
      extractText: async () => null,
      extraSearch: async () => {
        throw new Error('down')
      },
    })
    broken.start()
    expect((await broken.search('한빛정보')).map((h) => h.id)).toContain('entities/hanbit')
  })

  it('read takes a path id for any wiki page, fenced, and still takes a legacy slug', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    mkdirSync(join(root, 'wiki', 'entities'), { recursive: true })
    writeFileSync(
      join(root, 'wiki', 'entities', 'hanbit.md'),
      '---\ntitle: 한빛정보\n---\n우리 회사.\n',
    )
    const engine = new WorkWikiEngine({ root, complete: model(), extractText: async () => null })
    engine.start()
    const r = engine.read('entities/hanbit')
    expect(r.ok && r.page.startsWith('⟦업무 위키:') && r.page.includes('우리 회사')).toBe(true)
    expect(engine.read('../purpose').ok).toBe(false)
    await engine.remember(['KOICA 보건 사업'])
    await engine.runDue()
    const hit = (await engine.search('KOICA'))[0]!
    expect(hit.id.startsWith('work/')).toBe(true)
    expect(engine.read(hit.id).ok).toBe(true)
    expect(engine.read(hit.id.replace('work/', '')).ok).toBe(true) // legacy slug
  })

  it('the catalog mentions LLM Wiki pages when there are any', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    mkdirSync(join(root, 'wiki', 'concepts'), { recursive: true })
    writeFileSync(join(root, 'wiki', 'concepts', 'pdm.md'), '# PDM\n본문\n')
    const engine = new WorkWikiEngine({ root, complete: model(), extractText: async () => null })
    engine.start()
    expect(engine.catalog()).toContain('LLM Wiki')
  })

  it('disables itself when the folder is not writable and never throws on saves', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    writeFileSync(join(root, 'blocker'), 'x')
    const engine = new WorkWikiEngine({
      root: join(root, 'blocker', 'wiki'),
      complete: model(),
      extractText: async () => null,
    })
    expect(engine.start()).toBe(false)
    expect(engine.enabled).toBe(false)
    expect(() => engine.onDocumentSaved('D:/docs/a.hwp')).not.toThrow()
    expect(engine.read('x')).toEqual({ ok: false, error: '업무 위키를 사용할 수 없습니다' })
  })
})
