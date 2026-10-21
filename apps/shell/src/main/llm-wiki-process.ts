import { randomBytes } from 'node:crypto'
import type { WikiHit, WikiHitKind } from '@genoffice/work-wiki'

export interface ChildLike {
  pid?: number | undefined
  on(event: 'exit', cb: (code: number | null) => void): unknown
  kill(): boolean
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** the pid of the program this app started, kept in a file so a crash cannot strand it */
export interface StalePid {
  read(): number | null
  write(pid: number): void
  clear(): void
  isLlmWiki(pid: number): boolean
  kill(pid: number): void
}

export interface LlmWikiProcessOptions {
  exePath: string
  projectId: string
  token?: string
  spawn: (exe: string, env: NodeJS.ProcessEnv) => ChildLike
  fetch: FetchLike
  pickPorts: () => Promise<{ api: number; clip: number }>
  stale?: StalePid
  extraEnv?: NodeJS.ProcessEnv
  healthTimeoutMs?: number
  pollMs?: number
  quitWaitMs?: number
  maxRestarts?: number
  backoffMs?: number[]
  log?: (msg: string) => void
}

export type LlmWikiState = 'stopped' | 'starting' | 'running' | 'failed'
export interface LlmWikiStatus {
  state: LlmWikiState
  reason?: string
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const KIND_BY_FOLDER: Record<string, WikiHitKind> = {
  entities: 'entity',
  concepts: 'concept',
  sources: 'source',
}

/** one LLM Wiki search result as a wiki hit; null for anything that is not a page under wiki/ */
export function hitOfSearchResult(raw: unknown): WikiHit | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const path = typeof r.path === 'string' ? r.path.replace(/\\/g, '/') : ''
  if (!path.startsWith('wiki/') || !path.endsWith('.md')) return null
  const id = path.slice('wiki/'.length, -'.md'.length)
  return {
    id,
    kind: KIND_BY_FOLDER[id.split('/')[0]!] ?? 'other',
    title: typeof r.title === 'string' && r.title ? r.title : id,
    summary: typeof r.snippet === 'string' ? r.snippet.slice(0, 160) : '',
    score: typeof r.score === 'number' ? r.score : 0,
  }
}

export class LlmWikiProcess {
  private child: ChildLike | null = null
  private ports: { api: number; clip: number } | null = null
  private state: LlmWikiState = 'stopped'
  private reason: string | undefined
  private restarts = 0
  private stopping = false
  private readonly token: string

  constructor(private readonly o: LlmWikiProcessOptions) {
    this.token = o.token ?? randomBytes(24).toString('hex')
  }

  status(): LlmWikiStatus {
    return this.reason ? { state: this.state, reason: this.reason } : { state: this.state }
  }

  private base(): string {
    return `http://127.0.0.1:${this.ports!.api}`
  }

  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.o.extraEnv,
      LLM_WIKI_MANAGED: '1',
      LLM_WIKI_API_TOKEN: this.token,
      LLM_WIKI_API_PORT: String(this.ports!.api),
      LLM_WIKI_CLIP_PORT: String(this.ports!.clip),
    }
  }

  private fail(reason: string): void {
    this.state = 'failed'
    this.reason = reason
    this.o.log?.(`llm wiki: ${reason}`)
  }

  /** start (or restart after a crash); false when it did not come up */
  async start(): Promise<boolean> {
    this.stopping = false
    this.state = 'starting'
    this.reason = undefined
    try {
      this.reapStale()
      this.ports = await this.o.pickPorts()
      const child = this.o.spawn(this.o.exePath, this.env())
      this.child = child
      if (child.pid) this.o.stale?.write(child.pid)
      child.on('exit', (code) => void this.onExit(child, code))
      if (!(await this.waitHealthy())) {
        this.fail('health check timed out')
        this.child = null // its exit is expected here, not a crash to restart from
        child.kill()
        return false
      }
      this.state = 'running'
      return true
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  private reapStale(): void {
    const s = this.o.stale
    if (!s) return
    const pid = s.read()
    if (pid && s.isLlmWiki(pid)) s.kill(pid)
    s.clear()
  }

  private async waitHealthy(): Promise<boolean> {
    const until = Date.now() + (this.o.healthTimeoutMs ?? 30_000)
    while (Date.now() < until) {
      try {
        const r = await this.o.fetch(`${this.base()}/health`)
        if (r.ok) return true
      } catch {
        // not listening yet
      }
      await sleep(this.o.pollMs ?? 250)
    }
    return false
  }

  private async onExit(child: ChildLike, code: number | null): Promise<void> {
    if (this.child !== child) return
    this.child = null
    if (this.stopping) {
      this.state = 'stopped'
      return
    }
    const max = this.o.maxRestarts ?? 3
    if (this.restarts >= max) {
      this.fail(`exited unexpectedly (code ${code ?? 'none'}), gave up after ${max} restarts`)
      return
    }
    const wait = (this.o.backoffMs ?? [1000, 3000, 9000])[this.restarts] ?? 9000
    this.restarts++
    this.state = 'starting'
    await sleep(wait)
    if (!this.stopping) await this.start()
  }

  private async call(path: string, method: string, body?: unknown) {
    return this.o.fetch(`${this.base()}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  /** ask it to quit, wait, and kill it if it does not; never throws */
  async stopAndWait(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (child && this.ports) {
      const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()))
      try {
        await this.call('/app/quit', 'POST')
      } catch {
        // already gone
      }
      const done = await Promise.race([
        exited.then(() => true),
        sleep(this.o.quitWaitMs ?? 5000).then(() => false),
      ])
      if (!done) child.kill()
    }
    this.child = null
    this.o.stale?.clear()
    this.state = 'stopped'
  }

  /** bring its window forward */
  async show(): Promise<boolean> {
    if (this.state !== 'running') return false
    try {
      return (await this.call('/app/show', 'POST')).ok
    } catch {
      return false
    }
  }

  /** ask it to rebuild the wiki index from the pages on disk; false when it is not running */
  async rebuildIndex(): Promise<boolean> {
    if (this.state !== 'running') return false
    try {
      const r = await this.call(
        `/projects/${encodeURIComponent(this.o.projectId)}/index/rebuild`,
        'POST',
      )
      return r.ok
    } catch {
      return false
    }
  }

  /** its own search (keyword + vector), as wiki hits; empty when it is not running */
  async search(query: string, topK = 5): Promise<WikiHit[]> {
    if (this.state !== 'running') return []
    try {
      const r = await this.call(
        `/projects/${encodeURIComponent(this.o.projectId)}/search`,
        'POST',
        {
          query,
          topK,
        },
      )
      if (!r.ok) return []
      const body = (await r.json()) as { results?: unknown[] }
      return (body.results ?? []).map(hitOfSearchResult).filter((h): h is WikiHit => h !== null)
    } catch {
      return []
    }
  }
}
