import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamLibrary, TeamLibraryError } from '../src/main/team-library'
import { TeamSync } from '../src/main/team-sync'
import type { TeamFolders } from '../src/shared/team-library-api'

let root: string
let folders: TeamFolders
let library: TeamLibrary
const queues: TeamSync[] = []
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'team-sync-'))
  folders = {
    templates: join(root, 'templates'),
    documents: join(root, 'documents'),
    memberName: '팀원',
    autoSync: true,
  }
  await Promise.all([mkdir(folders.templates), mkdir(folders.documents)])
  library = new TeamLibrary(
    () => folders,
    () => {},
    () => join(root, 'drafts'),
    async (_name, bytes) => ({ ok: true, bytes, counts: {} }),
  )
})
afterEach(async () => {
  queues.forEach((queue) => queue.stop())
  queues.length = 0
  await rm(root, { recursive: true, force: true })
})
function queue() {
  const next = new TeamSync(join(root, 'queue.json'), library, () => '제안 프로젝트')
  queues.push(next)
  return next
}

describe('automatic team uploads', () => {
  it('coalesces repeated saves and updates a stable NAS copy', async () => {
    const source = join(root, '보고서.docx')
    await writeFile(source, 'one')
    const sync = queue()
    sync.enqueue(source)
    sync.enqueue(source)
    await sync.drain()
    expect(sync.status()).toHaveLength(1)
    expect(sync.status()[0].status).toBe('synced')
    const target = sync.status()[0].remotePath!
    await writeFile(source, 'two')
    sync.enqueue(source)
    await sync.drain()
    expect(sync.status()[0].remotePath).toBe(target)
    expect(await readFile(target, 'utf8')).toBe('two')
  })

  it('retains failed uploads across restart and retries after NAS recovery', async () => {
    const source = join(root, '보고서.docx')
    await writeFile(source, 'saved locally')
    const original = folders.documents
    folders = { ...folders, documents: join(root, 'disconnected') }
    const sync = queue()
    sync.enqueue(source)
    await sync.drain()
    expect(sync.status()[0].status).toBe('error')
    expect(await readFile(source, 'utf8')).toBe('saved locally')
    sync.stop()
    folders = { ...folders, documents: original }
    const restarted = queue()
    await restarted.drain()
    expect(restarted.status()[0].status).toBe('synced')
    expect(await readFile(restarted.status()[0].remotePath!, 'utf8')).toBe('saved locally')
  })

  it('does not upload when automatic sending is disabled', async () => {
    const sync = queue()
    folders = { ...folders, autoSync: false }
    sync.enqueue(join(root, 'private.docx'))
    await sync.drain()
    expect(sync.status()).toEqual([])
  })

  it('keeps a newer save pending when an older transfer finishes', async () => {
    const source = join(root, '보고서.docx')
    await writeFile(source, 'one')
    const sync = queue()
    let complete!: (path: string) => void
    const upload = vi.spyOn(library, 'syncDocument').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    sync.enqueue(source)
    const running = sync.drain()
    await vi.waitFor(() => expect(upload).toHaveBeenCalled())
    sync.enqueue(source)
    complete('old remote')
    await running
    expect(sync.status()[0].status).toBe('pending')
    await sync.drain()
    expect(sync.status()[0].status).toBe('synced')
    expect(upload).toHaveBeenCalledTimes(2)
  })
})

describe('documents that cannot be masked', () => {
  it('are recorded once as not maskable and not retried', async () => {
    const source = join(root, '공문.hwp')
    await writeFile(source, 'binary hwp')
    const spy = vi.spyOn(library, 'syncDocument')
    const sync = queue()
    sync.enqueue(source)
    await sync.drain()
    await sync.drain()
    expect(spy).not.toHaveBeenCalled()
    expect(sync.status()[0]).toMatchObject({
      name: '공문.hwp',
      status: 'error',
      error: 'not-maskable',
    })
    sync.retry()
    await sync.drain()
    expect(spy).not.toHaveBeenCalled()
  })

  it('a document whose masking failed is not retried until it is saved again', async () => {
    const source = join(root, 'a.docx')
    await writeFile(source, 'x')
    const spy = vi
      .spyOn(library, 'syncDocument')
      .mockRejectedValue(Object.assign(new TeamLibraryError('masking-failed')))
    const sync = queue()
    sync.enqueue(source)
    await sync.drain()
    await sync.drain()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(sync.status()[0]).toMatchObject({ status: 'error', error: 'masking-failed' })
    sync.enqueue(source)
    await sync.drain()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
