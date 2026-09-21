import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { BrowserWindow, WebContentsView, app, dialog, ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { installNavigationGuard, safeExternalUrl } from '@genoffice/electron-utils'
import { createI18n, getUiLang } from '@genoffice/i18n'
import { HWP_CHANNELS } from '../shared/ipc'
import type { SaveHwpRequest, SaveHwpResult, StudioUrlResult } from '../shared/ipc'
import { createHwpFromMarkdown } from './hwpforge-client'
import { resolveNativeBinary } from './native-binary-path'
import { createStaticServer } from './static-server'
import type { StaticRoot } from './static-server'

const tDlg = createI18n({
  zh: {
    closeUnsavedMsg: '此文档有未保存的更改。',
    closeUnsavedDetail: '关闭前是否保存？',
    saveAsTitle: '另存为',
    filterHwp: 'HWP 文档',
    btnSave: '保存',
    btnDontSave: '不保存',
    btnCancel: '取消',
  },
  en: {
    closeUnsavedMsg: 'This document has unsaved changes.',
    closeUnsavedDetail: 'Do you want to save them before closing?',
    saveAsTitle: 'Save As',
    filterHwp: 'Hangul Documents',
    btnSave: 'Save',
    btnDontSave: "Don't Save",
    btnCancel: 'Cancel',
  },
  ja: {
    closeUnsavedMsg: 'このドキュメントに未保存の変更があります。',
    closeUnsavedDetail: '閉じる前に保存しますか？',
    saveAsTitle: '名前を付けて保存',
    filterHwp: '한글 ドキュメント',
    btnSave: '保存',
    btnDontSave: '保存しない',
    btnCancel: 'キャンセル',
  },
  ko: {
    closeUnsavedMsg: '이 문서에 저장하지 않은 변경 사항이 있습니다.',
    closeUnsavedDetail: '닫기 전에 저장하시겠습니까?',
    saveAsTitle: '다른 이름으로 저장',
    filterHwp: '한글 문서',
    btnSave: '저장',
    btnDontSave: '저장 안 함',
    btnCancel: '취소',
  },
  fr: {
    closeUnsavedMsg: 'Ce document contient des modifications non enregistrées.',
    closeUnsavedDetail: 'Voulez-vous les enregistrer avant de fermer ?',
    saveAsTitle: 'Enregistrer sous',
    filterHwp: 'Documents Hangul',
    btnSave: 'Enregistrer',
    btnDontSave: 'Ne pas enregistrer',
    btnCancel: 'Annuler',
  },
  de: {
    closeUnsavedMsg: 'Dieses Dokument enthält ungespeicherte Änderungen.',
    closeUnsavedDetail: 'Vor dem Schließen speichern?',
    saveAsTitle: 'Speichern unter',
    filterHwp: 'Hangul-Dokumente',
    btnSave: 'Speichern',
    btnDontSave: 'Nicht speichern',
    btnCancel: 'Abbrechen',
  },
  es: {
    closeUnsavedMsg: 'Este documento tiene cambios sin guardar.',
    closeUnsavedDetail: '¿Quieres guardarlos antes de cerrar?',
    saveAsTitle: 'Guardar como',
    filterHwp: 'Documentos Hangul',
    btnSave: 'Guardar',
    btnDontSave: 'No guardar',
    btnCancel: 'Cancelar',
  },
  th: {
    closeUnsavedMsg: 'เอกสารนี้มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก',
    closeUnsavedDetail: 'ต้องการบันทึกก่อนปิดหรือไม่?',
    saveAsTitle: 'บันทึกเป็น',
    filterHwp: 'เอกสาร Hangul',
    btnSave: 'บันทึก',
    btnDontSave: 'ไม่บันทึก',
    btnCancel: 'ยกเลิก',
  },
  id: {
    closeUnsavedMsg: 'Dokumen ini memiliki perubahan yang belum disimpan.',
    closeUnsavedDetail: 'Simpan sebelum menutup?',
    saveAsTitle: 'Simpan sebagai',
    filterHwp: 'Dokumen Hangul',
    btnSave: 'Simpan',
    btnDontSave: 'Jangan Simpan',
    btnCancel: 'Batal',
  },
  ru: {
    closeUnsavedMsg: 'В этом документе есть несохранённые изменения.',
    closeUnsavedDetail: 'Сохранить их перед закрытием?',
    saveAsTitle: 'Сохранить как',
    filterHwp: 'Документы Hangul',
    btnSave: 'Сохранить',
    btnDontSave: 'Не сохранять',
    btnCancel: 'Отмена',
  },
  ar: {
    closeUnsavedMsg: 'يحتوي هذا المستند على تغييرات غير محفوظة.',
    closeUnsavedDetail: 'هل تريد حفظها قبل الإغلاق؟',
    saveAsTitle: 'حفظ باسم',
    filterHwp: 'مستندات Hangul',
    btnSave: 'حفظ',
    btnDontSave: 'عدم الحفظ',
    btnCancel: 'إلغاء',
  },
  pt: {
    closeUnsavedMsg: 'Este documento tem alterações não salvas.',
    closeUnsavedDetail: 'Deseja salvá-las antes de fechar?',
    saveAsTitle: 'Salvar como',
    filterHwp: 'Documentos Hangul',
    btnSave: 'Salvar',
    btnDontSave: 'Não Salvar',
    btnCancel: 'Cancelar',
  },
  it: {
    closeUnsavedMsg: 'Questo documento contiene modifiche non salvate.',
    closeUnsavedDetail: 'Vuoi salvarle prima di chiudere?',
    saveAsTitle: 'Salva con nome',
    filterHwp: 'Documenti Hangul',
    btnSave: 'Salva',
    btnDontSave: 'Non salvare',
    btnCancel: 'Annulla',
  },
  pl: {
    closeUnsavedMsg: 'Ten dokument ma niezapisane zmiany.',
    closeUnsavedDetail: 'Czy zapisać je przed zamknięciem?',
    saveAsTitle: 'Zapisz jako',
    filterHwp: 'Dokumenty Hangul',
    btnSave: 'Zapisz',
    btnDontSave: 'Nie zapisuj',
    btnCancel: 'Anuluj',
  },
  nl: {
    closeUnsavedMsg: 'Dit document bevat niet-opgeslagen wijzigingen.',
    closeUnsavedDetail: 'Wilt u ze opslaan voordat u sluit?',
    saveAsTitle: 'Opslaan als',
    filterHwp: 'Hangul-documenten',
    btnSave: 'Opslaan',
    btnDontSave: 'Niet opslaan',
    btnCancel: 'Annuleren',
  },
  ms: {
    closeUnsavedMsg: 'Dokumen ini mempunyai perubahan yang belum disimpan.',
    closeUnsavedDetail: 'Simpan sebelum menutup?',
    saveAsTitle: 'Simpan sebagai',
    filterHwp: 'Dokumen Hangul',
    btnSave: 'Simpan',
    btnDontSave: 'Jangan Simpan',
    btnCancel: 'Batal',
  },
  he: {
    closeUnsavedMsg: 'במסמך זה יש שינויים שלא נשמרו.',
    closeUnsavedDetail: 'האם לשמור אותם לפני הסגירה?',
    saveAsTitle: 'שמירה בשם',
    filterHwp: 'מסמכי Hangul',
    btnSave: 'שמירה',
    btnDontSave: 'אל תשמור',
    btnCancel: 'ביטול',
  },
  hi: {
    closeUnsavedMsg: 'इस दस्तावेज़ में सहेजे नहीं गए परिवर्तन हैं।',
    closeUnsavedDetail: 'क्या बंद करने से पहले उन्हें सहेजना चाहते हैं?',
    saveAsTitle: 'इस रूप में सहेजें',
    filterHwp: 'Hangul दस्तावेज़',
    btnSave: 'सहेजें',
    btnDontSave: 'न सहेजें',
    btnCancel: 'रद्द करें',
  },
  'zh-TW': {
    closeUnsavedMsg: '此文件有未儲存的變更。',
    closeUnsavedDetail: '關閉前是否儲存？',
    saveAsTitle: '另存新檔',
    filterHwp: 'HWP 文件',
    btnSave: '儲存',
    btnDontSave: '不儲存',
    btnCancel: '取消',
  },
})

type DlgKey =
  | 'closeUnsavedMsg'
  | 'closeUnsavedDetail'
  | 'btnSave'
  | 'btnDontSave'
  | 'btnCancel'
  | 'saveAsTitle'
  | 'filterHwp'
const tm = (key: DlgKey) => tDlg(getUiLang(), key)

interface RuntimePaths {
  preloadPath: string
  rendererUrl?: string
  rendererFile?: string
  /** called after a successful save so the shell can retitle the tab and record the file */
  onSaved?: (webContentsId: number, path: string) => void
  /** called when the HwpForge generator created a new document so the shell can open it in a tab */
  onCreateDocument?: (path: string) => void
  /** HwpForge MCP platform binary; the shell injects it, dev falls back to node_modules */
  hwpforgePath?: string
  /** built rhwp studio (index.html + wasm + fonts); served under STUDIO_PREFIX on the loopback origin */
  studioDir?: string
  /** rhwp native CLI (Phase 2 AI tools); injected by the shell, unused in Phase 1 */
  rhwpPath?: string
}

let runtime: RuntimePaths = { preloadPath: '' }

export function configureHwpRuntime(paths: RuntimePaths): void {
  runtime = paths
}

/** Open paths queued at tab creation; the renderer consumes them after mount (avoids did-finish-load races) */
const pendingByWc = new Map<number, string>()
/** Views created for a new (untitled) document — no path is granted until Save As */
const blankByWc = new Set<number>()
/** File paths granted to each view — readFile/save only allow these */
const allowedByWc = new Map<number, Set<string>>()
/** Unsaved-changes flags mirrored from the renderer; drives the save prompt before closing a tab/window */
const dirtyByWc = new Set<number>()
const saveWaiters = new Map<number, (ok: boolean) => void>()

/** Mark the view as a fresh blank document instead of a file-backed one. */
export function markHwpNewBlank(webContentsId: number): void {
  blankByWc.add(webContentsId)
}

export function hwpIsDirty(webContentsId: number): boolean {
  return dirtyByWc.has(webContentsId)
}

/**
 * Close guard for the hwp renderer: true means proceed with closing.
 * Clean → true; dirty → Save / Don't Save / Cancel. On Save, ask the renderer to
 * write to disk and await the result; on failure or timeout stay open (renderer
 * has already shown the error).
 */
export async function requestHwpClose(
  contents: WebContents,
  parent?: BrowserWindow | null,
): Promise<boolean> {
  if (!dirtyByWc.has(contents.id) || contents.isDestroyed()) return true
  const options = {
    type: 'warning' as const,
    message: tm('closeUnsavedMsg'),
    detail: tm('closeUnsavedDetail'),
    buttons: [tm('btnSave'), tm('btnDontSave'), tm('btnCancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
  if (response === 2) return false
  if (response === 1) return true
  return await requestRendererSave(contents)
}

function requestRendererSave(contents: WebContents): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      saveWaiters.delete(contents.id)
      resolve(false)
    }, 120_000)
    saveWaiters.set(contents.id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    contents.send(HWP_CHANNELS.saveRequest)
  })
}

