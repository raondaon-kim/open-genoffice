import type { WikiReadiness } from '@genoffice/work-wiki'
import type { LlmWikiStatus } from './llm-wiki-process'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * One run at a time: a call while a run is in progress shares that run instead of starting a
 * second one (two LLM Wiki processes must never be spawned). `pending()` is the run in progress.
 */
export function singleFlight(fn: () => Promise<void>): {
  run(): Promise<void>
  pending(): Promise<void> | null
} {
  let current: Promise<void> | null = null
  return {
    run() {
      if (!current) {
        current = fn().finally(() => {
          current = null
        })
      }
      return current
    },
    pending: () => current,
  }
}

/**
 * Whether LLM Wiki is answering before a template fill: wait while it starts (bounded) — also
 * for a start already in progress, which is never doubled — restart it once when it stopped or
 * failed, then give the reason. A wiki switched off is reported as off.
 */
export async function waitForWiki(opts: {
  enabled(): boolean
  status(): LlmWikiStatus
  restart(): Promise<void>
  /** a start already in progress (launch, settings change), waited for instead of a restart */
  pending?(): Promise<void> | null
  waitMs?: number
  pollMs?: number
}): Promise<WikiReadiness> {
  if (!opts.enabled()) return { ok: false, off: true, reason: '업무 위키가 꺼져 있습니다' }
  const deadline = Date.now() + (opts.waitMs ?? 30_000)
  const poll = opts.pollMs ?? 500
  const late = (): WikiReadiness => ({
    ok: false,
    off: false,
    reason: 'LLM Wiki did not finish starting in time',
  })
  let restarted = false
  for (;;) {
    const inFlight = opts.pending?.()
    if (inFlight) {
      const left = deadline - Date.now()
      if (left <= 0) return late()
      await Promise.race([inFlight.catch(() => undefined), sleep(left)])
      continue
    }
    const s = opts.status()
    if (s.state === 'running') return { ok: true }
    if (s.state === 'stopped' || s.state === 'failed') {
      if (restarted) return { ok: false, off: false, reason: s.reason ?? 'LLM Wiki is not running' }
      restarted = true
      await opts.restart()
      continue
    }
    if (Date.now() >= deadline) return late()
    await sleep(Math.min(poll, Math.max(0, deadline - Date.now())))
  }
}
