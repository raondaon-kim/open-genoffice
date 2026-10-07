/**
 * SHA fence around an operation that was prepared from a snapshot: if the
 * studio's documentSha256 moved while `run` was in flight (the user typed),
 * the result must not be applied — the caller re-reads and retries.
 */

export type FenceOutcome<T> =
  { ok: true; sha: string; value: T } | { ok: false; before: string; after: string }

export async function withFence<T>(
  editor: { getDocumentState(): Promise<{ documentSha256: string }> },
  run: (sha: string) => Promise<T>,
): Promise<FenceOutcome<T>> {
  const before = (await editor.getDocumentState()).documentSha256
  const value = await run(before)
  const after = (await editor.getDocumentState()).documentSha256
  return after === before ? { ok: true, sha: before, value } : { ok: false, before, after }
}