/** Menu Save: ask the renderer to write pending edits to disk; clean views resolve true immediately */
export function flushHwpSave(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(true)
  if (!dirtyByWc.has(contents.id)) return Promise.resolve(true)
  return requestRendererSave(contents)
}

let ipcRegistered = false

function registerHwpIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle(HWP_CHANNELS.consumePending, (e) => {
    const blank = blankByWc.delete(e.sender.id)
    if (blank) return { mode: 'blank' }
    const path = pendingByWc.get(e.sender.id) ?? null
    pendingByWc.delete(e.sender.id)
    return path ? { mode: 'open', path } : null
  })

  ipcMain.handle(HWP_CHANNELS.readFile, async (e, path: unknown) => {
    if (typeof path !== 'string' || !allowedByWc.get(e.sender.id)?.has(path)) {
      throw new Error('hwp: path not granted to this view')
    }
    const buf = await readFile(path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle(HWP_CHANNELS.save, async (e, request: SaveHwpRequest): Promise<SaveHwpResult> => {
    const path = request?.path
    if (typeof path !== 'string' || !allowedByWc.get(e.sender.id)?.has(path)) {
      return { ok: false, error: 'hwp: path not granted to this view' }
    }
    try {
      const bytes = new Uint8Array(request.data)
      if (bytes.byteLength === 0) return { ok: false, error: 'hwp: empty save payload' }
      // Temp file + rename for atomic replace; a mid-write crash won't corrupt the original
      const tmp = `${path}.gensave-${process.pid}.tmp`
      await writeFile(tmp, bytes)
      await rename(tmp, path)
      // first save of an untitled doc / title + recent-file updates
      runtime.onSaved?.(e.sender.id, path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Save As for untitled tabs: pick a destination (and grant it) without writing yet —
  // the renderer exports and calls HWP_CHANNELS.save with the granted path.
  ipcMain.handle(
    HWP_CHANNELS.saveAs,
    async (e): Promise<SaveHwpResult & { path?: string; canceled?: boolean }> => {
      const parent = BrowserWindow.fromWebContents(e.sender)
      const options = {
        title: tm('saveAsTitle'),
        defaultPath: 'untitled.hwp',
        filters: [{ name: tm('filterHwp'), extensions: ['hwp', 'hwpx'] }],
      }
      const result =
        parent && !parent.isDestroyed()
          ? await dialog.showSaveDialog(parent, options)
          : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      const path = result.filePath
      if (!/\.(hwp|hwpx)$/i.test(path))
        return { ok: false, error: 'hwp: destination must end in .hwp or .hwpx' }
      const allowed = allowedByWc.get(e.sender.id) ?? new Set<string>()
      allowed.add(path)
      allowedByWc.set(e.sender.id, allowed)
      return { ok: true, path }
    },
  )

  // Rich document creation: compile Markdown (with tables) into a new .hwpx
  // via the HwpForge generator, then ask the shell to open it in a new tab.
  ipcMain.handle(
    HWP_CHANNELS.createDocument,
    async (_event, markdown: unknown, fileName?: unknown) => {
      if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 400_000) {
        return { ok: false, error: 'hwp: createDocument needs markdown text' }
      }
      const baseName =
        typeof fileName === 'string' && fileName.trim() ? fileName.trim() : 'document'
      const result = await createHwpFromMarkdown(
        markdown,
        join(app.getPath('userData'), 'ai-created'),
        baseName,
        {
          binPath: resolveNativeBinary('hwpforge-mcp', {
            runtimePath: runtime.hwpforgePath,
            envPath: process.env.HWPFORGE_MCP_PATH,
            isPackaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            // apps/shell or apps/hwp → repo root
            repoRoot: join(app.getAppPath(), '..', '..'),
            platform: process.platform,
            arch: process.arch,
          }),
        },
      )
      if (result.ok && result.path) runtime.onCreateDocument?.(result.path)
      return result
    },
  )

  ipcMain.on(HWP_CHANNELS.dirtyChanged, (e, dirty: unknown) => {
    if (dirty === true) dirtyByWc.add(e.sender.id)
    else dirtyByWc.delete(e.sender.id)
  })

  ipcMain.on(HWP_CHANNELS.saveResult, (e, ok: unknown) => {
    const waiter = saveWaiters.get(e.sender.id)
    saveWaiters.delete(e.sender.id)
    waiter?.(ok === true)
  })

  // Language channel shared with other modules; removeHandler tolerates duplicate registration
  ipcMain.removeHandler(HWP_CHANNELS.getLanguage)
  ipcMain.handle(HWP_CHANNELS.getLanguage, () => getUiLang())

  ipcMain.handle(HWP_CHANNELS.getStudioUrl, () => studioUrl())
}

function grantAndTrack(wc: WebContents, openPath?: string | null): void {
  const wcId = wc.id
  if (openPath && existsSync(openPath)) {
    pendingByWc.set(wcId, openPath)
    allowedByWc.set(wcId, new Set([openPath]))
  }
  // External links opened from inside the embedded studio go to the system browser
  wc.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url, { allowedProtocols: ['http:', 'https:', 'mailto:'] })
    if (target) void shell.openExternal(target)
    return { action: 'deny' }
  })
  wc.once('destroyed', () => {
    pendingByWc.delete(wcId)
    blankByWc.delete(wcId)
    allowedByWc.delete(wcId)
    dirtyByWc.delete(wcId)
    saveWaiters.get(wcId)?.(false)
    saveWaiters.delete(wcId)
  })
}

/** URL prefix under which the bundled rhwp studio is served on the loopback origin */
const STUDIO_PREFIX = '/rhwp/'

let loopbackOriginPromise: Promise<string> | null = null

function studioIndexExists(): boolean {
  return Boolean(runtime.studioDir && existsSync(join(runtime.studioDir, 'index.html')))
}

/**
 * One loopback HTTP origin serves the renderer (production builds; dev uses the
 * Vite origin) and the bundled rhwp studio (always). The studio SDK rejects
 * postMessage from opaque origins (file:/data:), and serving the studio locally
 * is what makes Hangul editing work offline. The studio root is registered only
 * when its assets exist so the renderer still comes up to show the error.
 */
function ensureLoopbackOrigin(): Promise<string> {
  if (loopbackOriginPromise) return loopbackOriginPromise
  loopbackOriginPromise = (async () => {
    const roots: StaticRoot[] = []
    if (runtime.rendererFile) {
      roots.push({ prefix: '/', dir: dirname(resolve(runtime.rendererFile)), spaFallback: true })
    }
    if (runtime.studioDir && studioIndexExists()) {
      roots.push({ prefix: STUDIO_PREFIX, dir: runtime.studioDir, spaFallback: false })
    }
    if (roots.length === 0) throw new Error('hwp: no renderer output configured')
    const server = await createStaticServer({ roots })
    return server.origin
  })()
  loopbackOriginPromise.catch(() => {
    loopbackOriginPromise = null
  })
  return loopbackOriginPromise
}

/** resolve the URL to load for the hwp renderer: dev server, or the loopback origin */
function rendererLoadUrl(): Promise<string> {
  if (runtime.rendererUrl) return Promise.resolve(runtime.rendererUrl)
  return ensureLoopbackOrigin().then((origin) => `${origin}/index.html`)
}

/** loopback URL of the bundled studio, or a message telling the user/dev what is missing */
async function studioUrl(): Promise<StudioUrlResult> {
  if (!studioIndexExists()) {
    return {
      ok: false,
      error: app.isPackaged
        ? 'Bundled HWP editor assets are missing — reinstall Open GenOffice.'
        : 'HWP studio is not built — run: npm run build -w @genoffice/hwp',
    }
  }
  try {
    const origin = await ensureLoopbackOrigin()
    return { ok: true, url: `${origin}${STUDIO_PREFIX}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function createHwpView(openPath?: string | null): WebContentsView {
  registerHwpIpc()
  const view = new WebContentsView({
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  grantAndTrack(view.webContents, openPath)
  void rendererLoadUrl()
    .then((url) => {
      if (!view.webContents.isDestroyed()) void view.webContents.loadURL(url)
    })
    .catch((err) => {
      // last resort: file:// still renders the shell of the page (no studio bridge)
      if (!view.webContents.isDestroyed() && runtime.rendererFile)
        void view.webContents.loadFile(runtime.rendererFile)
      console.error('[hwp] loopback renderer server failed:', err)
    })
  return view
}

/** Standalone window mode: `npm run dev -w @genoffice/hwp`, hwp path passed via argv */
export function startHwpStandalone(): void {
  installNavigationGuard(app)
  configureHwpRuntime({
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: join(__dirname, '../renderer/index.html'),
    // dev: apps/hwp/out/main → apps/hwp/studio-dist
    studioDir: join(__dirname, '../../studio-dist'),
  })
  void app.whenReady().then(() => {
    registerHwpIpc()
    const win = new BrowserWindow({
      width: 1200,
      height: 850,
      webPreferences: {
        preload: runtime.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const argPath = process.argv.slice(1).find((a) => /\.(hwp|hwpx)$/i.test(a) && existsSync(a))
    grantAndTrack(win.webContents, argPath)
    void rendererLoadUrl()
      .then((url) => {
        if (!win.isDestroyed()) void win.loadURL(url)
      })
      .catch((err) => {
        console.error('[hwp] loopback renderer server failed:', err)
        if (!win.isDestroyed() && runtime.rendererFile) void win.loadFile(runtime.rendererFile)
      })
  })
  app.on('window-all-closed', () => app.quit())
}
