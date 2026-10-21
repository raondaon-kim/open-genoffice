import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { fenceWikiText } from '../fence'
import { serializePage, todayIso } from '../page'
import { PAGE_FOLDERS, WIKI_UNAVAILABLE } from '../types'
import type { WikiHit } from '../types'
import { readForeignDocs, resolveWikiFile } from './foreign'
import { learn } from './learn'
import type { WikiComplete } from './learn'
import { maskSensitive } from './mask'
import type { MirrorCallOptions, MirrorOutcome } from './mirror'
import { buildFirstDigest, buildRevisionDigest, DocumentRegistry } from './registry'
import {
  buildCatalog,
  byCatalogOrder,
  catalogLine,
  docOfPage,
  fitLines,
  mergeHits,
  WikiSearch,
} from './search'
import { WikiStore } from './store'

export interface EngineOptions {
  root: string
  /** engine state (registry, snapshots, queue): per user, outside the wiki folder (default <root>/.genoffice-wiki) */
  stateDir?: string
  complete: WikiComplete
  /** plain text of a saved document, or null when it cannot be read (encrypted, corrupt) */
  extractText: (path: string) => Promise<string | null>
  exclude?: string[]
  /** wait after the last save of a path before learning it (default 2 minutes) */
  debounceMs?: number
  now?: () => Date
  /** the other wiki's search (LLM Wiki); its failure only narrows the results */
  extraSearch?: (query: string) => Promise<WikiHit[]>
  log?: (msg: string) => void
  /** copies saved documents into raw/sources for LLM Wiki (see mirror.ts) */
  mirror?: {
    mirror(path: string, opts?: MirrorCallOptions): Promise<MirrorOutcome>
    moved(oldPath: string, newPath: string): Promise<void>
  }
  /** learning wrote wiki pages (the shell asks LLM Wiki to rebuild its index) */
  onPagesWritten?: () => void
}

interface Job {
  path: string
  dueAt: number
  /** mirror: only copy the document (a change held back by the copy's hourly limit) */
  kind: 'document' | 'note' | 'mirror'
}

/** the formats the seven editors save; their text comes from @genoffice/file-parse */
const LEARNED = new Set([
  '.hwp',
  '.hwpx',
  '.docx',
  '.pptx',
  '.xlsx',
  '.pdf',
  '.md',
  '.html',
  '.htm',
])
const norm = (p: string) => resolve(p).replace(/\\/g, '/').toLowerCase()
const DEFAULT_DEBOUNCE_MS = 120_000
const INDEX_TTL_MS = 30_000
const READ_CAP = 12_000
const CATALOG_CAP = 3000
/** wait before trying a copy that could not be written again */
const MIRROR_RETRY_MS = 10 * 60_000
const INDEX_TEXT_CAP = 5800 // the fence adds about 60 chars; the tool result stays under 6,000
const INDEX_SEGMENT = /^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/
export const INDEX_MISSING = '색인이 아직 없습니다. wiki_search로 찾으세요.'
const INDEX_NOT_FOUND =
  '목차에 그런 분류나 묶음이 없습니다. wiki_index()로 목차를 열어 분류 이름을 확인하세요.'

/**
 * The file name LLM Wiki's index builder gives a group label: path characters
 * and spaces become "-", and a name ending in "-<digits>" gets "_" so it never
 * looks like a numbered part (see the fork's wiki-index.ts fileKey).
 */
