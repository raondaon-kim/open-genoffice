import type { AiSnapshotRequest, AiSnapshotResult } from '../../shared/ai-contract'

/**
 * Byte snapshots of the open document, keyed by the studio's documentSha256.
 * One stack serves two purposes: the undo history for AI edits (`undo_ai_edit`
 * reloads the previous bytes — live or file edits alike) and a cache so that
 * consecutive reads of an unchanged document export and upload once.
 */

export interface Snapshot {
  sha: string
  bytes: Uint8Array
}

export interface SnapshotEditor {
  getDocumentState(): Promise<{ documentSha256: string; format?: 'hwp' | 'hwpx' }>
  exportHwp?(): Promise<Uint8Array>
  exportHwpx(): Promise<Uint8Array>
}

export interface SnapshotTransport {
  aiSnapshot(request: AiSnapshotRequest): Promise<AiSnapshotResult>
}

export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024
export const UNDO_LIMIT = 20

export class SnapshotStack {
  private readonly stack: Snapshot[] = []
  private latest: Snapshot | null = null
  private capturing: Promise<Snapshot> | null = null
  private readonly sent = new Set<string>()
  private readonly sending = new Map<string, Promise<AiSnapshotResult>>()
  private readSha: string | null = null

  constructor(private readonly limit = UNDO_LIMIT) {}

  get depth(): number {
    return this.stack.length
  }

  /**
   * bytes for the current document state; exports only when the sha moved.
   * Concurrent callers (get_document_overview runs three queries at once)
   * share one export.
   */
  capture(editor: SnapshotEditor): Promise<Snapshot> {
    if (!this.capturing) {
      this.capturing = this.doCapture(editor).finally(() => {
        this.capturing = null
      })
    }
    return this.capturing
  }

  private async doCapture(editor: SnapshotEditor): Promise<Snapshot> {
    const { documentSha256: sha, format } = await editor.getDocumentState()
    if (this.latest?.sha === sha) return this.latest
    // the studio hashes the document in its source format (an .hwp hashes exportHwp());
    // main checks the digest, so the bytes must be that same export
    const bytes =
      format === 'hwp' && editor.exportHwp ? await editor.exportHwp() : await editor.exportHwpx()
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
      const mb = (bytes.byteLength / 1048576).toFixed(1)
      throw new Error(`The document is too large for the AI tools (${mb} MB > 50 MB).`)
    }
    this.latest = { sha, bytes }
    return this.latest
  }

  /** one upload per sha even when several tools ask at the same time */
  send(sha: string, run: () => Promise<AiSnapshotResult>): Promise<AiSnapshotResult> {
    let pending = this.sending.get(sha)
    if (!pending) {
      pending = run().finally(() => {
        this.sending.delete(sha)
      })
      this.sending.set(sha, pending)
    }
    return pending
  }

  push(snapshot: Snapshot): void {
    this.stack.push(snapshot)
    while (this.stack.length > this.limit) this.stack.shift()
  }

  pop(): Snapshot | null {
    return this.stack.pop() ?? null
  }

  /** after loadFile(bytes): those bytes are the current state */
  noteLoaded(snapshot: Snapshot): void {
    this.latest = snapshot
  }

  /** drop the capture cache (main rejected the bytes) */
  invalidate(): void {
    this.latest = null
  }

  /**
   * the document state the model's coordinates come from: the last state it
   * read, or the result of its own last edit. null until the first read.
   */
  get lastReadSha(): string | null {
    return this.readSha
  }

  noteRead(sha: string): void {
    this.readSha = sha
  }

  /** coordinates taken at lastReadSha are stale once the user moved the document */
  coordinatesStale(currentSha: string): boolean {
    return this.readSha !== null && this.readSha !== currentSha
  }

  isSent(sha: string): boolean {
    return this.sent.has(sha)
  }

  markSent(sha: string): void {
    this.sent.add(sha)
  }

  forgetSent(sha: string): void {
    this.sent.delete(sha)
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** make sure main holds the bytes for the current document state */
export async function ensureSnapshot(
  editor: SnapshotEditor,
  stack: SnapshotStack,
  transport: SnapshotTransport,
): Promise<Snapshot> {
  for (let attempt = 0; ; attempt++) {
    const snapshot = await stack.capture(editor)
    if (stack.isSent(snapshot.sha)) return snapshot
    const sent = await stack.send(snapshot.sha, () =>
      transport.aiSnapshot({ sha: snapshot.sha, data: toArrayBuffer(snapshot.bytes) }),
    )
    if (sent.ok) {
      stack.markSent(snapshot.sha)
      return snapshot
    }
    // a digest mismatch means our cached bytes are stale/corrupt: export again, once
    if (attempt === 0 && /digest/.test(sent.error)) {
      stack.invalidate()
      continue
    }
    throw new Error(sent.error)
  }
}
