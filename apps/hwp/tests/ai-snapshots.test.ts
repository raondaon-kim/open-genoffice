/** @vitest-environment node */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SnapshotStore, sha256Hex } from '../src/main/ai-snapshots'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ai-snapshots-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const bytesOf = (text: string) => new TextEncoder().encode(text)

describe('SnapshotStore', () => {
  it('writes a verified snapshot under <root>/<owner>/<sha>.hwpx and finds it again', async () => {
    const store = new SnapshotStore({ rootDir: root })
    const bytes = bytesOf('HWPX-1')
    const sha = sha256Hex(bytes)
    const put = await store.put(7, sha, bytes)
    expect(put).toEqual({ ok: true, path: join(root, '7', `${sha}.hwpx`) })
    expect(readFileSync(store.path(7, sha)!)).toEqual(Buffer.from(bytes))
    expect(store.path(7, 'f'.repeat(64))).toBeNull()
    expect(store.path(8, sha)).toBeNull()
  })

  it('rejects a malformed key and a digest mismatch without writing anything', async () => {
    const store = new SnapshotStore({ rootDir: root })
    expect(await store.put(1, 'ABC', bytesOf('x'))).toEqual({
      ok: false,
      error: 'snapshot key must be a lowercase sha256 hex string',
    })
    const wrong = await store.put(1, 'a'.repeat(64), bytesOf('x'))
    expect(wrong).toMatchObject({ ok: false, error: expect.stringMatching(/does not match/) })
    expect(existsSync(join(root, '1'))).toBe(false)
  })

  it('keeps at most maxPerOwner snapshots per owner, evicting the oldest', async () => {
    const store = new SnapshotStore({ rootDir: root, maxPerOwner: 2 })
    const shas: string[] = []
    for (const text of ['a', 'b', 'c']) {
      const bytes = bytesOf(text)
      shas.push(sha256Hex(bytes))
      expect((await store.put(1, shas.at(-1)!, bytes)).ok).toBe(true)
    }
    expect(store.path(1, shas[0])).toBeNull()
    expect(existsSync(join(root, '1', `${shas[0]}.hwpx`))).toBe(false)
    expect(store.path(1, shas[1])).not.toBeNull()
    expect(store.path(1, shas[2])).not.toBeNull()
  })

  it('re-putting an existing snapshot refreshes its recency without rewriting', async () => {
    const store = new SnapshotStore({ rootDir: root, maxPerOwner: 2 })
    const a = bytesOf('a')
    const b = bytesOf('b')
    const c = bytesOf('c')
    await store.put(1, sha256Hex(a), a)
    await store.put(1, sha256Hex(b), b)
    await store.put(1, sha256Hex(a), a) // a is now the most recent
    await store.put(1, sha256Hex(c), c) // evicts b
    expect(store.path(1, sha256Hex(b))).toBeNull()
    expect(store.path(1, sha256Hex(a))).not.toBeNull()
  })

  it('dispose removes one owner, disposeAll removes the root', async () => {
    const store = new SnapshotStore({ rootDir: root })
    const a = bytesOf('a')
    await store.put(1, sha256Hex(a), a)
    await store.put(2, sha256Hex(a), a)
    await store.dispose(1)
    expect(existsSync(join(root, '1'))).toBe(false)
    expect(store.path(1, sha256Hex(a))).toBeNull()
    expect(store.path(2, sha256Hex(a))).not.toBeNull()
    await store.disposeAll()
    expect(existsSync(root)).toBe(false)
  })
})
