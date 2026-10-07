/** @vitest-environment node */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createHwpFromMarkdown, mcpCall, type SpawnLike } from '../src/main/hwpforge-client'

type Line = { jsonrpc: string; id?: number; method: string; params?: Record<string, unknown> }
type Reply = (message: unknown) => void
type Script = (line: Line, reply: Reply, child: FakeChild) => void

interface FakeChild extends EventEmitter {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  kill(): boolean
}

/** A child process that answers JSON-RPC lines on stdin according to `script`. */
function fakeChild(script: Script): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  let buffer = ''
  child.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!raw) continue
      script(
        JSON.parse(raw) as Line,
        (msg) => child.stdout.write(`${JSON.stringify(msg)}\n`),
        child,
      )
    }
  })
  return child
}

/** Scripted server: initialize → ok, notifications → silent, tools/call → `onCall` */
const answering =
  (onCall: (params: Record<string, unknown>) => unknown): Script =>
  (line, reply) => {
    if (line.method === 'initialize') {
      reply({ jsonrpc: '2.0', id: line.id, result: { protocolVersion: '2025-03-26' } })
    } else if (line.method === 'tools/call') {
      reply({ jsonrpc: '2.0', id: line.id, result: onCall(line.params ?? {}) })
    }
  }

const spawnWith = (child: FakeChild) =>
  vi.fn<SpawnLike>(() => child as unknown as ChildProcessWithoutNullStreams)

describe('mcpCall', () => {
  it('spawns the binary directly, drives initialize + tools/call and returns the text', async () => {
    const child = fakeChild(
      answering((params) => ({
        content: [{ type: 'text', text: `converted ${(params as { name: string }).name}` }],
      })),
    )
    const spawnImpl = spawnWith(child)
    const text = await mcpCall(
      'hwpforge_convert',
      { markdown: 'x.md' },
      {
        binPath: '/bin/hwpforge-mcp',
        spawnImpl,
      },
    )
    expect(text).toBe('converted hwpforge_convert')
    expect(spawnImpl).toHaveBeenCalledWith('/bin/hwpforge-mcp', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    expect(child.killed).toBe(true)
  })

  it('throws when the tool reports isError', async () => {
    const child = fakeChild(
      answering(() => ({ isError: true, content: [{ type: 'text', text: 'bad markdown' }] })),
    )
    await expect(
      mcpCall('hwpforge_convert', {}, { binPath: '/bin/x', spawnImpl: spawnWith(child) }),
    ).rejects.toThrow(/hwpforge hwpforge_convert failed: bad markdown/)
  })

  it('rejects with the binary path when the process cannot be spawned', async () => {
    const child = fakeChild(() => undefined)
    const spawnImpl = vi.fn<SpawnLike>(() => {
      setImmediate(() =>
        child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
      )
      return child as unknown as ChildProcessWithoutNullStreams
    })
    await expect(
      mcpCall('hwpforge_convert', {}, { binPath: '/missing/hwpforge-mcp.exe', spawnImpl }),
    ).rejects.toThrow(/not found or not executable: \/missing\/hwpforge-mcp\.exe \(ENOENT\)/)
  })

  it('times out when the server never answers', async () => {
    const child = fakeChild(() => undefined)
    await expect(
      mcpCall(
        'hwpforge_convert',
        {},
        { binPath: '/bin/x', spawnImpl: spawnWith(child), timeoutMs: 50 },
      ),
    ).rejects.toThrow(/hwpforge initialize timed out/)
    expect(child.killed).toBe(true)
  })
})

describe('createHwpFromMarkdown', () => {
  it('writes the markdown, calls hwpforge_convert with is_file and returns the output path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hwpforge-'))
    try {
      let seen: Record<string, unknown> | null = null
      const child = fakeChild(
        answering((params) => {
          const args = (params as { arguments: Record<string, unknown> }).arguments
          seen = args
          writeFileSync(args.output_path as string, 'HWPX')
          return { content: [{ type: 'text', text: 'ok' }] }
        }),
      )
      const result = await createHwpFromMarkdown('# 제목\n\n본문', dir, '주간 보고서', {
        binPath: '/bin/x',
        spawnImpl: spawnWith(child),
      })
      expect(result.ok).toBe(true)
      expect(result.path).toMatch(/주간_보고서-\d+\.hwpx$/)
      expect(existsSync(result.path!)).toBe(true)
      expect(seen).toMatchObject({ is_file: true })
      expect((seen as unknown as { markdown: string }).markdown).toMatch(/주간_보고서-\d+\.md$/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a missing output file as a failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hwpforge-'))
    try {
      const child = fakeChild(answering(() => ({ content: [{ type: 'text', text: 'ok' }] })))
      const result = await createHwpFromMarkdown('x', dir, 'doc', {
        binPath: '/bin/x',
        spawnImpl: spawnWith(child),
      })
      expect(result).toEqual({ ok: false, error: 'hwpforge did not produce an output file' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects empty markdown without spawning', async () => {
    const spawnImpl = vi.fn<SpawnLike>()
    const result = await createHwpFromMarkdown('   ', tmpdir(), 'doc', {
      binPath: '/bin/x',
      spawnImpl,
    })
    expect(result).toEqual({ ok: false, error: 'hwpforge: markdown is empty' })
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
