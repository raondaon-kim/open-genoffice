import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { RhwpEnvelope, RhwpExitCode, RhwpResult } from '../shared/ai-contract'

/**
 * Thin runner for the bundled `rhwp` CLI (Hangul engine binary shipped as an
 * extraResource, see native-binary-path.ts). Arguments go straight to spawn —
 * no shell, so document text never meets a command line parser. stdout is one
 * JSON envelope (`--json`), stderr carries diagnostics. Exit 1/2/3 are part of
 * the CLI's contract and come back as results; anything else is a failure of
 * the runner and throws.
 */

/** spawn(3)-shaped hook so tests can substitute a scripted child */
export type RhwpSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams

export interface RunRhwpOptions {
  /** default 30 s — explain/search on a 30-page document take ~100-250 ms */
  timeoutMs?: number
  spawnImpl?: RhwpSpawn
  /** also return raw stdout (dump has no --json) */
  keepStdout?: boolean
}

export type RunRhwpFn = (
  binPath: string,
  args: readonly string[],
  options?: RunRhwpOptions,
) => Promise<RhwpResult>

const DEFAULT_TIMEOUT_MS = 30_000

function isExitCode(code: number): code is RhwpExitCode {
  return code === 0 || code === 1 || code === 2 || code === 3
}

function parseEnvelope(stdout: string): RhwpEnvelope | null {
  const text = stdout.trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as RhwpEnvelope)
      : null
  } catch {
    return null
  }
}

export function runRhwp(
  binPath: string,
  args: readonly string[],
  options: RunRhwpOptions = {},
): Promise<RhwpResult> {
  // encrypted documents are out of scope; a snapshot (exportHwpx) is never
  // encrypted, so a password flag can only be a bug or an injection attempt
  if (args.some((arg) => arg.startsWith('--password'))) {
    return Promise.reject(new Error('rhwp: password options are not allowed'))
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const spawnImpl: RhwpSpawn = options.spawnImpl ?? (nodeSpawn as unknown as RhwpSpawn)
  const label = `rhwp ${args[0] ?? ''}`.trim()

  return new Promise<RhwpResult>((resolve, reject) => {
    const child = spawnImpl(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => {
        try {
          child.kill()
        } catch {
          /* already gone */
        }
        reject(new Error(`${label} timed out after ${timeoutMs}ms`))
      })
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          new Error(
            `rhwp binary not found or not executable: ${binPath} (${err.code ?? err.message})`,
          ),
        ),
      )
    })
    child.on('close', (code) => {
      finish(() => {
        if (code === null) {
          reject(new Error(`${label} was killed by a signal: ${stderr.slice(0, 800)}`))
        } else if (!isExitCode(code)) {
          reject(new Error(`${label} exited with unexpected code ${code}: ${stderr.slice(0, 800)}`))
        } else {
          resolve({
            exitCode: code,
            envelope: parseEnvelope(stdout),
            stderr,
            ...(options.keepStdout ? { stdout } : {}),
          })
        }
      })
    })
  })
}
