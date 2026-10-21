import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { hwpTextAsMarkdown } from './hwp-markdown'

/**
 * Saved documents go into the wiki's sources as they are, so LLM Wiki
 * learns them too (GenOffice's own engine learns the text separately).
 *
 * - New copies land in `raw/sources/genoffice-saved/`. LLM Wiki keys a
 *   source by its bare file name, so a name is free only when no file of
 *   that name exists anywhere under `raw/sources` and it is not a key of
 *   LLM Wiki's ingest cache; otherwise "name (2).ext" and so on. Checking
 *   the disk keeps two people who share a wiki folder from overwriting
 *   each other's copy.
 * - Hangul files become `<stem>.md` with their text (LLM Wiki cannot read
 *   them).
 * - A copy is replaced only when the content changed, at most once per
 *   `minIntervalMs`; a change in between is reported as deferred until
 *   then.
 * - A document whose content is already in the wiki through "Add
 *   material" adopts that copy instead of adding a second one.
 * The record (original → copy) lives in `<stateDir>/saved-index.json`.
 */
export interface SavedMirrorOptions {
  /** the wiki folder */
  root: string
  /** <userData>/work-wiki/<wiki id> */
  stateDir: string
  /** add-material's material-index.json (content hash → copied file) */
  materialIndexPath: string
  extractText: (path: string) => Promise<string | null>
  /** the Settings switch */
  enabled: () => boolean
  now?: () => number
  /** default one hour */
  minIntervalMs?: number
  /** default 100 MB, the "Add material" limit */
  maxBytes?: number
  /** the first copy this session: the shell shows a one-time notice */
  onFirstMirror?: () => void
}

export type MirrorOutcome =
  | { status: 'written' | 'unchanged' | 'skipped'; mirror?: string }
  | { status: 'deferred'; retryAt: number }

interface MirrorRecord {
  /** path relative to raw/sources, forward slashes */
  mirror: string
  /** sha256 of the original's bytes */
  hash: string
  writtenAt: number
}

interface SavedIndex {
  version: 1
  docs: Record<string, MirrorRecord>
}

const HANGUL = new Set(['.hwp', '.hwpx'])
const SAVED_DIR = 'genoffice-saved'
const DEFAULT_INTERVAL_MS = 3_600_000
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024
const norm = (p: string) => resolve(p).replace(/\\/g, '/').toLowerCase()
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

function isRecord(v: unknown): v is MirrorRecord {
  const r = v as MirrorRecord
  return (
    !!r &&
    typeof r.mirror === 'string' &&
    typeof r.hash === 'string' &&
    typeof r.writtenAt === 'number'
  )
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** write next to the target under a dot-name LLM Wiki never ingests, then rename over it */
function writeAtomic(dest: string, data: Buffer | string): void {
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = join(dirname(dest), `.${basename(dest)}.${process.pid}.tmp`)
  writeFileSync(tmp, data)
  try {
    renameSync(tmp, dest)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      // already gone
    }
    throw err
  }
}

