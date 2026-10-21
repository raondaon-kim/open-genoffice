import { isAbsolute } from 'node:path'

import type { WorkWikiSettings } from '../shared/home-api'

export type { WorkWikiSettings }

export function normalizeWorkWikiSettings(raw: unknown, defaultFolder: string): WorkWikiSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const folder =
    typeof o.folder === 'string' && isAbsolute(o.folder.trim()) ? o.folder.trim() : defaultFolder
  const exclude = Array.isArray(o.exclude)
    ? o.exclude
        .filter((e): e is string => typeof e === 'string' && isAbsolute(e.trim()))
        .map((e) => e.trim())
    : []
  return {
    enabled: o.enabled !== false,
    folder,
    exclude,
    // saved documents are copied into the wiki unless switched off
    mirrorSaved: o.mirrorSaved !== false,
    mirrorNoticeShown: o.mirrorNoticeShown === true,
  }
}

/**
 * Whether a settings change needs the engine restarted. The saved-copies
 * switch and the notice flag are read live, so they do not; a restart waits
 * for a running learn job.
 */
export function workWikiNeedsRestart(prev: WorkWikiSettings, next: WorkWikiSettings): boolean {
  return (
    prev.enabled !== next.enabled ||
    prev.folder !== next.folder ||
    prev.exclude.length !== next.exclude.length ||
    prev.exclude.some((e, i) => e !== next.exclude[i])
  )
}