function indexFileKey(label: string): string {
  const key = label
    .replace(/[\\/:*?"<>|#[\]]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return /-\d+$/.test(key) ? `${key}_` : key
}
const INDEX_CUT_HINT =
  '… (목록이 깁니다. 이 분류의 묶음(group)이나 "다음:" 파일을 지정해 다시 여세요.)'
const HIT_LABEL: Record<WikiHit['kind'], string> = {
  work: '업무',
  method: '작업 방식',
  client: '기관',
  entity: '인물·기관',
  concept: '개념',
  source: '자료',
  other: '위키',
}

const foreignHint = (n: number) =>
  `- LLM Wiki 자료 페이지 ${n}개 (인물·기관·개념·자료 요약): wiki_search로 찾으세요`

/**
 * One line per category of LLM Wiki's top index (`## 개념 (40)` followed by
 * `… · 목록: index/concepts.md`), pointing at wiki_index. Empty when the
 * index does not exist yet.
 */
function indexCategoryLines(wikiDir: string): string[] {
  let text: string
  try {
    text = readFileSync(join(wikiDir, 'index.md'), 'utf8').slice(0, 8000)
  } catch {
    return []
  }
  const out: string[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const head = /^## (.+)$/.exec(lines[i]!)
    if (!head) continue
    // a category folder may contain spaces ("목록: index/내 메모.md")
    const key = /index\/([^/\n]+?)\.md/.exec(lines[i + 1] ?? '')?.[1]
    if (key) out.push(`- [목차] ${head[1]} — wiki_index("${key}")로 목록을 엽니다`)
  }
  return out
}
const OWN_FOLDERS = new Set(['work', 'methods', 'clients'])

export class WorkWikiEngine {
  private readonly opts: EngineOptions
  private readonly debounceMs: number
  private store: WikiStore | null = null
  private registry: DocumentRegistry | null = null
  private searchIndex: WikiSearch | null = null
  private indexBuiltAt = 0
  private foreignCount = 0
  private readonly jobs = new Map<string, Job>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private running: Promise<void> | null = null
  private isEnabled = false

  constructor(opts: EngineOptions) {
    this.opts = opts
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  get enabled(): boolean {
    return this.isEnabled
  }

  /** prepare the folder and resume pending jobs; false (and disabled) when the folder is unusable */
  start(): boolean {
    try {
      this.store = new WikiStore(this.opts.root, this.opts.now, this.opts.stateDir)
      this.store.bootstrap()
      this.registry = new DocumentRegistry(this.store.stateDir)
      this.isEnabled = true
    } catch (err) {
      this.isEnabled = false
      this.store = null
      this.opts.log?.(`work wiki disabled: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
    try {
      // a folder excluded since the job was queued is not learned
      for (const job of this.loadQueue()) if (this.accepts(job.path, job.kind)) this.schedule(job)
    } catch (err) {
      this.disable(err)
      return false
    }
    this.refreshSearch()
    return true
  }

  /** no new job starts after this; a running job finishes (stopAndWait waits for it) */
  stop(): void {
    this.isEnabled = false
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  async stopAndWait(): Promise<void> {
    this.stop()
    while (this.running) await this.running.catch(() => {})
  }

  /** the wiki folder or its state went away (a dropped share, a deleted folder): stop for this session */
  private disable(reason: unknown): void {
    if (!this.isEnabled) return
    this.opts.log?.(
      `work wiki disabled: ${reason instanceof Error ? reason.message : String(reason)}`,
    )
    this.stop()
  }

  private queueFile(): string {
    return join(this.store!.stateDir, 'queue.json')
  }

  private loadQueue(): Job[] {
    try {
      return existsSync(this.queueFile())
        ? (JSON.parse(readFileSync(this.queueFile(), 'utf8')) as Job[])
        : []
    } catch {
      return []
    }
  }

  private saveQueue(): void {
    const tmp = `${this.queueFile()}.tmp`
    writeFileSync(tmp, JSON.stringify([...this.jobs.values()]), 'utf8')
    renameSync(tmp, this.queueFile())
  }

  private accepts(path: string, kind: Job['kind']): boolean {
    if (kind === 'note') return true // written by remember(), under raw/genoffice-notes
    const p = norm(path)
    if (!LEARNED.has(extname(path).toLowerCase())) return false
    // nothing inside the wiki folder is a document of the user's
    if (p.startsWith(`${norm(this.opts.root)}/`)) return false
    if (basename(path).startsWith('~$') || /\.tmp$/i.test(path)) return false
    return !(this.opts.exclude ?? []).some((e) => p === norm(e) || p.startsWith(`${norm(e)}/`))
  }

  private schedule(job: Job): void {
    const key = norm(job.path)
    this.jobs.set(key, job)
    this.saveQueue()
    clearTimeout(this.timers.get(key))
    this.timers.set(
      key,
      setTimeout(
        () => {
          this.timers.delete(key)
          void this.runDue()
        },
        Math.max(0, job.dueAt - Date.now()),
      ),
    )
  }

  /** a document was written; never throws (a save is never blocked by the wiki) */
  onDocumentSaved(path: string): void {
    if (!this.isEnabled || !this.accepts(path, 'document')) return
    try {
      this.schedule({ path, dueAt: Date.now() + this.debounceMs, kind: 'document' })
    } catch (err) {
      this.jobs.delete(norm(path))
      this.disable(err)
    }
  }

  /** run every due job, one at a time; concurrent callers wait for the same run; never throws */
  async runDue(): Promise<void> {
    if (!this.isEnabled) return
    while (this.running) await this.running.catch(() => {})
    if (!this.isEnabled) return
    this.running = (async () => {
      for (;;) {
        if (!this.isEnabled) break
        const due = [...this.jobs.values()]
          .filter((j) => j.dueAt <= Date.now())
          .sort((a, b) => a.dueAt - b.dueAt)[0]
        if (!due) break
        this.jobs.delete(norm(due.path))
        this.saveQueue()
        await this.runJob(due)
      }
    })()
    try {
      await this.running
    } catch (err) {
      // only file-system failures escape runJob: the folder is gone or unwritable
      this.disable(err)
    } finally {
      this.running = null
    }
  }

  private async runJob(job: Job, attempt = 1): Promise<void> {
    const store = this.store!
    const registry = this.registry!
    const title = basename(job.path).replace(/\.[^.]+$/, '')
    if (!this.accepts(job.path, job.kind)) return
    if (!existsSync(this.opts.root))
      throw new Error(`wiki folder is not available: ${this.opts.root}`)
    if (job.kind === 'mirror') return this.runMirror(job.path)
    // one read of the document per save, shared by the copy (Hangul) and the learning
    let read: Promise<string | null> | undefined
    const documentText = () => (read ??= this.opts.extractText(job.path))
    if (job.kind === 'document' && attempt === 1) await this.runMirror(job.path, documentText)
    try {
      const text = job.kind === 'note' ? readFileSync(job.path, 'utf8') : await documentText()
      if (!text || !text.trim()) {
        store.appendLog(`건너뜀(본문 없음): ${title}`)
        return
      }
      const change = registry.compare(job.path, text)
      if (change.kind === 'unchanged') return
      const digest =
        job.kind === 'note'
          ? text.slice(0, 4000)
          : change.kind === 'revision'
            ? buildRevisionDigest(change.hunks)
            : buildFirstDigest(text)
      const result = await learn(store, this.opts.complete, {
        kind: job.kind === 'note' ? 'note' : change.kind === 'revision' ? 'revision' : 'first',
        title,
        path: job.path,
        digest: maskSensitive(digest),
        workHint: registry.workOf(job.path),
      })
      registry.commit(job.path, text, result.work)
      this.refreshSearch()
      try {
        this.opts.onPagesWritten?.()
      } catch {
        // the index rebuild is a courtesy; learning already succeeded
      }
    } catch (err) {
      if (attempt < 2 && this.isEnabled) return this.runJob(job, attempt + 1)
      const msg = err instanceof Error ? err.message : String(err)
      // throws when the folder is gone: runDue turns that into disable()
      store.appendLog(`실패: ${title} — ${msg}`.slice(0, 300))
    }
  }

  /** copy the saved document into the wiki's sources; never throws, never stops learning */
  private async runMirror(path: string, text?: () => Promise<string | null>): Promise<void> {
    if (!this.opts.mirror) return
    try {
      const out = await this.opts.mirror.mirror(path, text ? { text } : undefined)
      // a change held back by the hourly limit is written when the hour is up, unless a newer
      // save of the document is already queued (its document job mirrors too)
      if (out.status === 'deferred' && !this.jobs.has(norm(path))) {
        this.schedule({ path, dueAt: out.retryAt, kind: 'mirror' })
      }
    } catch (err) {
      this.opts.log?.(
        `mirror failed: ${basename(path)} — ${err instanceof Error ? err.message : String(err)}`,
      )
      // a locked or briefly unreachable share: try the copy again later, unless a newer
      // save of the document is already queued (its document job copies too)
      if (this.isEnabled && !this.jobs.has(norm(path))) {
        try {
          this.schedule({ path, dueAt: Date.now() + MIRROR_RETRY_MS, kind: 'mirror' })
        } catch {
          // the queue file is unwritable: the next save copies it
        }
      }
    }
  }

  /** a document was moved or renamed in the app: its wiki copy follows; never throws */
  async documentMoved(oldPath: string, newPath: string): Promise<void> {
    try {
      await this.opts.mirror?.moved(oldPath, newPath)
    } catch (err) {
      this.opts.log?.(`mirror move failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private refreshSearch(): void {
    if (!this.store) {
      this.searchIndex = null
      return
    }
    const foreign = readForeignDocs(this.store.wikiDir).docs
    this.foreignCount = foreign.length
    this.searchIndex = new WikiSearch([...this.store.listPages().map(docOfPage), ...foreign])
    this.indexBuiltAt = Date.now()
  }

  catalog(): string {
    if (!this.isEnabled || !this.store) return ''
    try {
      if (Date.now() - this.indexBuiltAt > INDEX_TTL_MS) this.refreshSearch()
      const own = buildCatalog(this.store.listPages())
      return this.foreignCount > 0 ? `${own}\n${foreignHint(this.foreignCount)}`.trimStart() : own
    } catch (err) {
      this.disable(err)
      return ''
    }
  }

  /**
   * The catalog for one question, within `cap`: pages either engine finds for
   * it first, then the categories of LLM Wiki's top index (opened with
   * wiki_index), then recent GenOffice pages. Without a question it is the
   * plain catalog.
   */
  async catalogFor(query: string, cap = CATALOG_CAP): Promise<string> {
    if (!query.trim()) return this.catalog()
    if (!this.isEnabled || !this.store) return ''
    const hits = await this.search(query)
    if (!this.store) return ''
    const lines: string[] = []
    const seen = new Set<string>()
    for (const h of hits) {
      seen.add(h.id)
      lines.push(`- [${HIT_LABEL[h.kind]}] ${h.title} — ${h.summary.slice(0, 160)} (${h.id})`)
    }
    const store = this.store
    const read = (): { categories: string[]; pages: ReturnType<WikiStore['listPages']> } | null => {
      try {
        return { categories: indexCategoryLines(store.wikiDir), pages: store.listPages() }
      } catch (err) {
        this.disable(err)
        return null
      }
    }
    const found = read()
    if (!found) return ''
    const { categories, pages } = found
    lines.push(...categories)
    for (const p of pages.sort(byCatalogOrder)) {
      if (!seen.has(`${PAGE_FOLDERS[p.type]}/${p.slug}`)) lines.push(catalogLine(p))
    }
    if (categories.length === 0 && this.foreignCount > 0) lines.push(foreignHint(this.foreignCount))
    return fitLines(lines, cap)
  }

  /**
   * An index file of LLM Wiki's two-level index: the top index, a category's
   * list, or one group of a category, fenced and capped at 6,000 chars.
   * Accepts the pointers the files print (`index/concepts.md`,
   * `concepts/교육`). Missing (LLM Wiki has not built it yet): a hint to use
   * wiki_search.
   */
  indexFile(category?: string, group?: string): string {
    if (!this.isEnabled || !this.store) return WIKI_UNAVAILABLE
    const clean = (s: string) =>
      s
        .trim()
        .replace(/\\/g, '/')
        .replace(/^wiki\//, '')
        .replace(/^index(\/|\.md$)/, '')
        .replace(/\.md$/i, '')
    const parts = [category, group]
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .flatMap((s) => clean(s).split('/'))
      .filter(Boolean)
    const wikiDir = this.store.wikiDir
    // the index exists but has no such list: say so, rather than "not built yet"
    const missing = () => (existsSync(join(wikiDir, 'index.md')) ? INDEX_NOT_FOUND : INDEX_MISSING)
    if (parts.length > 2 || !parts.every((p) => INDEX_SEGMENT.test(p))) return missing()
    const fileOf = (segments: string[]) =>
      segments.length === 0
        ? join(wikiDir, 'index.md')
        : join(wikiDir, 'index', ...segments.slice(0, -1), `${segments.at(-1)}.md`)
    // as given (a pointer printed in a file), else as the index names files (a group's label)
    let text: string | null = null
    for (const segments of [parts, parts.map(indexFileKey)]) {
      try {
        text = readFileSync(fileOf(segments), 'utf8')
        break
      } catch {
        // try the next spelling
      }
    }
    if (text === null) return missing()
    if (text.length > INDEX_TEXT_CAP) {
      const cut = text.slice(0, INDEX_TEXT_CAP)
      text = `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0))}\n${INDEX_CUT_HINT}`
    }
    return fenceWikiText(text)
  }

  async search(query: string): Promise<WikiHit[]> {
    if (!this.isEnabled || !this.store) return []
    try {
      if (Date.now() - this.indexBuiltAt > INDEX_TTL_MS) this.refreshSearch()
    } catch (err) {
      this.disable(err)
      return []
    }
    const local = this.searchIndex?.search(query, 5) ?? []
    let extra: WikiHit[] = []
    try {
      extra = (await this.opts.extraSearch?.(query)) ?? []
    } catch {
      // LLM Wiki being down only narrows the results
    }
    return mergeHits(local, extra)
  }

  /** a page by path id (work/koica-health, entities/koica) or, for older callers, by our own slug */
  read(id: string): { ok: true; page: string } | { ok: false; error: string } {
    if (!this.isEnabled || !this.store) return { ok: false, error: WIKI_UNAVAILABLE }
    const [folder, ...rest] = id.split('/')
    const ownSlug =
      rest.length === 1 && OWN_FOLDERS.has(folder!) ? rest[0]! : id.includes('/') ? null : id
    try {
      if (ownSlug !== null) {
        const page = this.store.readPage(ownSlug)
        // the source list is for the wiki itself; the assistant does not need it
        return page
          ? { ok: true, page: fenceWikiText(serializePage(page).replace(/^sources: .*\n/m, '')) }
          : { ok: false, error: `no wiki page: ${id}` }
      }
      const file = resolveWikiFile(this.store.wikiDir, id)
      if (!file) return { ok: false, error: `no wiki page: ${id}` }
      return { ok: true, page: fenceWikiText(readFileSync(file, 'utf8').slice(0, READ_CAP)) }
    } catch (err) {
      this.disable(err)
      return { ok: false, error: WIKI_UNAVAILABLE }
    }
  }

  /** write the points as a dated note under raw/genoffice-notes and learn it right away */
  async remember(points: string[], work?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isEnabled || !this.store) return { ok: false, error: WIKI_UNAVAILABLE }
    const clean = points
      .map((p) => maskSensitive(String(p)).trim())
      .filter(Boolean)
      .slice(0, 20)
    if (clean.length === 0) return { ok: false, error: 'nothing to remember' }
    const d = new Date()
    const path = join(this.store.notesDir, `${todayIso(d)}-${String(d.getTime()).slice(-6)}.md`)
    const head = work ? `업무: ${maskSensitive(work)}\n` : ''
    try {
      writeFileSync(path, `${head}${clean.map((p) => `- ${p}`).join('\n')}\n`, 'utf8')
      this.schedule({ path, dueAt: Date.now(), kind: 'note' })
    } catch (err) {
      this.disable(err)
      return { ok: false, error: WIKI_UNAVAILABLE }
    }
    return { ok: true }
  }
}
