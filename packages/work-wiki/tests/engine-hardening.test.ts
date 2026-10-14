import { existsSync, mkdtempSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WorkWikiEngine } from '../src/node/engine'

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
const text = async () => 'Ⅰ. 개요\n내용'
const tmp = () => mkdtempSync(join(tmpdir(), 'ww-'))

describe('WorkWikiEngine hardening', () => {
  it('keeps its state (registry, snapshots, queue) outside the wiki folder', async () => {
    const root = tmp()
    const stateDir = join(tmp(), 'state')
    const engine = new WorkWikiEngine({
      root,
      stateDir,
      complete: model(),
      extractText: text,
      debounceMs: 0,
      watch: false,
    })
    engine.start()
    engine.onDocumentSaved('D:/docs/a.hwp')
    await engine.runDue()
    expect(existsSync(join(root, '.genoffice-wiki'))).toBe(false)
    expect(existsSync(join(stateDir, 'documents.json'))).toBe(true)
    expect(existsSync(join(root, 'wiki', 'work'))).toBe(true)
  })

  it('stop() during a running job lets no further job start and disables the engine', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const complete = vi.fn(async (system: string) => {
      await gate
      return system.includes('PLAN') ? planJson : '## 개요\n요약\n'
    })
    const engine = new WorkWikiEngine({
      root: tmp(),
      complete,
      extractText: text,
      debounceMs: 0,
      watch: false,
    })
    engine.start()
    engine.onDocumentSaved('D:/docs/a.hwp')
    engine.onDocumentSaved('D:/docs/b.hwp')
    const run = engine.runDue()
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    const stopped = engine.stopAndWait()
    release()
    await run
    await stopped
    expect(engine.enabled).toBe(false)
    // only the first document's calls (plan + merge); b.hwp never started
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('a queued job from before a folder was excluded is dropped on restart', async () => {
    const root = tmp()
    const stateDir = join(tmp(), 'state')
    const first = new WorkWikiEngine({
      root,
      stateDir,
      complete: model(),
      extractText: text,
      debounceMs: 0,
      watch: false,
    })
    first.start()
    first.onDocumentSaved('D:/private/secret.hwp')
    first.stop()
    const complete = model()
    const again = new WorkWikiEngine({
      root,
      stateDir,
      complete,
      extractText: text,
      exclude: ['D:/private'],
      debounceMs: 0,
      watch: false,
    })
    again.start()
    await again.runDue()
    expect(complete).not.toHaveBeenCalled()
  })

  it('a wiki folder that disappears mid-session disables the engine without throwing', async () => {
    const root = tmp()
    const engine = new WorkWikiEngine({
      root,
      complete: model(),
      extractText: text,
      debounceMs: 0,
      watch: false,
    })
    engine.start()
    engine.onDocumentSaved('D:/docs/a.hwp')
    renameSync(root, `${root}-gone`) // the share dropped
    await expect(engine.runDue()).resolves.toBeUndefined()
    expect(engine.enabled).toBe(false)
    expect(engine.read('x')).toEqual({ ok: false, error: '업무 위키를 사용할 수 없습니다' })
    expect(() => engine.onDocumentSaved('D:/docs/b.hwp')).not.toThrow()
  })
})
