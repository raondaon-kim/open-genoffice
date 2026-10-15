import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { streamForProvider } from '@genoffice/ai-provider'
import { format, getUiLang } from '@genoffice/i18n'
import type { Lang } from '@genoffice/i18n'
import { readAiSettingsFile } from '@genoffice/ai-search'
import { parseFileToText } from '@genoffice/file-parse'
import { WIKI_CHANNELS, WIKI_UNAVAILABLE } from '@genoffice/work-wiki'
import { WorkWikiEngine } from '@genoffice/work-wiki/node'
import type { WikiComplete } from '@genoffice/work-wiki/node'
import { HOME_CHANNELS } from '../shared/home-api'
import { addMaterial } from './add-material'
import { readAppSettings, writeAppSetting } from './app-settings'
import {
  desiredSignature,
  llmWikiExePath,
  pickFreePorts,
  pidFileStore,
  realFetch,
  realSpawn,
} from './llm-wiki'
import { LlmWikiProcess } from './llm-wiki-process'
import type { LlmWikiStatus } from './llm-wiki-process'
import {
  ensureProjectId,
  llmWikiLlmFromAiSettings,
  readAppState,
  seedAppState,
  writeAppState,
} from './llm-wiki-seed'
import { normalizeWorkWikiSettings } from './work-wiki-settings'
import type { WorkWikiSettings } from './work-wiki-settings'

const LEARN_TIMEOUT_MS = 180_000
const LEARN_MAX_TOKENS = 8192
const LLM_WIKI_IDENTIFIER = 'com.opengenoffice.llmwiki'
const DRIFT_CHECK_MS = 30_000

let engine: WorkWikiEngine | null = null
let paths: { userData: string; documents: string; appSettingsPath: string } | null = null
let llmWiki: LlmWikiProcess | null = null
let llmWikiSignature = ''
let driftTimer: ReturnType<typeof setInterval> | null = null
let llmWikiReason: string | null = null

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

const llmWikiDataDir = () => join(app.getPath('appData'), LLM_WIKI_IDENTIFIER)
const devLlmWikiDir = () => join(app.getAppPath(), 'build')
const WEBVIEW2_HINT =
  'LLM Wiki did not start; check that the Microsoft Edge WebView2 runtime is installed'

/** status for Settings: whether this install ships it, and how it is doing */
export function llmWikiStatus(): LlmWikiStatus & { available: boolean } {
  const available = llmWikiExePath(process.resourcesPath, devLlmWikiDir()) !== null
  const status: LlmWikiStatus = llmWiki
    ? llmWiki.status()
    : { state: 'stopped', ...(llmWikiReason ? { reason: llmWikiReason } : {}) }
  // a program that never answers is most often missing its WebView2 runtime
  const reason = status.reason === 'health check timed out' ? WEBVIEW2_HINT : status.reason
  return { state: status.state, ...(reason ? { reason } : {}), available }
}

export async function openLlmWiki(): Promise<boolean> {
  return (await llmWiki?.show()) ?? false
}

/** (re)start LLM Wiki for the current settings; every failure becomes a status, never an exception */
async function startLlmWiki(): Promise<void> {
  await llmWiki?.stopAndWait()
  llmWiki = null
  llmWikiReason = null
  if (driftTimer) clearInterval(driftTimer)
  driftTimer = null
  const s = readWorkWikiSettings()
  if (!s.enabled || process.platform !== 'win32') return
  const exe = llmWikiExePath(process.resourcesPath, devLlmWikiDir())
  if (!exe) {
    llmWikiReason = 'LLM Wiki is not installed'
    return
  }
  try {
    const aiPath = join(paths!.userData, 'ai-settings.json')
    const ai = llmWikiLlmFromAiSettings(readAiSettingsFile(aiPath))
    const llm = ai.ok ? ai.llm : null
    if (!ai.ok) llmWikiReason = ai.reason
    const projectId = ensureProjectId(s.folder)
    // LLM Wiki watches this folder; it must exist (the engine itself never creates it)
    mkdirSync(join(s.folder, 'raw', 'sources'), { recursive: true })
    const dir = llmWikiDataDir()
    // its settings are written only now, while it is not running
    writeAppState(
      dir,
      seedAppState(readAppState(dir), {
        projectId,
        wikiRoot: s.folder,
        projectName: '업무 위키',
        llm,
        now: Date.now(),
      }),
    )
    const proc = new LlmWikiProcess({
      exePath: exe,
      projectId,
      spawn: realSpawn,
      fetch: realFetch,
      pickPorts: pickFreePorts,
      stale: pidFileStore(join(paths!.userData, 'llm-wiki.pid')),
      // the fork binds pdfium to this file path (not a folder)
      extraEnv: { PDFIUM_DYNAMIC_LIB_PATH: join(dirname(exe), 'pdfium', 'pdfium.dll') },
      log: (m) => console.warn(`[work-wiki] ${m}`),
    })
    llmWiki = proc
    llmWikiSignature = desiredSignature(llm, s.folder)
    await proc.start()
    // a changed model, key or folder in GenOffice restarts it with the new settings
    driftTimer = setInterval(() => {
      const next = llmWikiLlmFromAiSettings(readAiSettingsFile(aiPath))
      if (
        desiredSignature(next.ok ? next.llm : null, readWorkWikiSettings().folder) !==
        llmWikiSignature
      )
        void startLlmWiki()
    }, DRIFT_CHECK_MS)
    driftTimer.unref()
  } catch (err) {
    llmWikiReason = err instanceof Error ? err.message : String(err)
  }
}

