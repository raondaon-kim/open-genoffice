import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { fenceWikiText } from '../fence'
import { serializePage, todayIso } from '../page'
import { WIKI_UNAVAILABLE } from '../types'
import type { WikiHit } from '../types'
import { readForeignDocs, resolveWikiFile } from './foreign'
import { learn } from './learn'
import type { WikiComplete } from './learn'
import { maskSensitive } from './mask'
import { buildFirstDigest, buildRevisionDigest, DocumentRegistry } from './registry'
import { buildCatalog, docOfPage, mergeHits, WikiSearch } from './search'
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
}

interface Job {
  path: string
  dueAt: number
  kind: 'document' | 'note'
}

const LEARNED = new Set(['.hwp', '.hwpx', '.docx', '.pptx'])
const norm = (p: string) => resolve(p).replace(/\\/g, '/').toLowerCase()
const DEFAULT_DEBOUNCE_MS = 120_000
const INDEX_TTL_MS = 30_000
const READ_CAP = 12_000
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
    try {
      const text =
        job.kind === 'note' ? readFileSync(job.path, 'utf8') : await this.opts.extractText(job.path)
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
    } catch (err) {
      if (attempt < 2 && this.isEnabled) return this.runJob(job, attempt + 1)
      const msg = err instanceof Error ? err.message : String(err)
      // throws when the folder is gone: runDue turns that into disable()
      store.appendLog(`실패: ${title} — ${msg}`.slice(0, 300))
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
      return this.foreignCount > 0
        ? `${own}\n- LLM Wiki 자료 페이지 ${this.foreignCount}개 (인물·기관·개념·자료 요약): wiki_search로 찾으세요`.trimStart()
        : own
    } catch (err) {
      this.disable(err)
      return ''
    }
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
