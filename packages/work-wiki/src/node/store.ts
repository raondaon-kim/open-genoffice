import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parsePage, serializePage, slugify, todayIso } from '../page'
import { PAGE_FOLDERS } from '../types'
import type { WikiPage, WikiPageType } from '../types'
import { maskSensitive } from './mask'

const PURPOSE = `# 업무 위키의 목적

GenOffice가 저장된 문서와 대화에서 자동으로 정리하는 업무 기억입니다.
- 업무: 어떤 일을 했는지와 그 요약
- 작업 방식: 문서를 어떤 구성·문체·순서로 쓰는지, 초안을 어떻게 고치는지
- 기관: 발주처·고객의 선호와 평가 경향
문서 내용을 옮겨 적지 않고, 다음 업무에 다시 쓸 요점만 남깁니다.
`

const SCHEMA = `# 페이지 규칙

- wiki/work/: 업무 하나에 한 페이지 (1,500자 이내). 섹션: 개요, 진행·결정, 관련 문서, 이력
- wiki/methods/: 작업 방식 (2,000자 이내). 섹션: 방식, 수정 경향, 이력
- wiki/clients/: 기관 (800자 이내). 섹션: 선호, 이력
- 앞머리: type, title, aliases, summary, tags, related, sources, created, updated
- 본문 링크는 [[slug]]
`

const TYPE_HEADINGS: Record<WikiPageType, string> = {
  work: '업무',
  method: '작업 방식',
  client: '기관',
}

export class WikiStore {
  readonly root: string
  readonly wikiDir: string
  readonly rawDir: string
  readonly notesDir: string
  readonly stateDir: string
  private readonly now: () => Date

  constructor(root: string, now: () => Date = () => new Date()) {
    this.root = root
    this.wikiDir = join(root, 'wiki')
    this.rawDir = join(root, 'raw', 'sources')
    this.notesDir = join(this.rawDir, 'genoffice')
    this.stateDir = join(root, '.genoffice-wiki')
    this.now = now
  }

  /** create the folder layout; throws when the root is not writable */
  bootstrap(): void {
    const dirs = [
      this.notesDir,
      this.stateDir,
      ...Object.values(PAGE_FOLDERS).map((f) => join(this.wikiDir, f)),
    ]
    for (const dir of dirs) mkdirSync(dir, { recursive: true })
    const seed: Array<[string, string]> = [
      [join(this.root, 'purpose.md'), PURPOSE],
      [join(this.root, 'schema.md'), SCHEMA],
      [join(this.wikiDir, 'index.md'), '# 업무 위키 목차\n'],
      [join(this.wikiDir, 'log.md'), '# 업무 위키 기록\n'],
    ]
    for (const [path, text] of seed) if (!existsSync(path)) writeFileSync(path, text, 'utf8')
    // a read-only share fails here, not in the middle of a learn job
    this.atomicWrite(join(this.stateDir, '.probe'), String(Date.now()))
  }

  private pagePath(type: WikiPageType, slug: string): string {
    return join(this.wikiDir, PAGE_FOLDERS[type], `${slug}.md`)
  }

  private atomicWrite(path: string, text: string): void {
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  }

  readPage(slug: string): WikiPage | null {
    for (const type of Object.keys(PAGE_FOLDERS) as WikiPageType[]) {
      const path = this.pagePath(type, slug)
      if (existsSync(path)) return parsePage(readFileSync(path, 'utf8'), slug)
    }
    return null
  }

  writePage(page: WikiPage): void {
    const masked: WikiPage = {
      ...page,
      body: maskSensitive(page.body),
      summary: maskSensitive(page.summary),
    }
    this.atomicWrite(this.pagePath(page.type, page.slug), serializePage(masked))
  }

  listPages(): WikiPage[] {
    const out: WikiPage[] = []
    for (const type of Object.keys(PAGE_FOLDERS) as WikiPageType[]) {
      const dir = join(this.wikiDir, PAGE_FOLDERS[type])
      if (!existsSync(dir)) continue
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.md')) continue
        const page = parsePage(readFileSync(join(dir, name), 'utf8'), name.slice(0, -3))
        if (page && page.type === type) out.push(page)
      }
    }
    return out
  }

  uniqueSlug(title: string): string {
    const base = slugify(title)
    const taken = new Set(this.listPages().map((p) => p.slug))
    if (!taken.has(base)) return base
    let n = 2
    while (taken.has(`${base}-${n}`)) n++
    return `${base}-${n}`
  }

  rebuildIndex(): void {
    const pages = this.listPages()
    const lines = ['# 업무 위키 목차', '']
    for (const type of ['work', 'method', 'client'] as WikiPageType[]) {
      const group = pages
        .filter((p) => p.type === type)
        .sort((a, b) =>
          b.updated > a.updated ? 1 : b.updated < a.updated ? -1 : a.title.localeCompare(b.title),
        )
      if (group.length === 0) continue
      lines.push(`## ${TYPE_HEADINGS[type]}`)
      for (const p of group) {
        const alias = p.aliases.length ? ` (${p.aliases.join(', ')})` : ''
        lines.push(`- [[${p.slug}]] ${p.title}${alias} — ${p.summary}`)
      }
      lines.push('')
    }
    this.atomicWrite(join(this.wikiDir, 'index.md'), lines.join('\n'))
  }

  appendLog(line: string): void {
    const d = this.now()
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    appendFileSync(join(this.wikiDir, 'log.md'), `- ${todayIso(d)} ${hm} ${line}\n`, 'utf8')
  }

  today(): string {
    return todayIso(this.now())
  }
}
