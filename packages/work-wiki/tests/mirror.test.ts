import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSavedMirror } from '../src/node/mirror'
import type { SavedMirrorOptions } from '../src/node/mirror'
import { hwpTextAsMarkdown } from '../src/node/hwp-markdown'

const HOUR = 3_600_000

function setup(over: Partial<SavedMirrorOptions> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ww-mirror-'))
  const root = join(base, 'wiki-folder')
  const docs = join(base, 'docs')
  const stateDir = join(base, 'state')
  mkdirSync(join(root, 'raw', 'sources'), { recursive: true })
  mkdirSync(docs, { recursive: true })
  let clock = 1_000_000
  const opts: SavedMirrorOptions = {
    root,
    stateDir,
    materialIndexPath: join(stateDir, 'material-index.json'),
    extractText: async () => '본문 텍스트',
    enabled: () => true,
    now: () => clock,
    ...over,
  }
  const mirror = createSavedMirror(opts)
  const saved = join(root, 'raw', 'sources', 'genoffice-saved')
  const doc = (name: string, content: string | Buffer, dir = docs) => {
    mkdirSync(dir, { recursive: true })
    const p = join(dir, name)
    writeFileSync(p, content)
    return p
  }
  const index = () =>
    JSON.parse(readFileSync(join(stateDir, 'saved-index.json'), 'utf8')) as {
      version: number
      docs: Record<string, { mirror: string; hash: string; writtenAt: number }>
    }
  return {
    base,
    root,
    docs,
    stateDir,
    saved,
    mirror,
    opts,
    doc,
    index,
    tick: (ms: number) => {
      clock += ms
    },
    now: () => clock,
  }
}

