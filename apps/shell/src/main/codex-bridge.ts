import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentMessage } from '@genoffice/agent-core'

export interface BridgeCompleteRequest {
  system: string
  messages: AgentMessage[]
  model: string
  maxTokens: number
  signal: AbortSignal
  onDelta: (text: string) => void
}

export interface CodexBridgeOptions {
  /** one turn through Codex; text arrives through onDelta, a failure is a throw */
  complete: (req: BridgeCompleteRequest) => Promise<void>
  /** the model id this adapter reports */
  model: () => string
  token?: string
  requestTimeoutMs?: number
  maxBodyBytes?: number
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_MAX_BODY = 8 * 1024 * 1024
const DEFAULT_MAX_TOKENS = 8192

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface ParsedChat {
  system: string
  messages: AgentMessage[]
  maxTokens: number
  stream: boolean
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const text = part && typeof part === 'object' ? (part as { text?: unknown }).text : undefined
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

/** the OpenAI-style messages as a system prompt and agent messages */
function parseChat(body: unknown): ParsedChat {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'body must be an object')
  const b = body as {
    messages?: unknown
    max_tokens?: unknown
    max_completion_tokens?: unknown
    stream?: unknown
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new HttpError(400, 'messages must be a non-empty array')
  }
  const systems: string[] = []
  const messages: AgentMessage[] = []
  for (const m of b.messages) {
    if (!m || typeof m !== 'object') throw new HttpError(400, 'bad message')
    const { role, content } = m as { role?: unknown; content?: unknown }
    const text = textOf(content)
    if (role === 'system' || role === 'developer') systems.push(text)
    else if (role === 'user') messages.push({ role: 'user', text })
    else if (role === 'assistant') messages.push({ role: 'assistant', text })
  }
  if (messages.length === 0) throw new HttpError(400, 'no user message')
  const cap = Number(b.max_completion_tokens ?? b.max_tokens)
  return {
    system: systems.join('\n\n'),
    messages,
    maxTokens: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_MAX_TOKENS,
    stream: b.stream === true,
  }
}

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    let over = false
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) over = true
      else chunks.push(c)
    })
    req.on('end', () => {
      if (over) return reject(new HttpError(413, 'body too large'))
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'body is not JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * A loopback OpenAI-compatible server in front of the Codex call, so LLM Wiki (which speaks chat
 * completions, not Codex) can learn through the user's ChatGPT sign-in. One request at a time.
 */
export class CodexBridge {
  private server: Server | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private readonly token: string

  constructor(private readonly o: CodexBridgeOptions) {
    this.token = o.token ?? randomBytes(24).toString('hex')
  }

  async start(): Promise<{ baseUrl: string; token: string }> {
    const server = createServer((req, res) => void this.handle(req, res))
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    return { baseUrl: `http://127.0.0.1:${port}/v1`, token: this.token }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '')
      if (host !== '127.0.0.1' && host !== 'localhost') throw new HttpError(403, 'loopback only')
      const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
      if (!sameToken(given, this.token)) throw new HttpError(401, 'unauthorized')
      const path = (req.url ?? '').split('?')[0]
      if (req.method === 'GET' && path === '/v1/models') {
        sendJson(res, 200, {
          object: 'list',
          data: [{ id: this.o.model(), object: 'model', owned_by: 'codex' }],
        })
        return
      }
      if (req.method === 'POST' && path === '/v1/chat/completions') {
        const parsed = parseChat(await readBody(req, this.o.maxBodyBytes ?? DEFAULT_MAX_BODY))
        await this.serialized(() => this.completion(res, parsed))
        return
      }
      throw new HttpError(404, 'not found')
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      sendJson(res, status, {
        error: { message: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  /** requests wait for the one before them; a failure never blocks the queue */
  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job)
    this.tail = run.catch(() => undefined)
    return run
  }

  private async completion(res: ServerResponse, parsed: ParsedChat): Promise<void> {
    if (res.destroyed) return // the client left while waiting in the queue
    const controller = new AbortController()
    let finished = false
    res.on('close', () => {
      if (!finished) controller.abort(new HttpError(499, 'client closed'))
    })
    const timeout = setTimeout(
      () => controller.abort(new HttpError(504, 'Codex did not answer in time')),
      this.o.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    // a call that ignores the signal still ends here when the client leaves or time runs out
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
        once: true,
      })
    })
    const id = `chatcmpl-${randomBytes(8).toString('hex')}`
    const model = this.o.model()
    let text = ''
    let streaming = false
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`
    const openStream = () => {
      if (streaming) return
      streaming = true
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write(chunk({ role: 'assistant' }, null))
    }
    try {
      await Promise.race([
        this.o.complete({
          system: parsed.system,
          messages: parsed.messages,
          model,
          maxTokens: parsed.maxTokens,
          signal: controller.signal,
          onDelta: (d) => {
            if (controller.signal.aborted) return
            text += d
            if (!parsed.stream) return
            openStream()
            res.write(chunk({ content: d }, null))
          },
        }),
        aborted,
      ])
      finished = true
      if (parsed.stream) {
        openStream()
        res.write(chunk({}, 'stop'))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      sendJson(res, 200, {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
    } catch (err) {
      finished = true
      if (!controller.signal.aborted) controller.abort()
      if (res.headersSent) {
        res.destroy() // a stream already started: the client sees the connection drop
        return
      }
      const status = err instanceof HttpError ? err.status : 502
      sendJson(res, status, {
        error: { message: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
