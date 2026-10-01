import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Per-webContents cache of document snapshots (HWPX bytes from exportHwpx)
 * that the rhwp CLI reads. The key is the studio's documentSha256, so the
 * renderer can tell without a round trip whether main already has the bytes
 * for the current document state; main recomputes the digest and refuses
 * anything that does not match (renderer bug or transport error).
 *
 * Snapshot paths are managed here, apart from the user-document grants in
 * hwp-main.ts — the CLI only ever reads from this directory.
 */

export const SHA256_HEX = /^[0-9a-f]{64}$/

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface SnapshotStoreOptions {
  rootDir: string
  /** snapshots kept per owner (LRU); default 5 */
  maxPerOwner?: number
}

export type PutResult = { ok: true; path: string } | { ok: false; error: string }

export class SnapshotStore {
  private readonly rootDir: string
  private readonly maxPerOwner: number
  /** owner → shas, oldest first */
  private readonly owners = new Map<number, string[]>()

  constructor(options: SnapshotStoreOptions) {
    this.rootDir = options.rootDir
    this.maxPerOwner = options.maxPerOwner ?? 5
  }

  ownerDir(ownerId: number): string {
    return join(this.rootDir, String(ownerId))
  }

  path(ownerId: number, sha: string): string | null {
    if (!this.owners.get(ownerId)?.includes(sha)) return null
    const path = join(this.ownerDir(ownerId), `${sha}.hwpx`)
    return existsSync(path) ? path : null
  }

  async put(ownerId: number, sha: string, bytes: Uint8Array): Promise<PutResult> {
    if (!SHA256_HEX.test(sha)) {
      return { ok: false, error: 'snapshot key must be a lowercase sha256 hex string' }
    }
    const shas = this.owners.get(ownerId) ?? []
    const path = join(this.ownerDir(ownerId), `${sha}.hwpx`)
    if (shas.includes(sha) && existsSync(path)) {
      this.owners.set(ownerId, [...shas.filter((s) => s !== sha), sha])
      return { ok: true, path }
    }
    const actual = sha256Hex(bytes)
    if (actual !== sha) {
      return {
        ok: false,
        error: `snapshot digest does not match its key (${actual.slice(0, 12)}… ≠ ${sha.slice(0, 12)}…)`,
      }
    }
    try {
      await mkdir(this.ownerDir(ownerId), { recursive: true })
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, bytes)
      await rename(tmp, path)
    } catch (err) {
      return {
        ok: false,
        error: `snapshot write failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    const next = [...shas.filter((s) => s !== sha), sha]
    while (next.length > this.maxPerOwner) {
      const evicted = next.shift()!
      await rm(join(this.ownerDir(ownerId), `${evicted}.hwpx`), { force: true })
    }
    this.owners.set(ownerId, next)
    return { ok: true, path }
  }

  async dispose(ownerId: number): Promise<void> {
    this.owners.delete(ownerId)
    await rm(this.ownerDir(ownerId), { recursive: true, force: true })
  }

  async disposeAll(): Promise<void> {
    this.owners.clear()
    await rm(this.rootDir, { recursive: true, force: true })
  }
}
