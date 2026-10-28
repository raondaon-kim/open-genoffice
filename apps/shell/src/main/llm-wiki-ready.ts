import type { WikiReadiness } from '@genoffice/work-wiki'
import type { LlmWikiStatus } from './llm-wiki-process'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Whether LLM Wiki is answering before a template fill: wait while it starts (bounded), restart
 * it once when it stopped or failed, then give the reason. A wiki switched off is reported as off.
 */
export async function waitForWiki(opts: {
  enabled(): boolean
  status(): LlmWikiStatus
  restart(): Promise<void>
  waitMs?: number
  pollMs?: number
}): Promise<WikiReadiness> {
  if (!opts.enabled()) return { ok: false, off: true, reason: '업무 위키가 꺼져 있습니다' }
  const deadline = Date.now() + (opts.waitMs ?? 30_000)
  const poll = opts.pollMs ?? 500
  let restarted = false
  for (;;) {
    const s = opts.status()
    if (s.state === 'running') return { ok: true }
    if (s.state === 'stopped' || s.state === 'failed') {
      if (restarted) return { ok: false, off: false, reason: s.reason ?? 'LLM Wiki is not running' }
      restarted = true
      await opts.restart()
      continue
    }
    if (Date.now() >= deadline) {
      return { ok: false, off: false, reason: 'LLM Wiki did not finish starting in time' }
    }
    await sleep(Math.min(poll, Math.max(0, deadline - Date.now())))
  }
}
