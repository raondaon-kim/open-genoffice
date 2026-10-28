import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute } from 'node:path'
import type { TeamErrorCode, TeamSyncEntry } from '../shared/team-library-api'
import { TeamLibrary, teamResult, teamUploadable } from './team-library'

/** failures a retry cannot fix: the document has to change (a new save queues it again) */
const PERMANENT = new Set<TeamErrorCode>([
  'not-maskable',
  'masking-failed',
  'unsupported',
  'invalid-path',
])
const permanent = (job: TeamSyncEntry) =>
  job.status === 'error' && !!job.error && PERMANENT.has(job.error)

interface SyncJob extends TeamSyncEntry {
  sourcePath: string
  memberName: string
  revision: number
}

/** A durable, serial queue; failed NAS writes never affect local document saves. */
export class TeamSync {
  private readonly jobs = new Map<string, SyncJob>()
  private clientId = randomUUID()
  private running = false
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>

  constructor(
    private readonly statePath: string,
    private readonly library: TeamLibrary,
    private readonly projectName: (path: string) => string,
  ) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
        clientId?: unknown
        jobs?: unknown
      }
      if (typeof state.clientId === 'string') this.clientId = state.clientId as typeof this.clientId
      if (Array.isArray(state.jobs)) {
        for (const value of state.jobs) {
          const job = value as SyncJob
          if (
            /^[a-f0-9]{16}$/.test(job.id) &&
            typeof job.sourcePath === 'string' &&
            isAbsolute(job.sourcePath) &&
            typeof job.projectName === 'string' &&
            typeof job.memberName === 'string' &&
            typeof job.updatedAt === 'string' &&
            Number.isSafeInteger(job.revision)
          )
            this.jobs.set(job.id, {
              ...job,
              status: job.status === 'synced' ? 'synced' : 'pending',
            })
        }
      }
    } catch {
      /* A missing queue is normal on first use. */
    }
  }

  start(): void {
    this.interval = setInterval(() => {
      void this.drain()
    }, 30_000)
    this.interval.unref()
    void this.drain()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    clearInterval(this.interval)
  }

  enqueue(sourcePath: string): void {
    const settings = this.library.getFolders()
    if (!settings.autoSync || !settings.documents || !settings.memberName) return
    const id = createHash('sha256')
      .update(`${this.clientId}\0${sourcePath}`)
      .digest('hex')
      .slice(0, 16)
    const previous = this.jobs.get(id)
    const maskable = teamUploadable(sourcePath)
    this.jobs.set(id, {
      id,
      sourcePath,
      name: basename(sourcePath),
      projectName: this.projectName(sourcePath),
      memberName: settings.memberName,
      // a format the masker cannot rewrite is shown once and never sent
      status: maskable ? 'pending' : 'error',
      error: maskable ? undefined : 'not-maskable',
      updatedAt: new Date().toISOString(),
      revision: (previous?.revision ?? 0) + 1,
    })
    this.persist()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.drain()
    }, 600)
    this.timer.unref()
  }

  status(): TeamSyncEntry[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100)
      .map(({ id, name, projectName, status, updatedAt, remotePath, error }) => ({
        id,
        name,
        projectName,
        status,
        updatedAt,
        remotePath,
        error,
      }))
  }

  retry(): void {
    for (const job of this.jobs.values()) {
      if (job.status === 'error' && !permanent(job)) job.status = 'pending'
    }
    this.persist()
    void this.drain()
  }

  private persist(): void {
    const finished = Array.from(this.jobs.values())
      .filter((job) => job.status === 'synced')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    for (const job of finished.slice(100)) this.jobs.delete(job.id)
    mkdirSync(dirname(this.statePath), { recursive: true })
    const temporary = `${this.statePath}.tmp`
    writeFileSync(
      temporary,
      JSON.stringify({ clientId: this.clientId, jobs: Array.from(this.jobs.values()) }),
    )
    renameSync(temporary, this.statePath)
  }

  async drain(): Promise<void> {
    if (this.running || this.stopped || !this.library.getFolders().autoSync) return
    this.running = true
    try {
      // Snapshot ids so a disconnected NAS is tried once per cycle, not in a busy loop.
      for (const id of Array.from(this.jobs.keys())) {
        if (this.stopped || !this.library.getFolders().autoSync) break
        const job = this.jobs.get(id)!
        if (job.status === 'synced' || job.status === 'uploading' || permanent(job)) continue
        const revision = job.revision
        job.status = 'uploading'
        const result = await teamResult(() =>
          this.library.syncDocument(job.sourcePath, job.projectName, job.memberName, job.id),
        )
        const latest = this.jobs.get(id)!
        if (latest.revision === revision) {
          latest.status = result.ok ? 'synced' : 'error'
          latest.error = result.ok ? undefined : result.error
          latest.remotePath = result.ok ? result.value : undefined
        }
        this.persist()
      }
    } catch {
      // Persist errors stay visible in memory and are retried on the next cycle.
      for (const job of this.jobs.values()) {
        if (job.status === 'uploading') {
          job.status = 'error'
          job.error = 'unavailable'
        }
      }
    } finally {
      this.running = false
    }
  }
}
