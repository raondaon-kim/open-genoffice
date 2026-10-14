import { existsSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { fenceWikiText } from '../fence'
import { serializePage, todayIso } from '../page'
import { WIKI_UNAVAILABLE } from '../types'
import type { WikiHit } from '../types'
import { learn } from './learn'
import type { WikiComplete } from './learn'
import { maskSensitive } from './mask'
import { buildFirstDigest, buildRevisionDigest, DocumentRegistry } from './registry'
import { buildCatalog, WikiSearch } from './search'
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
  /** watch raw/sources for dropped files (default true) */
  watch?: boolean
  /** wait after a file appears in raw/sources before learning it (default 10 s) */
  sourceSettleMs?: number
  log?: (msg: string) => void
}

interface Job {
  path: string
  dueAt: number
  kind: 'document' | 'source' | 'note'
}

const LEARNED = new Set(['.hwp', '.hwpx', '.docx', '.pptx'])
const SOURCE_EXT = new Set([...LEARNED, '.pdf', '.md', '.txt'])
const norm = (p: string) => resolve(p).replace(/\\/g, '/').toLowerCase()
const DEFAULT_DEBOUNCE_MS = 120_000
const SOURCE_SETTLE_MS = 10_000

export class WorkWikiEngine {
  private readonly opts: EngineOptions
  private readonly debounceMs: number
  private store: WikiStore | null = null
  private registry: DocumentRegistry | null = null
  private searchIndex: WikiSearch | null = null
  private readonly jobs = new Map<string, Job>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private running: Promise<void> | null = null
  private watcher: FSWatcher | null = null
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
    if (this.opts.watch !== false) this.watchSources()
    this.refreshSearch()
    return true
  }

  /** no new job starts after this; a running job finishes (stopAndWait waits for it) */
  stop(): void {
    this.isEnabled = false
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.watcher?.close()
    this.watcher = null
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
    const p = norm(path)
    const root = norm(this.opts.root)
    const raw = norm(join(this.opts.root, 'raw', 'sources'))
    const ext = extname(path).toLowerCase()
    if (kind === 'document') {
      if (!LEARNED.has(ext)) return false
      // the wiki's own files are learned only from raw/sources
      if (p.startsWith(`${root}/`) && !p.startsWith(`${raw}/`)) return false
    } else if (!SOURCE_EXT.has(ext)) return false
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

  private watchSources(): void {
    const store = this.store!
    try {
      this.watcher = watch(store.rawDir, { recursive: true }, (_event, name) => {
        if (!name) return
        const path = join(store.rawDir, name.toString())
        // notes are queued by remember()
        if (norm(path).startsWith(`${norm(store.notesDir)}/`)) return
        if (existsSync(path) && this.accepts(path, 'source')) {
          try {
            this.schedule({
              path,
              dueAt: Date.now() + (this.opts.sourceSettleMs ?? SOURCE_SETTLE_MS),
              kind: 'source',
            })
          } catch (err) {
            this.disable(err)
          }
        }
      })
      this.watcher.on('error', (err) => this.disable(err))
    } catch (err) {
      this.opts.log?.(`work wiki watch: ${String(err)}`)
    }
  }

  private refreshSearch(): void {
    this.searchIndex = this.store ? new WikiSearch(this.store.listPages()) : null
  }

  catalog(): string {
    if (!this.isEnabled || !this.store) return ''
    try {
      return buildCatalog(this.store.listPages())
    } catch (err) {
      this.disable(err)
      return ''
    }
  }

  search(query: string): WikiHit[] {
    return this.isEnabled ? (this.searchIndex?.search(query) ?? []) : []
  }

  read(slug: string): { ok: true; page: string } | { ok: false; error: string } {
    if (!this.isEnabled || !this.store) return { ok: false, error: WIKI_UNAVAILABLE }
    let page
    try {
      page = this.store.readPage(slug)
    } catch (err) {
      this.disable(err)
      return { ok: false, error: WIKI_UNAVAILABLE }
    }
    return page
      ? { ok: true, page: fenceWikiText(serializePage(page)) }
      : { ok: false, error: `no wiki page: ${slug}` }
  }

  /** write the points as a dated note under raw/sources/genoffice and learn it right away */
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
