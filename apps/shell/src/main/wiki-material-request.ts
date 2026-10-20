import { isAbsolute } from 'node:path'
import type { WikiMaterialResult } from '@genoffice/work-wiki/material'
import { addMaterial } from './add-material'

const MAX_PATHS = 50
const MAX_PATH_CHARS = 4096

/**
 * wiki:add-material from an editor's attachment chip. Malformed input gets no answer ([]);
 * otherwise one result per path, in order. `gate` is the HWP grant check: false means the path
 * was not attached in the asking Hangul view; null means the gate does not apply.
 */
export async function handleWikiMaterialRequest(
  input: unknown,
  ctx: {
    enabled: boolean
    rawSources: string
    indexPath: string
    extractText: (path: string) => Promise<string | null>
    gate: (path: string) => boolean | null
  },
): Promise<WikiMaterialResult[]> {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > MAX_PATHS ||
    !input.every(
      (p) => typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH_CHARS && isAbsolute(p),
    )
  )
    return []
  const paths = input as string[]
  if (!ctx.enabled) return paths.map((path) => ({ path, status: 'skipped', reason: 'wiki-off' }))
  const refused = paths.map((p) => ctx.gate(p) === false)
  const allowed = paths.filter((_, i) => !refused[i])
  const added = allowed.length
    ? await addMaterial({
        files: allowed,
        rawSources: ctx.rawSources,
        extractText: ctx.extractText,
        indexPath: ctx.indexPath,
      })
    : []
  let k = 0
  return paths.map((path, i) =>
    refused[i] ? { path, status: 'skipped', reason: 'not-attached' } : added[k++]!,
  )
}
