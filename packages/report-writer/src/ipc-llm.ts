import type { LlmPort, LlmReply } from './types'

/** the slice of an app's preload AI stream API the model port needs (docs and hwp share it) */
export interface AiStreamChunkLike {
  requestId: string
  type: string
  text?: string
  error?: string
  stopReason?: string
}

export interface AiStreamApi<S = unknown> {
  aiStream(req: {
    requestId: string
    settings: S
    system: string
    messages: Array<{ role: 'user'; text: string }>
    maxTokens?: number
    thinking?: 'off'
  }): Promise<unknown>
  aiStreamCancel(requestId: string): Promise<unknown>
  onAiStream(handler: (chunk: AiStreamChunkLike) => void): () => void
}

/** the same silence watchdog as the agent transport (agent-core IPC_STREAM_SILENCE_TIMEOUT_MS) */
const DEFAULT_SILENCE_MS = 240_000

let seq = 0

/**
 * One tool-less streamed request per call over the app's `aiStream` IPC. Only answer text is
 * kept (reasoning chunks are not), the budget goes as `maxTokens` and thinking is asked off.
 * Resolves, never rejects.
 */
export function createIpcLlm<S>(
  api: AiStreamApi<S>,
  getSettings: () => S,
  silenceMs = DEFAULT_SILENCE_MS,
): LlmPort {
  return (req) =>
    new Promise<LlmReply>((resolve) => {
      const requestId = `report-${Date.now()}-${++seq}`
      let text = ''
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let unsubscribe: () => void = () => undefined
      const finish = (reply: LlmReply) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        unsubscribe()
        req.signal?.removeEventListener('abort', onAbort)
        resolve(reply)
      }
      const arm = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          void api.aiStreamCancel(requestId).catch(() => undefined)
          finish({ status: 'error', text, error: 'the model stopped answering' })
        }, silenceMs)
      }
      const onAbort = () => {
        void api.aiStreamCancel(requestId).catch(() => undefined)
        finish({ status: 'stopped', text })
      }
      if (req.signal?.aborted) {
        finish({ status: 'stopped', text: '' })
        return
      }
      unsubscribe = api.onAiStream((chunk) => {
        if (chunk.requestId !== requestId || settled) return
        arm()
        if (chunk.type === 'delta') text += chunk.text ?? ''
        else if (chunk.type === 'done') {
          if (chunk.stopReason === 'max_tokens') finish({ status: 'max_tokens', text })
          else if (!text.trim()) finish({ status: 'empty', text })
          else finish({ status: 'complete', text })
        } else if (chunk.type === 'error') {
          finish({ status: 'error', text, error: chunk.error ?? 'model error' })
        }
      })
      req.signal?.addEventListener('abort', onAbort, { once: true })
      arm()
      api
        .aiStream({
          requestId,
          settings: getSettings(),
          system: req.system,
          messages: [{ role: 'user', text: req.user }],
          maxTokens: req.maxTokens,
          thinking: 'off',
        })
        .catch((err: unknown) =>
          finish({
            status: 'error',
            text,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
    })
}
