import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODEX_CLIENT_CLOSED,
  chatCodexAppServer,
  codexAppServerLaunchArgs,
  resolveCodexBinary,
  setBundledCodexPath,
  waitForTurn,
  type CodexTurnTransport,
  type RpcMessage,
} from '../src/codex-app-server'

const dirs: string[] = []
async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  setBundledCodexPath(undefined)
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('resolveCodexBinary', () => {
  it('uses an existing custom path first and reports it as custom', async () => {
    const dir = await scratch('codex-custom-')
    const custom = join(dir, 'codex.exe')
    await writeFile(custom, '')
    setBundledCodexPath(join(dir, 'bundled.exe'))
    await expect(resolveCodexBinary(custom, { platform: 'win32', env: {} })).resolves.toEqual({
      path: custom,
      source: 'custom',
    })
  })

  it('fails loudly for a custom path that does not exist instead of silently using another Codex', async () => {
    const dir = await scratch('codex-missing-')
    const bundled = join(dir, 'codex-app-server.exe')
    await writeFile(bundled, '')
    setBundledCodexPath(bundled)
    await expect(
      resolveCodexBinary(join(dir, 'nope', 'codex.exe'), { platform: 'win32', env: {} }),
    ).rejects.toThrow(/Codex executable not found: .*nope/)
  })

  it('keeps a custom path inside the Codex desktop app on that app (newest release), not the bundled binary', async () => {
    const root = await scratch('codex-managed-')
    const release = join(root, 'release-2')
    await mkdir(release)
    await writeFile(join(release, 'codex.exe'), '')
    await writeFile(join(release, 'codex-code-mode-host.exe'), '')
    const bundled = join(root, 'bundled.exe')
    await writeFile(bundled, '')
    setBundledCodexPath(bundled)
    // a stale saved hash path and the bin folder itself both mean "the desktop app"
    for (const configured of [join(root, 'release-1', 'codex.exe'), root]) {
      await expect(
        resolveCodexBinary(configured, { platform: 'win32', env: {}, managedInstallRoot: root }),
      ).resolves.toEqual({ path: join(release, 'codex.exe'), source: 'managed' })
    }
  })

  it('fails loudly when a desktop-app path is set but the app has no complete install', async () => {
    const root = await scratch('codex-managed-empty-')
    const bundled = join(root, 'bundled.exe')
    await writeFile(bundled, '')
    setBundledCodexPath(bundled)
    await expect(
      resolveCodexBinary(join(root, 'gone', 'codex.exe'), {
        platform: 'win32',
        env: {},
        managedInstallRoot: root,
      }),
    ).rejects.toThrow(/Codex app install not found/)
  })

  it('prefers the bundled app-server over desktop, VS Code and PATH installs', async () => {
    const dir = await scratch('codex-bundled-')
    const bundled = join(dir, 'codex-app-server.exe')
    await writeFile(bundled, '')
    const onPath = join(dir, 'pathbin')
    await mkdir(onPath)
    await writeFile(join(onPath, 'codex.exe'), '')
    setBundledCodexPath(bundled)
    await expect(
      resolveCodexBinary('', { platform: 'win32', env: { PATH: onPath } }),
    ).resolves.toEqual({ path: bundled, source: 'bundled' })
  })

  it('finds the newest VS Code extension codex when nothing is bundled', async () => {
    const home = await scratch('codex-home-')
    const ext = join(home, '.vscode', 'extensions')
    for (const version of ['26.917.62051', '26.928.31416']) {
      const bin = join(ext, `openai.chatgpt-${version}-win32-x64`, 'bin', 'windows-x86_64')
      await mkdir(bin, { recursive: true })
      await writeFile(join(bin, 'codex.exe'), '')
    }
    await mkdir(join(ext, 'ms-python.python-2026.1.0'), { recursive: true })
    await expect(
      resolveCodexBinary('', {
        platform: 'win32',
        env: { USERPROFILE: home },
        managedInstallRoot: join(home, 'none'),
      }),
    ).resolves.toEqual({
      path: join(
        ext,
        'openai.chatgpt-26.928.31416-win32-x64',
        'bin',
        'windows-x86_64',
        'codex.exe',
      ),
      source: 'vscode',
    })
  })

  it('explains what to do when no Codex can be found', async () => {
    const home = await scratch('codex-empty-')
    await expect(
      resolveCodexBinary('', {
        platform: 'win32',
        env: { USERPROFILE: home },
        managedInstallRoot: join(home, 'none'),
      }),
    ).rejects.toThrow(/Codex/)
  })
})

describe('codexAppServerLaunchArgs', () => {
  it('runs the standalone app-server directly and the full CLI through its subcommand', () => {
    expect(codexAppServerLaunchArgs('C:\\x\\codex-app-server.exe')).toEqual([
      '--listen',
      'stdio://',
    ])
    expect(codexAppServerLaunchArgs('/opt/codex/codex-app-server')).toEqual([
      '--listen',
      'stdio://',
    ])
    expect(codexAppServerLaunchArgs('/usr/local/bin/codex')).toEqual([
      'app-server',
      '--listen',
      'stdio://',
    ])
    expect(codexAppServerLaunchArgs()).toEqual(['app-server', '--listen', 'stdio://'])
  })
})

describe('process failure', () => {
  it('fails the request when the app-server process dies and starts a fresh one next time', async () => {
    // node rejects the unknown `app-server` script argument and exits at once — a
    // stand-in for a Codex process that crashes or is killed mid-conversation
    const config = { apiKey: '', model: '', cliPath: process.execPath }
    const signal = new AbortController().signal
    await expect(chatCodexAppServer(config, 'sys', 'hi', signal)).rejects.toThrow(
      /Codex app-server exited/,
    )
    // a stale closed client would answer "is not running"; a fresh spawn exits again
    await expect(chatCodexAppServer(config, 'sys', 'hi', signal)).rejects.toThrow(
      /Codex app-server exited/,
    )
  }, 20_000)
})

describe('process death mid-turn', () => {
  it('rejects a running turn with the exit error instead of waiting for the idle watchdog', async () => {
    let listener: ((message: RpcMessage) => void) | undefined
    const transport: CodexTurnTransport = {
      request: async (method) => {
        if (method === 'turn/start') {
          queueMicrotask(() => {
            listener?.({ method: 'turn/started', params: { threadId: 'th1', turn: { id: 't1' } } })
            listener?.({
              method: CODEX_CLIENT_CLOSED,
              params: { message: 'Codex app-server exited (1): killed' },
            })
          })
          return { turn: { id: 't1' } }
        }
        return {}
      },
      onNotification: (next) => {
        listener = next
        return () => {
          listener = undefined
        }
      },
    }
    await expect(
      waitForTurn(
        transport,
        'th1',
        () => transport.request('turn/start', {}),
        new AbortController().signal,
        {
          signal: new AbortController().signal,
          onDelta: () => undefined,
          onToolCall: () => undefined,
        },
      ),
    ).rejects.toThrow('Codex app-server exited (1): killed')
  })
})
