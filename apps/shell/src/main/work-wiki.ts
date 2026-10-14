import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { streamForProvider } from '@genoffice/ai-provider'
import { readAiSettingsFile } from '@genoffice/ai-search'
import { parseFileToText } from '@genoffice/file-parse'
import { WIKI_CHANNELS, WIKI_UNAVAILABLE } from '@genoffice/work-wiki'
import { WorkWikiEngine } from '@genoffice/work-wiki/node'
import type { WikiComplete } from '@genoffice/work-wiki/node'
import { HOME_CHANNELS } from '../shared/home-api'
import { readAppSettings, writeAppSetting } from './app-settings'
import { normalizeWorkWikiSettings } from './work-wiki-settings'
import type { WorkWikiSettings } from './work-wiki-settings'

const LEARN_TIMEOUT_MS = 180_000
const LEARN_MAX_TOKENS = 8192

let engine: WorkWikiEngine | null = null
let paths: { userData: string; documents: string; appSettingsPath: string } | null = null

const defaultFolder = () => join(paths!.documents, 'GenOffice 업무위키')

export function readWorkWikiSettings(): WorkWikiSettings {
  return normalizeWorkWikiSettings(
    readAppSettings(paths!.appSettingsPath).workWiki,
    defaultFolder(),
  )
}

/** one completion with the configured model, thinking off where the vendor allows it */
export function createWikiComplete(settingsPath: string): WikiComplete {
  return async (system, user) => {
    const settings = readAiSettingsFile(settingsPath)
    const provider = settings.provider
    const config = settings.providers?.[provider]
    if (!config || (provider !== 'codex' && (!config.apiKey || !config.model))) {
      throw new Error('AI model is not configured')
    }
    let text = ''
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LEARN_TIMEOUT_MS)
    try {
      await streamForProvider(
        provider,
        config,
        system,
        [{ role: 'user', text: user }],
        [],
        LEARN_MAX_TOKENS,
        {
          thinking: 'off',
          signal: controller.signal,
          onDelta: (d) => {
            text += d
          },
          onToolCall: () => {},
        },
      )
    } finally {
      clearTimeout(timer)
    }
    return text
  }
}

async function extractText(path: string): Promise<string | null> {
  try {
    const r = await parseFileToText(path)
    return r.ok && r.kind === 'text' ? (r.text ?? null) : null
  } catch {
    return null
  }
}

/** per-user engine state for a wiki root, kept out of the (possibly shared) wiki folder */
function stateDirFor(root: string): string {
  const key = createHash('sha256')
    .update(resolve(root).replace(/\\/g, '/').toLowerCase())
    .digest('hex')
    .slice(0, 16)
  return join(paths!.userData, 'work-wiki', key)
}

/** settings changed: the old engine finishes its running job before the next one starts */
async function restart(): Promise<void> {
  const old = engine
  engine = null
  await old?.stopAndWait()
  const s = readWorkWikiSettings()
  if (!s.enabled) return
  const debounce = Number(process.env.GENOFFICE_WORK_WIKI_DEBOUNCE_MS)
  const next = new WorkWikiEngine({
    root: s.folder,
    stateDir: stateDirFor(s.folder),
    exclude: s.exclude,
    complete: createWikiComplete(join(paths!.userData, 'ai-settings.json')),
    extractText,
    ...(debounce > 0 ? { debounceMs: debounce } : {}),
    log: (m) => console.warn(`[work-wiki] ${m}`),
  })
  if (next.start()) engine = next
}

export function startWorkWiki(opts: {
  userData: string
  documents: string
  appSettingsPath: string
}): void {
  paths = opts
  void restart()
}

/** every saved document reaches the wiki through here; never throws */
export function workWikiDocumentSaved(path: string): void {
  try {
    engine?.onDocumentSaved(path)
  } catch {
    // the wiki never blocks a save
  }
}

export function registerWorkWikiIpc(): void {
  ipcMain.handle(WIKI_CHANNELS.catalog, () => engine?.catalog() ?? '')
  ipcMain.handle(WIKI_CHANNELS.search, (_e, q: unknown) => engine?.search(String(q ?? '')) ?? [])
  ipcMain.handle(
    WIKI_CHANNELS.read,
    (_e, slug: unknown) =>
      engine?.read(String(slug ?? '')) ?? { ok: false, error: WIKI_UNAVAILABLE },
  )
  ipcMain.handle(WIKI_CHANNELS.remember, async (_e, points: unknown, work: unknown) => {
    if (!engine) return { ok: false, error: WIKI_UNAVAILABLE }
    const r = await engine.remember(
      Array.isArray(points) ? points.map(String) : [],
      typeof work === 'string' ? work : undefined,
    )
    void engine.runDue()
    return r
  })
  ipcMain.handle(HOME_CHANNELS.getWorkWikiSettings, () => readWorkWikiSettings())
  ipcMain.handle(HOME_CHANNELS.setWorkWikiSettings, async (_e, patch: unknown) => {
    const next = normalizeWorkWikiSettings(
      { ...readWorkWikiSettings(), ...(patch && typeof patch === 'object' ? patch : {}) },
      defaultFolder(),
    )
    writeAppSetting(paths!.appSettingsPath, 'workWiki', next)
    await restart()
    return next
  })
  ipcMain.handle(HOME_CHANNELS.pickWorkWikiFolder, async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    const options = {
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
    }
    const r = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
}
