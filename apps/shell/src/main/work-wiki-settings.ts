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
  return { enabled: o.enabled !== false, folder, exclude }
}