/** engine and LLM Wiki stop together; bounded so quitting is never held up */
export async function stopWorkWikiForQuit(): Promise<void> {
  if (driftTimer) clearInterval(driftTimer)
  driftTimer = null
  const old = engine
  engine = null
  await Promise.race([
    Promise.all([old?.stopAndWait(), llmWiki?.stopAndWait()]),
    new Promise((r) => setTimeout(r, 4000)),
  ])
}

const MATERIAL_TEXT = {
  zh: {
    materialFilter: '文档',
    materialAdded: '已向工作维基添加 {n} 份资料。整理完成后 AI 会参考。',
    materialOff: '工作维基已关闭或无法使用。',
  },
  en: {
    materialFilter: 'Documents',
    materialAdded:
      'Added {n} file(s) to the work wiki. The AI will use them once they are organized.',
    materialOff: 'The work wiki is off or unavailable.',
  },
  ko: {
    materialFilter: '문서',
    materialAdded: '업무 위키에 자료 {n}개를 넣었습니다. 정리가 끝나면 AI가 참고합니다.',
    materialOff: '업무 위키가 꺼져 있거나 사용할 수 없습니다.',
  },
} as const

/** Korean, Chinese and English texts; every other language reads the English one */
function tmw(
  lang: Lang,
  key: keyof (typeof MATERIAL_TEXT)['en'],
  params?: Record<string, string | number>,
): string {
  const table =
    lang === 'zh' || lang === 'zh-TW'
      ? MATERIAL_TEXT.zh
      : lang === 'ko'
        ? MATERIAL_TEXT.ko
        : MATERIAL_TEXT.en
  return format(table[key], params)
}

/** ask for files and put them into the wiki's raw/sources; the result is shown in a message box */
export async function addWikiMaterialFromDialog(
  parent: BrowserWindow | null,
): Promise<{ added: number; skipped: number; canceled: boolean }> {
  const s = readWorkWikiSettings()
  const lang = getUiLang()
  if (!s.enabled || !engine?.enabled) {
    await dialog.showMessageBox({ type: 'info', message: tmw(lang, 'materialOff') })
    return { added: 0, skipped: 0, canceled: true }
  }
  const options = {
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    filters: [
      {
        name: tmw(lang, 'materialFilter'),
        extensions: ['hwp', 'hwpx', 'docx', 'pptx', 'xlsx', 'pdf', 'md', 'txt'],
      },
    ],
  }
  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (picked.canceled || picked.filePaths.length === 0)
    return { added: 0, skipped: 0, canceled: true }
  const r = await addMaterial({
    files: picked.filePaths,
    rawSources: join(s.folder, 'raw', 'sources'),
    extractText,
  })
  const lines = [
    tmw(lang, 'materialAdded', { n: r.added.length }),
    ...r.skipped.map((k) => `· ${basename(k.file)}: ${k.reason}`),
  ]
  await dialog.showMessageBox({
    type: r.skipped.length ? 'warning' : 'info',
    message: lines.join(String.fromCharCode(10)),
  })
  return { added: r.added.length, skipped: r.skipped.length, canceled: false }
}

/** settings changed: the old engine finishes its running job before the next one starts */
async function restart(): Promise<void> {
  const old = engine
  engine = null
  await old?.stopAndWait()
  const s = readWorkWikiSettings()
  if (!s.enabled) {
    void startLlmWiki() // stops it; returns early because the wiki is off
    return
  }
  const debounce = Number(process.env.GENOFFICE_WORK_WIKI_DEBOUNCE_MS)
  const next = new WorkWikiEngine({
    root: s.folder,
    stateDir: stateDirFor(s.folder),
    exclude: s.exclude,
    complete: createWikiComplete(join(paths!.userData, 'ai-settings.json')),
    extractText,
    extraSearch: (q) => llmWiki?.search(q) ?? Promise.resolve([]),
    ...(debounce > 0 ? { debounceMs: debounce } : {}),
    log: (m) => console.warn(`[work-wiki] ${m}`),
  })
  if (next.start()) engine = next
  void startLlmWiki()
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
  ipcMain.handle(HOME_CHANNELS.addWikiMaterial, (e) =>
    addWikiMaterialFromDialog(BrowserWindow.fromWebContents(e.sender)),
  )
  ipcMain.handle(HOME_CHANNELS.getLlmWikiStatus, () => llmWikiStatus())
  ipcMain.handle(HOME_CHANNELS.openLlmWiki, () => openLlmWiki())
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
