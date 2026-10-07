import { describe, expect, it, vi } from 'vitest'
import { ensureSnapshot, MAX_SNAPSHOT_BYTES, SnapshotStack } from '../src/renderer/ai/snapshots'

function editorWith(states: string[], bytesFor: (sha: string) => Uint8Array) {
  let i = 0
  const exportHwpx = vi.fn(async () => bytesFor(states[Math.min(i, states.length - 1)]))
  return {
    getDocumentState: vi.fn(async () => ({
      documentSha256: states[Math.min(i++, states.length - 1)],
    })),
    exportHwpx,
  }
}
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const bytes = (sha: string) => new TextEncoder().encode(sha.slice(0, 4))

describe('SnapshotStack', () => {
  it("exports in the document's own format — documentSha256 of an .hwp hashes exportHwp()", async () => {
    const stack = new SnapshotStack()
    const hwp5 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])
    const editor = {
      getDocumentState: vi.fn(async () => ({ documentSha256: A, format: 'hwp' as const })),
      exportHwp: vi.fn(async () => hwp5),
      exportHwpx: vi.fn(async () => new Uint8Array([0x50, 0x4b])),
    }
    const snapshot = await stack.capture(editor)
    expect(Array.from(snapshot.bytes)).toEqual(Array.from(hwp5))
    expect(editor.exportHwpx).not.toHaveBeenCalled()
  })

  it('captures once per documentSha256 and reuses the cached bytes', async () => {
    const stack = new SnapshotStack()
    const editor = editorWith([A, A, B], bytes)
    const first = await stack.capture(editor)
    const second = await stack.capture(editor)
    const third = await stack.capture(editor)
    expect(first.sha).toBe(A)
    expect(second).toBe(first)
    expect(third.sha).toBe(B)
    expect(editor.exportHwpx).toHaveBeenCalledTimes(2)
  })

  it('keeps at most `limit` entries, dropping the oldest, and pops newest first', () => {
    const stack = new SnapshotStack(2)
    stack.push({ sha: '1', bytes: bytes('1') })
    stack.push({ sha: '2', bytes: bytes('2') })
    stack.push({ sha: '3', bytes: bytes('3') })
    expect(stack.depth).toBe(2)
    expect(stack.pop()?.sha).toBe('3')
    expect(stack.pop()?.sha).toBe('2')
    expect(stack.pop()).toBeNull()
  })

  it('refuses snapshots above the size cap', async () => {
    const stack = new SnapshotStack()
    const editor = editorWith([A], () => new Uint8Array(MAX_SNAPSHOT_BYTES + 1))
    await expect(stack.capture(editor)).rejects.toThrow(/too large/)
  })

  it('shares one export between concurrent captures', async () => {
    const stack = new SnapshotStack()
    const editor = editorWith([A], bytes)
    const all = await Promise.all([
      stack.capture(editor),
      stack.capture(editor),
      stack.capture(editor),
    ])
    expect(all[0]).toBe(all[1])
    expect(all[1]).toBe(all[2])
    expect(editor.exportHwpx).toHaveBeenCalledTimes(1)
  })
})

describe('ensureSnapshot', () => {
  it('sends the bytes to main once and remembers that', async () => {
    const stack = new SnapshotStack()
    const editor = editorWith([A], bytes)
    const transport = { aiSnapshot: vi.fn(async () => ({ ok: true as const })) }
    await ensureSnapshot(editor, stack, transport)
    await ensureSnapshot(editor, stack, transport)
    expect(transport.aiSnapshot).toHaveBeenCalledTimes(1)
    const request = transport.aiSnapshot.mock.calls[0][0]
    expect(request.sha).toBe(A)
    // compare values: jsdom and node hand out Uint8Arrays from different realms
    expect(Array.from(new Uint8Array(request.data))).toEqual(Array.from(bytes(A)))
    expect(stack.isSent(A)).toBe(true)
  })

  it('uploads once even when three tools ask at the same time', async () => {
    const stack = new SnapshotStack()
    const editor = editorWith([A], bytes)
    let resolveUpload: (() => void) | null = null
    const transport = {
      aiSnapshot: vi.fn(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolveUpload = () => resolve({ ok: true })
          }),
      ),
    }
    const pending = Promise.all([
      ensureSnapshot(editor, stack, transport),
      ensureSnapshot(editor, stack, transport),
      ensureSnapshot(editor, stack, transport),
    ])
    await new Promise((r) => setTimeout(r, 0))
    resolveUpload!()
    await pending
    expect(transport.aiSnapshot).toHaveBeenCalledTimes(1)
  })

  it('re-exports and retries once when main reports a digest mismatch, then fails loudly', async () => {
    const stack = new SnapshotStack()
    const editor = editorWith([A], bytes)
    const transport = {
      aiSnapshot: vi
        .fn<
          (r: {
            sha: string
            data: ArrayBuffer
          }) => Promise<{ ok: true } | { ok: false; error: string }>
        >()
        .mockResolvedValueOnce({ ok: false, error: 'snapshot digest does not match its key' })
        .mockResolvedValueOnce({ ok: true }),
    }
    await ensureSnapshot(editor, stack, transport)
    expect(editor.exportHwpx).toHaveBeenCalledTimes(2)
    expect(transport.aiSnapshot).toHaveBeenCalledTimes(2)

    const failing = {
      aiSnapshot: vi.fn(async () => ({ ok: false as const, error: 'document too large' })),
    }
    await expect(
      ensureSnapshot(editorWith([B], bytes), new SnapshotStack(), failing),
    ).rejects.toThrow(/too large/)
  })
})
