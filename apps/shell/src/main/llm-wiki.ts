import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import type { ChildLike, FetchLike, StalePid } from './llm-wiki-process'
import type { LlmWikiLlm } from './llm-wiki-seed'

/** the installed copy (resources/llm-wiki), else the dev build (apps/shell/build/llm-wiki); null when absent */
export function llmWikiExePath(resourcesPath: string | undefined, devDir: string): string | null {
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'llm-wiki', 'llm-wiki.exe')] : []),
    join(devDir, 'llm-wiki', 'llm-wiki.exe'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** what LLM Wiki's settings must say: a change means it needs a restart. The key only enters as a hash. */
export function desiredSignature(llm: LlmWikiLlm | null, wikiRoot: string): string {
  const parts = llm
    ? [
        llm.provider,
        llm.model,
        llm.customEndpoint,
        llm.apiMode,
        createHash('sha256').update(llm.apiKey).digest('hex').slice(0, 12),
      ]
    : ['no-llm']
  return [wikiRoot.replace(/\\/g, '/').toLowerCase(), ...parts].join('|')
}

export const realFetch: FetchLike = async (url, init) => {
  const r = await fetch(url, init)
  return { ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> }
}

export function realSpawn(exe: string, env: NodeJS.ProcessEnv): ChildLike {
  const child = spawn(exe, [], { env, cwd: dirname(exe), stdio: 'ignore', windowsHide: true })
  child.on('error', () => {})
  return child
}

/** two free local ports (asked of the OS, released at once) */
export async function pickFreePorts(): Promise<{ api: number; clip: number }> {
  const one = () =>
    new Promise<number>((resolve, reject) => {
      const s = createServer()
      s.once('error', reject)
      s.listen(0, '127.0.0.1', () => {
        const port = (s.address() as { port: number }).port
        s.close(() => resolve(port))
      })
    })
  const api = await one()
  let clip = await one()
  while (clip === api) clip = await one()
  return { api, clip }
}

/** pid file in the app's own data folder; Windows only checks the image name through tasklist */
export function pidFileStore(file: string): StalePid {
  return {
    read() {
      try {
        const n = Number(readFileSync(file, 'utf8').trim())
        return Number.isInteger(n) && n > 0 ? n : null
      } catch {
        return null
      }
    },
    write: (pid) => writeFileSync(file, String(pid), 'utf8'),
    clear: () => rmSync(file, { force: true }),
    isLlmWiki(pid) {
      try {
        const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          windowsHide: true,
        })
        return out.toLowerCase().includes('llm-wiki.exe')
      } catch {
        return false
      }
    },
    kill(pid) {
      try {
        process.kill(pid)
      } catch {
        // already gone
      }
    },
  }
}