describe('saved-document mirror', () => {
  it('first save writes raw/sources/genoffice-saved/<name> and records it', async () => {
    const s = setup()
    const path = s.doc('보고서.docx', 'v1')
    expect(await s.mirror.mirror(path)).toEqual({
      status: 'written',
      mirror: 'genoffice-saved/보고서.docx',
    })
    expect(readFileSync(join(s.saved, '보고서.docx'), 'utf8')).toBe('v1')
    const rec = Object.values(s.index().docs)[0]!
    expect(s.index().version).toBe(1)
    expect(rec).toEqual({
      mirror: 'genoffice-saved/보고서.docx',
      hash: createHash('sha256').update('v1').digest('hex'),
      writtenAt: s.now(),
      // what the copy holds: the same bytes for a non-Hangul file
      copyHash: createHash('sha256').update('v1').digest('hex'),
    })
    // no temp file is left next to the copy
    expect(readdirSync(s.saved)).toEqual(['보고서.docx'])
  })

  it('.hwp and .hwpx become <stem>.md with the extracted text', async () => {
    const s = setup({ extractText: async () => '[page 1]\n첫 줄\n둘째 줄' })
    await s.mirror.mirror(s.doc('기안.hwp', 'binary'))
    await s.mirror.mirror(s.doc('계획.hwpx', 'zip'))
    expect(readFileSync(join(s.saved, '기안.md'), 'utf8')).toBe(
      hwpTextAsMarkdown('기안', '[page 1]\n첫 줄\n둘째 줄'),
    )
    expect(readFileSync(join(s.saved, '기안.md'), 'utf8')).toBe('# 기안\n\n첫 줄\n둘째 줄\n')
    expect(existsSync(join(s.saved, '계획.md'))).toBe(true)
  })

  it('a hwp with no text is skipped', async () => {
    const s = setup({ extractText: async () => null })
    expect((await s.mirror.mirror(s.doc('빈.hwp', 'x'))).status).toBe('skipped')
  })

  it('a name taken anywhere under raw/sources or in the ingest cache gets " (2)"', async () => {
    const s = setup()
    mkdirSync(join(s.root, 'raw', 'sources', 'reports', '2026'), { recursive: true })
    writeFileSync(join(s.root, 'raw', 'sources', 'reports', '2026', 'Plan.DOCX'), 'other')
    mkdirSync(join(s.root, '.llm-wiki'), { recursive: true })
    writeFileSync(
      join(s.root, '.llm-wiki', 'ingest-cache.json'),
      JSON.stringify({ entries: { 'plan (2).docx': { hash: 'x', filesWritten: [] } } }),
    )
    const out = await s.mirror.mirror(s.doc('plan.docx', 'mine'))
    expect(out).toEqual({ status: 'written', mirror: 'genoffice-saved/plan (3).docx' })
  })

  it('two originals with the same name, as two people sharing the folder would save, get two copies', async () => {
    const a = setup()
    // a second person: same wiki folder, their own state
    const b = createSavedMirror({
      ...a.opts,
      stateDir: join(a.base, 'state-b'),
      materialIndexPath: join(a.base, 'm-b.json'),
    })
    await a.mirror.mirror(a.doc('회의록.docx', 'from A', join(a.base, 'userA')))
    await b.mirror(a.doc('회의록.docx', 'from B', join(a.base, 'userB')))
    expect(readFileSync(join(a.saved, '회의록.docx'), 'utf8')).toBe('from A')
    expect(readFileSync(join(a.saved, '회의록 (2).docx'), 'utf8')).toBe('from B')
  })

  it('an unchanged save writes nothing', async () => {
    const s = setup()
    const path = s.doc('a.docx', 'same')
    await s.mirror.mirror(path)
    s.tick(2 * HOUR)
    expect(await s.mirror.mirror(path)).toEqual({
      status: 'unchanged',
      mirror: 'genoffice-saved/a.docx',
    })
    expect(Object.values(s.index().docs)[0]!.writtenAt).toBe(s.now() - 2 * HOUR)
  })

  it('a second change within an hour is deferred with retryAt = writtenAt + 1h, then written', async () => {
    const s = setup()
    const path = s.doc('a.docx', 'v1')
    await s.mirror.mirror(path)
    const writtenAt = s.now()
    s.tick(10 * 60_000)
    writeFileSync(path, 'v2')
    expect(await s.mirror.mirror(path)).toEqual({ status: 'deferred', retryAt: writtenAt + HOUR })
    expect(readFileSync(join(s.saved, 'a.docx'), 'utf8')).toBe('v1')
    writeFileSync(path, 'v3')
    s.tick(HOUR)
    expect(await s.mirror.mirror(path)).toEqual({
      status: 'written',
      mirror: 'genoffice-saved/a.docx',
    })
    expect(readFileSync(join(s.saved, 'a.docx'), 'utf8')).toBe('v3')
  })

  it('a file over 100 MB is skipped', async () => {
    const s = setup({ maxBytes: 10 })
    expect((await s.mirror.mirror(s.doc('big.pdf', 'more than ten bytes'))).status).toBe('skipped')
    expect(existsSync(s.saved)).toBe(false)
  })

  it('switched off: skipped', async () => {
    const s = setup({ enabled: () => false })
    expect((await s.mirror.mirror(s.doc('a.docx', 'x'))).status).toBe('skipped')
    expect(existsSync(s.saved)).toBe(false)
  })

  it('a file inside the wiki folder is skipped', async () => {
    const s = setup()
    const inside = s.doc('x.md', 'x', join(s.root, 'raw', 'sources'))
    expect((await s.mirror.mirror(inside)).status).toBe('skipped')
  })

  it('a document whose content matches an Add-material copy adopts that copy and updates it in place', async () => {
    const s = setup()
    const copy = join(s.root, 'raw', 'sources', '제안서.pdf')
    writeFileSync(copy, 'same bytes')
    mkdirSync(s.stateDir, { recursive: true })
    writeFileSync(
      s.opts.materialIndexPath,
      JSON.stringify({ [createHash('sha256').update('same bytes').digest('hex')]: copy }),
    )
    const path = s.doc('제안서.pdf', 'same bytes')
    expect(await s.mirror.mirror(path)).toEqual({ status: 'unchanged', mirror: '제안서.pdf' })
    expect(existsSync(s.saved)).toBe(false)
    writeFileSync(path, 'edited bytes')
    expect(await s.mirror.mirror(path)).toEqual({ status: 'written', mirror: '제안서.pdf' })
    expect(readFileSync(copy, 'utf8')).toBe('edited bytes')
  })

  it('moved() re-keys the record; the copy keeps its name', async () => {
    const s = setup()
    const path = s.doc('old.docx', 'v1')
    await s.mirror.mirror(path)
    const moved = join(s.docs, 'sub', 'new name.docx')
    mkdirSync(join(s.docs, 'sub'), { recursive: true })
    writeFileSync(moved, 'v1')
    await s.mirror.moved(path, moved)
    expect(Object.keys(s.index().docs)).toHaveLength(1)
    expect(await s.mirror.mirror(moved)).toEqual({
      status: 'unchanged',
      mirror: 'genoffice-saved/old.docx',
    })
  })

  it('onFirstMirror fires once', async () => {
    const onFirstMirror = vi.fn()
    const s = setup({ onFirstMirror })
    await s.mirror.mirror(s.doc('a.docx', '1'))
    await s.mirror.mirror(s.doc('b.docx', '2'))
    expect(onFirstMirror).toHaveBeenCalledTimes(1)
  })

  it('a broken saved-index starts over without throwing', async () => {
    const s = setup()
    mkdirSync(s.stateDir, { recursive: true })
    writeFileSync(join(s.stateDir, 'saved-index.json'), '{ broken')
    expect((await s.mirror.mirror(s.doc('a.docx', 'x'))).status).toBe('written')
  })
})

