import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WikiStore } from '../src/node/store'
import type { WikiPage } from '../src/types'

// the text 0.5.1 and earlier seeded; a wiki that still holds it gets the new rules
const FIRST_PURPOSE = `# 업무 위키의 목적

GenOffice가 저장된 문서와 대화에서 자동으로 정리하는 업무 기억입니다.
- 업무: 어떤 일을 했는지와 그 요약
- 작업 방식: 문서를 어떤 구성·문체·순서로 쓰는지, 초안을 어떻게 고치는지
- 기관: 발주처·고객의 선호와 평가 경향
문서 내용을 옮겨 적지 않고, 다음 업무에 다시 쓸 요점만 남깁니다.
`
const FIRST_SCHEMA = `# 페이지 규칙

이 폴더는 GenOffice와 LLM Wiki가 함께 씁니다.

## GenOffice가 관리 (사람이 고치지 않습니다)
- wiki/work/: 업무 하나에 한 페이지 (1,500자 이내). 섹션: 개요, 진행·결정, 관련 문서, 이력
- wiki/methods/: 작업 방식 (2,000자 이내). 섹션: 방식, 수정 경향, 이력
- wiki/clients/: 기관 (800자 이내). 섹션: 선호, 이력
- raw/genoffice-notes/: 대화에서 기억한 메모

## LLM Wiki가 관리
- raw/sources/: 사용자가 넣은 자료 (회사소개서, 지난 제안서 등)
- wiki/entities/: 인물·기관·사업, wiki/concepts/: 개념·방법, wiki/sources/: 자료 요약
- wiki/queries, comparisons, synthesis, index.md, log.md, overview.md

## 공통
- 앞머리: type, title, aliases, summary, tags, related, sources, created, updated
- 본문 링크는 [[이름]]
`

const fixed = () => new Date('2026-10-14T09:00:00')
const page = (over: Partial<WikiPage>): WikiPage => ({
  slug: 'w',
  type: 'work',
  title: 'W',
  aliases: [],
  summary: 's',
  tags: [],
  related: [],
  sources: [],
  created: '2026-10-01',
  updated: '2026-10-01',
  body: '## 개요\n내용\n',
  ...over,
})
const newStore = () => {
  const store = new WikiStore(mkdtempSync(join(tmpdir(), 'ww-')), fixed)
  store.bootstrap()
  return store
}

describe('WikiStore', () => {
  it('bootstraps the LLM Wiki folder layout once', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    const store = new WikiStore(root, fixed)
    store.bootstrap()
    store.bootstrap()
    for (const p of [
      'purpose.md',
      'schema.md',
      'raw/genoffice-notes',
      'wiki/work',
      'wiki/methods',
      'wiki/clients',
    ]) {
      expect(existsSync(join(root, p))).toBe(true)
    }
    // LLM Wiki owns these: the store neither creates nor writes them
    for (const p of ['wiki/index.md', 'wiki/log.md', 'raw/sources']) {
      expect(existsSync(join(root, p))).toBe(false)
    }
  })

  it("seeds a schema that names both programs' folders", () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    new WikiStore(root, fixed).bootstrap()
    const schema = readFileSync(join(root, 'schema.md'), 'utf8')
    for (const name of [
      'wiki/work',
      'wiki/methods',
      'wiki/clients',
      'entities',
      'concepts',
      'raw/sources',
    ]) {
      expect(schema).toContain(name)
    }
  })

  it('seeds rules that keep source facts whole and put usage notes in their own section', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    new WikiStore(root, fixed).bootstrap()
    const purpose = readFileSync(join(root, 'purpose.md'), 'utf8')
    const schema = readFileSync(join(root, 'schema.md'), 'utf8')
    for (const text of [purpose, schema]) expect(text).toContain('## 활용 메모 (원문 아님)')
    expect(purpose).toContain('원문 그대로')
    // the "points only" rule is for GenOffice's own pages, not for pages made from sources
    expect(purpose).toMatch(/GenOffice 페이지[\s\S]*요점만[\s\S]*자료 페이지/)
  })

  it('replaces purpose.md and schema.md that still hold the first seed text', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    writeFileSync(join(root, 'purpose.md'), FIRST_PURPOSE.replace(/\n/g, '\r\n'))
    writeFileSync(join(root, 'schema.md'), FIRST_SCHEMA)
    new WikiStore(root, fixed).bootstrap()
    expect(readFileSync(join(root, 'purpose.md'), 'utf8')).toContain('## 활용 메모 (원문 아님)')
    expect(readFileSync(join(root, 'schema.md'), 'utf8')).toContain('## 활용 메모 (원문 아님)')
  })

  it('keeps purpose.md and schema.md that the user changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-'))
    const mine = `${FIRST_PURPOSE}- 우리 팀 메모: 제안서는 3일 전 마감\n`
    writeFileSync(join(root, 'purpose.md'), mine)
    writeFileSync(join(root, 'schema.md'), '# 우리 규칙\n')
    new WikiStore(root, fixed).bootstrap()
    expect(readFileSync(join(root, 'purpose.md'), 'utf8')).toBe(mine)
    expect(readFileSync(join(root, 'schema.md'), 'utf8')).toBe('# 우리 규칙\n')
  })

  it('writes pages into their type folder and lists them back', () => {
    const store = newStore()
    store.writePage(page({ slug: 'koica-health', type: 'work', title: 'KOICA 보건' }))
    store.writePage(page({ slug: 'proposal-method', type: 'method', title: '제안서 작성 방식' }))
    expect(store.readPage('koica-health')?.title).toBe('KOICA 보건')
    expect(
      store
        .listPages()
        .map((p) => p.slug)
        .sort(),
    ).toEqual(['koica-health', 'proposal-method'])
    expect(readFileSync(join(store.root, 'wiki/methods/proposal-method.md'), 'utf8')).toContain(
      'type: method',
    )
  })

  it('appends dated log lines and gives unique slugs', () => {
    const store = newStore()
    store.appendLog('학습: 제안서.hwp')
    expect(readFileSync(join(store.stateDir, 'log.md'), 'utf8')).toMatch(
      /- 2026-10-14 09:00 학습: 제안서\.hwp/,
    )
    store.writePage(page({ slug: 'koica', title: 'KOICA' }))
    expect(store.uniqueSlug('KOICA')).toBe('koica-2')
    expect(store.today()).toBe('2026-10-14')
  })

  it('masks sensitive numbers on write', () => {
    const store = newStore()
    store.writePage(page({ slug: 'p', body: '## 개요\n대표 900101-1234567\n' }))
    expect(store.readPage('p')?.body).not.toContain('1234567')
  })
})