export function createSavedMirror(o: SavedMirrorOptions): {
  mirror(path: string): Promise<MirrorOutcome>
  moved(oldPath: string, newPath: string): Promise<void>
} {
  const indexPath = join(o.stateDir, 'saved-index.json')
  const sourcesDir = join(o.root, 'raw', 'sources')
  const now = o.now ?? Date.now
  const interval = o.minIntervalMs ?? DEFAULT_INTERVAL_MS
  const maxBytes = o.maxBytes ?? DEFAULT_MAX_BYTES
  let noticed = false

  const load = (): SavedIndex => {
    const parsed = readJson(indexPath) as Partial<SavedIndex> | null
    const docs: Record<string, MirrorRecord> = {}
    if (parsed && parsed.version === 1 && parsed.docs && typeof parsed.docs === 'object') {
      for (const [k, v] of Object.entries(parsed.docs)) if (isRecord(v)) docs[k] = v
    }
    return { version: 1, docs }
  }

  const save = (idx: SavedIndex): void => {
    mkdirSync(o.stateDir, { recursive: true })
    const tmp = `${indexPath}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(idx), 'utf8')
    renameSync(tmp, indexPath)
  }

  /** every file name under raw/sources and every source name LLM Wiki has cached, lower-cased */
  const takenNames = (): Set<string> => {
    const taken = new Set<string>()
    const walk = (dir: string): void => {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.isDirectory()) walk(join(dir, e.name))
        else taken.add(e.name.toLowerCase())
      }
    }
    walk(sourcesDir)
    const cache = readJson(join(o.root, '.llm-wiki', 'ingest-cache.json')) as {
      entries?: Record<string, unknown>
    } | null
    for (const name of Object.keys(cache?.entries ?? {})) taken.add(name.toLowerCase())
    return taken
  }

  const freeName = (wanted: string): string => {
    const taken = takenNames()
    const ext = extname(wanted)
    const stem = wanted.slice(0, wanted.length - ext.length)
    let n = 1
    let candidate = wanted
    while (taken.has(candidate.toLowerCase())) candidate = `${stem} (${++n})${ext}`
    return candidate
  }

  /** the "Add material" copy of exactly these bytes, relative to raw/sources, if it still exists */
  const materialCopy = (hash: string): string | null => {
    const index = readJson(o.materialIndexPath) as Record<string, unknown> | null
    const copy = index && typeof index[hash] === 'string' ? (index[hash] as string) : null
    if (!copy || !existsSync(copy)) return null
    const rel = relative(sourcesDir, copy)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    return rel.replace(/\\/g, '/')
  }

  const mirrorNow = async (path: string): Promise<MirrorOutcome> => {
    if (!o.enabled()) return { status: 'skipped' }
    const key = norm(path)
    if (key.startsWith(`${norm(o.root)}/`)) return { status: 'skipped' }
    let bytes: Buffer
    try {
      const st = statSync(path)
      if (!st.isFile() || st.size > maxBytes) return { status: 'skipped' }
      bytes = readFileSync(path)
    } catch {
      return { status: 'skipped' }
    }
    const hash = sha256(bytes)
    const idx = load()
    const rec = idx.docs[key]
    if (rec && rec.hash === hash) return { status: 'unchanged', mirror: rec.mirror }
    if (rec && now() < rec.writtenAt + interval) {
      return { status: 'deferred', retryAt: rec.writtenAt + interval }
    }

    const ext = extname(path).toLowerCase()
    const stem = basename(path, extname(path))
    let data: Buffer | string = bytes
    if (HANGUL.has(ext)) {
      data = hwpTextAsMarkdown(stem, (await o.extractText(path)) ?? '')
      if (!data) return { status: 'skipped' }
    }

    let rel = rec?.mirror
    if (!rel) {
      const adopted = materialCopy(hash)
      if (adopted) {
        // already in the wiki as material: that copy is this document's from now on.
        // Nothing was written now, so its next change may be written at once.
        idx.docs[key] = { mirror: adopted, hash, writtenAt: now() - interval }
        save(idx)
        return { status: 'unchanged', mirror: adopted }
      }
      rel = `${SAVED_DIR}/${freeName(HANGUL.has(ext) ? `${stem}.md` : basename(path))}`
    }
    writeAtomic(join(sourcesDir, rel), data)
    idx.docs[key] = { mirror: rel, hash, writtenAt: now() }
    save(idx)
    if (!noticed) {
      noticed = true
      try {
        o.onFirstMirror?.()
      } catch {
        // a notice never stops the copy
      }
    }
    return { status: 'written', mirror: rel }
  }

  const movedNow = (oldPath: string, newPath: string): void => {
    const idx = load()
    const rec = idx.docs[norm(oldPath)]
    if (!rec) return
    delete idx.docs[norm(oldPath)]
    idx.docs[norm(newPath)] = rec
    save(idx)
  }

  // one call at a time: each reads, changes and writes saved-index.json
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = queue.then(fn)
    queue = run.catch(() => undefined)
    return run
  }

  return {
    mirror: (path) => serial(() => mirrorNow(path)),
    moved: (oldPath, newPath) => serial(() => movedNow(oldPath, newPath)),
  }
}
