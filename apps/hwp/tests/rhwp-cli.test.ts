/** @vitest-environment node */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { runRhwp, type RhwpSpawn } from '../src/main/rhwp-cli'

interface FakeChild extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  kill(): boolean
}

/** a child that prints `stdout`/`stderr` and exits with `code` on the next tick */
function fakeProcess(stdout: string, stderr: string, code: number | null): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  setImmediate(() => {
    if (stdout) child.stdout.write(stdout)
    if (stderr) child.stderr.write(stderr)
    child.stdout.end()
    child.stderr.end()
    child.emit('close', code)
  })
  return child
}

const spawnWith = (child: FakeChild) =>
  vi.fn<RhwpSpawn>(() => child as unknown as ChildProcessWithoutNullStreams)

describe('runRhwp', () => {
  it('spawns the binary with the argument array (no shell) and parses the envelope', async () => {
    const spawnImpl = spawnWith(
      fakeProcess('{"schemaVersion":"1.0","pageCount":6,"untrustedFields":[]}\n', '', 0),
    )
    const result = await runRhwp('/bin/rhwp', ['explain', 'doc.hwpx', '--json'], { spawnImpl })
    expect(spawnImpl).toHaveBeenCalledWith('/bin/rhwp', ['explain', 'doc.hwpx', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(result).toEqual({
      exitCode: 0,
      envelope: { schemaVersion: '1.0', pageCount: 6, untrustedFields: [] },
      stderr: '',
    })
  })

  it('keeps exit 1/2/3 as results with stderr and the envelope when one was printed', async () => {
    const usage = await runRhwp('/bin/rhwp', ['edit', 'x'], {
      spawnImpl: spawnWith(fakeProcess('', '알 수 없는 옵션: --bogus\n', 2)),
    })
    expect(usage).toEqual({ exitCode: 2, envelope: null, stderr: '알 수 없는 옵션: --bogus\n' })

    const negative = await runRhwp('/bin/rhwp', ['verify', 'x', '--json'], {
      spawnImpl: spawnWith(fakeProcess('{"schemaVersion":"1.0","verdict":"fail"}', '', 3)),
    })
    expect(negative.exitCode).toBe(3)
    expect(negative.envelope).toMatchObject({ verdict: 'fail' })

    const runtime = await runRhwp('/bin/rhwp', ['explain', 'nope'], {
      spawnImpl: spawnWith(fakeProcess('', '오류: 파일을 읽을 수 없습니다', 1)),
    })
    expect(runtime.exitCode).toBe(1)
  })

  it('returns a null envelope when stdout is not a JSON object', async () => {
    const result = await runRhwp('/bin/rhwp', ['--version'], {
      spawnImpl: spawnWith(fakeProcess('rhwp v0.8.6\n', '', 0)),
    })
    expect(result.envelope).toBeNull()
  })

  it('rejects unexpected exit codes instead of inventing a contract for them', async () => {
    await expect(
      runRhwp('/bin/rhwp', ['explain'], { spawnImpl: spawnWith(fakeProcess('', 'boom', 101)) }),
    ).rejects.toThrow(/exited with unexpected code 101/)
    await expect(
      runRhwp('/bin/rhwp', ['explain'], { spawnImpl: spawnWith(fakeProcess('', '', null)) }),
    ).rejects.toThrow(/killed by a signal/)
  })

  it('rejects with the binary path when it cannot be spawned', async () => {
    const child = new EventEmitter() as FakeChild
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    const spawnImpl = vi.fn<RhwpSpawn>(() => {
      setImmediate(() =>
        child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
      )
      return child as unknown as ChildProcessWithoutNullStreams
    })
    await expect(runRhwp('/missing/rhwp.exe', ['explain'], { spawnImpl })).rejects.toThrow(
      /rhwp binary not found or not executable: \/missing\/rhwp\.exe \(ENOENT\)/,
    )
  })

  it('kills the child and rejects on timeout', async () => {
    const child = new EventEmitter() as FakeChild
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.killed = false
    child.kill = () => {
      child.killed = true
      return true
    }
    await expect(
      runRhwp('/bin/rhwp', ['explain', 'big.hwp'], { spawnImpl: spawnWith(child), timeoutMs: 30 }),
    ).rejects.toThrow(/rhwp explain timed out after 30ms/)
    expect(child.killed).toBe(true)
  })

  it('refuses password flags on any path', async () => {
    const spawnImpl = vi.fn<RhwpSpawn>()
    await expect(
      runRhwp('/bin/rhwp', ['explain', 'x', '--password-stdin'], { spawnImpl }),
    ).rejects.toThrow(/password/)
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
