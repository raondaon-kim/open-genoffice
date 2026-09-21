import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Minimal MCP stdio client for the HwpForge document generator.
 *
 * HwpForge compiles Markdown (GFM tables included) into valid HWPX documents
 * with real tables/cells — the "write text + tables into one document"
 * capability the rhwp engine automation does not expose. We spawn its prebuilt
 * platform binary directly (no npm launcher script, no ELECTRON_RUN_AS_NODE),
 * speak JSON-RPC lines over stdio and call hwpforge_convert. The binary path
 * comes from the caller (see native-binary-path.ts) so packaged builds can ship
 * it as an extraResource next to the sheets sidecar.
 */

interface McpJsonRpc {
  id?: number
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean }
  error?: { message: string }
}

/** spawn(3)-shaped hook so tests can substitute a scripted child process */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams

export interface McpCallOptions {
  /** absolute path of the HwpForge MCP platform binary */
  binPath: string
  spawnImpl?: SpawnLike
  timeoutMs?: number
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export async function mcpCall(
  toolName: string,
  args: Record<string, unknown>,
  options: McpCallOptions,
): Promise<string> {
  const { binPath, timeoutMs = 90_000 } = options
  const spawnImpl: SpawnLike = options.spawnImpl ?? (nodeSpawn as unknown as SpawnLike)
  const child = spawnImpl(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })

  let buffer = ''
  let nextId = 0
  const pending = new Map<
    number,
    { resolve: (m: McpJsonRpc) => void; reject: (e: Error) => void }
  >()
  const failAll = (err: Error) => {
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
  }
  // ENOENT/EACCES arrive here; surface the path so a broken install is diagnosable
  child.on('error', (err: NodeJS.ErrnoException) => {
    failAll(
      new Error(
        `hwpforge binary not found or not executable: ${binPath} (${err.code ?? err.message})`,
      ),
    )
  })
  child.on('close', (code) => {
    failAll(new Error(`hwpforge exited before responding (code ${code ?? 'signal'})`))
  })
  // a dead stdin must not turn into an unhandled 'error' event
  child.stdin.on('error', () => undefined)

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let msg: McpJsonRpc
      try {
        msg = JSON.parse(line) as McpJsonRpc
      } catch {
        /* not JSON — skip */ continue
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) entry.reject(new Error(msg.error.message ?? 'mcp error'))
        else entry.resolve(msg)
      }
    }
  })

  const send = (payload: Record<string, unknown>) => {
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    } catch {
      /* stdin already gone; the 'error'/'close' handlers reject the caller */
    }
  }
  const request = (method: string, params: unknown): Promise<McpJsonRpc> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })

  try {
    await withTimeout(
      request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'open-genoffice-hwp', version: '1' },
      }),
      timeoutMs,
      'hwpforge initialize',
    )
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const res = await withTimeout(
      request('tools/call', { name: toolName, arguments: args }),
      timeoutMs,
      `hwpforge ${toolName}`,
    )
    const text = (res.result?.content ?? []).map((c) => c.text).join('\n')
    if (res.result?.isError) throw new Error(`hwpforge ${toolName} failed: ${text.slice(0, 800)}`)
    return text
  } finally {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
}

export interface CreateHwpResult {
  ok: boolean
  path?: string
  error?: string
}

/** Compile Markdown (tables allowed) into a fresh .hwpx document. */
export async function createHwpFromMarkdown(
  markdown: string,
  destDir: string,
  baseName: string,
  options: McpCallOptions,
): Promise<CreateHwpResult> {
  try {
    if (!markdown.trim()) return { ok: false, error: 'hwpforge: markdown is empty' }
    await mkdir(destDir, { recursive: true })
    const safe = baseName
      .replace(/[^a-zA-Z0-9가-힣_ -]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60)
    const stamp = Date.now()
    const mdPath = join(destDir, `${safe || 'document'}-${stamp}.md`)
    const outPath = join(destDir, `${safe || 'document'}-${stamp}.hwpx`)
    await writeFile(mdPath, markdown, 'utf8')
    await mcpCall(
      'hwpforge_convert',
      { markdown: mdPath, is_file: true, output_path: outPath },
      options,
    )
    if (!existsSync(outPath)) {
      return { ok: false, error: 'hwpforge did not produce an output file' }
    }
    return { ok: true, path: outPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