describe('saved-document mirror: shared folders and shared text', () => {
  it("never overwrites a coworker's file that took the name after our copy was deleted", async () => {
    const s = setup()
    const path = s.doc('보고서.docx', 'mine v1')
    await s.mirror.mirror(path)
    // our copy is deleted; a coworker's different file now has the name
    writeFileSync(join(s.saved, '보고서.docx'), 'coworker')
    s.tick(2 * HOUR)
    writeFileSync(path, 'mine v2')
    expect(await s.mirror.mirror(path)).toEqual({
      status: 'written',
      mirror: 'genoffice-saved/보고서 (2).docx',
    })
    expect(readFileSync(join(s.saved, '보고서.docx'), 'utf8')).toBe('coworker')
    expect(readFileSync(join(s.saved, '보고서 (2).docx'), 'utf8')).toBe('mine v2')
  })

  it('rewrites its own copy in place, and re-creates it when it was deleted', async () => {
    const s = setup()
    const path = s.doc('a.docx', 'v1')
    await s.mirror.mirror(path)
    s.tick(2 * HOUR)
    writeFileSync(path, 'v2')
    expect(await s.mirror.mirror(path)).toMatchObject({ mirror: 'genoffice-saved/a.docx' })
    rmSync(join(s.saved, 'a.docx'))
    s.tick(2 * HOUR)
    writeFileSync(path, 'v3')
    expect(await s.mirror.mirror(path)).toMatchObject({ mirror: 'genoffice-saved/a.docx' })
    expect(readFileSync(join(s.saved, 'a.docx'), 'utf8')).toBe('v3')
  })

  it('uses the text the caller already extracted for a Hangul file', async () => {
    const extractText = vi.fn(async () => 'should not be read')
    const s = setup({ extractText })
    await s.mirror.mirror(s.doc('기안.hwp', 'bin'), { text: async () => '공유된 본문' })
    expect(extractText).not.toHaveBeenCalled()
    expect(readFileSync(join(s.saved, '기안.md'), 'utf8')).toBe('# 기안\n\n공유된 본문\n')
  })
})
