import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Minimal MCP stdio client for the HwpForge document generator.
 *
 * HwpForge compiles Markdown (GFM tables included) into valid HWPX documents
 * with real tables/cells — the "write text + tables into one document"
 * capability the rhwp engine automation does not expose. We drive its
 * prebuilt binary over MCP (JSON-RPC lines on stdio) and call
 * hwpforge_convert.
 */

interface McpJsonRpc {
  id?: number
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean }
  error?: { message: string }
}

/** path of the MCP wrapper JS that execs the platform binary */
function forgeWrapperPath(): string {
  const pkgJson = require.resolve('@hwpforge/mcp/package.json')
  return join(dirname(pkgJson), 'bin', 'hwpforge-mcp.js')
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

async function mcpCall(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 90_000,
): Promise<string> {
  const child = spawn(process.execPath, [forgeWrapperPath()], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.on('error', () => undefined)
  child.on('close', () => undefined)

  let buffer = ''
  let nextId = 0
  const pending = new Map<
    number,
    { resolve: (m: McpJsonRpc) => void; reject: (e: Error) => void }
  >()

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

  const request = (method: string, params: unknown): Promise<McpJsonRpc> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
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
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    )
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
    const text = await mcpCall('hwpforge_convert', {
      markdown: mdPath,
      is_file: true,
      output_path: outPath,
    })
    void text
    if (!existsSync(outPath)) {
      return { ok: false, error: 'hwpforge did not produce an output file' }
    }
    return { ok: true, path: outPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
