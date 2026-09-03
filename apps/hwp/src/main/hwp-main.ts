import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { BrowserWindow, WebContentsView, app, dialog, ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { installNavigationGuard, safeExternalUrl } from '@genoffice/electron-utils'
import { createI18n, getUiLang } from '@genoffice/i18n'
import { HWP_CHANNELS } from '../shared/ipc'
import type { SaveHwpRequest, SaveHwpResult } from '../shared/ipc'

const tDlg = createI18n({
  zh: {
    closeUnsavedMsg: '此文档有未保存的更改。',
    closeUnsavedDetail: '关闭前是否保存？',
    btnSave: '保存',
    btnDontSave: '不保存',
    btnCancel: '取消',
  },
  en: {
    closeUnsavedMsg: 'This document has unsaved changes.',
    closeUnsavedDetail: 'Do you want to save them before closing?',
    btnSave: 'Save',
    btnDontSave: "Don't Save",
    btnCancel: 'Cancel',
  },
  ja: {
    closeUnsavedMsg: 'このドキュメントに未保存の変更があります。',
    closeUnsavedDetail: '閉じる前に保存しますか？',
    btnSave: '保存',
    btnDontSave: '保存しない',
    btnCancel: 'キャンセル',
  },
  ko: {
    closeUnsavedMsg: '이 문서에 저장하지 않은 변경 사항이 있습니다.',
    closeUnsavedDetail: '닫기 전에 저장하시겠습니까?',
    btnSave: '저장',
    btnDontSave: '저장 안 함',
    btnCancel: '취소',
  },
  fr: {
    closeUnsavedMsg: 'Ce document contient des modifications non enregistrées.',
    closeUnsavedDetail: 'Voulez-vous les enregistrer avant de fermer ?',
    btnSave: 'Enregistrer',
    btnDontSave: 'Ne pas enregistrer',
    btnCancel: 'Annuler',
  },
  de: {
    closeUnsavedMsg: 'Dieses Dokument enthält ungespeicherte Änderungen.',
    closeUnsavedDetail: 'Vor dem Schließen speichern?',
    btnSave: 'Speichern',
    btnDontSave: 'Nicht speichern',
    btnCancel: 'Abbrechen',
  },
  es: {
    closeUnsavedMsg: 'Este documento tiene cambios sin guardar.',
    closeUnsavedDetail: '¿Quieres guardarlos antes de cerrar?',
    btnSave: 'Guardar',
    btnDontSave: 'No guardar',
    btnCancel: 'Cancelar',
  },
  th: {
    closeUnsavedMsg: 'เอกสารนี้มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก',
    closeUnsavedDetail: 'ต้องการบันทึกก่อนปิดหรือไม่?',
    btnSave: 'บันทึก',
    btnDontSave: 'ไม่บันทึก',
    btnCancel: 'ยกเลิก',
  },
  id: {
    closeUnsavedMsg: 'Dokumen ini memiliki perubahan yang belum disimpan.',
    closeUnsavedDetail: 'Simpan sebelum menutup?',
    btnSave: 'Simpan',
    btnDontSave: 'Jangan Simpan',
    btnCancel: 'Batal',
  },
  ru: {
    closeUnsavedMsg: 'В этом документе есть несохранённые изменения.',
    closeUnsavedDetail: 'Сохранить их перед закрытием?',
    btnSave: 'Сохранить',
    btnDontSave: 'Не сохранять',
    btnCancel: 'Отмена',
  },
  ar: {
    closeUnsavedMsg: 'يحتوي هذا المستند على تغييرات غير محفوظة.',
    closeUnsavedDetail: 'هل تريد حفظها قبل الإغلاق؟',
    btnSave: 'حفظ',
    btnDontSave: 'عدم الحفظ',
    btnCancel: 'إلغاء',
  },
  pt: {
    closeUnsavedMsg: 'Este documento tem alterações não salvas.',
    closeUnsavedDetail: 'Deseja salvá-las antes de fechar?',
    btnSave: 'Salvar',
    btnDontSave: 'Não Salvar',
    btnCancel: 'Cancelar',
  },
  it: {
    closeUnsavedMsg: 'Questo documento contiene modifiche non salvate.',
    closeUnsavedDetail: 'Vuoi salvarle prima di chiudere?',
    btnSave: 'Salva',
    btnDontSave: 'Non salvare',
    btnCancel: 'Annulla',
  },
  pl: {
    closeUnsavedMsg: 'Ten dokument ma niezapisane zmiany.',
    closeUnsavedDetail: 'Czy zapisać je przed zamknięciem?',
    btnSave: 'Zapisz',
    btnDontSave: 'Nie zapisuj',
    btnCancel: 'Anuluj',
  },
  nl: {
    closeUnsavedMsg: 'Dit document bevat niet-opgeslagen wijzigingen.',
    closeUnsavedDetail: 'Wilt u ze opslaan voordat u sluit?',
    btnSave: 'Opslaan',
    btnDontSave: 'Niet opslaan',
    btnCancel: 'Annuleren',
  },
  ms: {
    closeUnsavedMsg: 'Dokumen ini mempunyai perubahan yang belum disimpan.',
    closeUnsavedDetail: 'Simpan sebelum menutup?',
    btnSave: 'Simpan',
    btnDontSave: 'Jangan Simpan',
    btnCancel: 'Batal',
  },
  he: {
    closeUnsavedMsg: 'במסמך זה יש שינויים שלא נשמרו.',
    closeUnsavedDetail: 'האם לשמור אותם לפני הסגירה?',
    btnSave: 'שמירה',
    btnDontSave: 'אל תשמור',
    btnCancel: 'ביטול',
  },
  hi: {
    closeUnsavedMsg: 'इस दस्तावेज़ में सहेजे नहीं गए परिवर्तन हैं।',
    closeUnsavedDetail: 'क्या बंद करने से पहले उन्हें सहेजना चाहते हैं?',
    btnSave: 'सहेजें',
    btnDontSave: 'न सहेजें',
    btnCancel: 'रद्द करें',
  },
  'zh-TW': {
    closeUnsavedMsg: '此文件有未儲存的變更。',
    closeUnsavedDetail: '關閉前是否儲存？',
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
const tm = (key: DlgKey) => tDlg(getUiLang(), key)

interface RuntimePaths {
  preloadPath: string
  rendererUrl?: string
  rendererFile?: string
}

let runtime: RuntimePaths = { preloadPath: '' }

export function configureHwpRuntime(paths: RuntimePaths): void {
  runtime = paths
}

/** Open paths queued at tab creation; the renderer consumes them after mount (avoids did-finish-load races) */
const pendingByWc = new Map<number, string>()
/** File paths granted to each view — readFile/save only allow these */
const allowedByWc = new Map<number, Set<string>>()
/** Unsaved-changes flags mirrored from the renderer; drives the save prompt before closing a tab/window */
const dirtyByWc = new Set<number>()
const saveWaiters = new Map<number, (ok: boolean) => void>()

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
    const path = pendingByWc.get(e.sender.id) ?? null
    pendingByWc.delete(e.sender.id)
    return path
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
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

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
    allowedByWc.delete(wcId)
    dirtyByWc.delete(wcId)
    saveWaiters.get(wcId)?.(false)
    saveWaiters.delete(wcId)
  })
}

/**
 * The embedded rhwp studio iframe rejects postMessage from opaque origins
 * (file:/data:), so in production builds the renderer is served over a
 * loopback HTTP origin instead of loadFile(). Dev builds already run on the
 * Vite dev-server origin and bypass this entirely.
 */
const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

let rendererOriginPromise: Promise<string> | null = null

function ensureLoopbackRendererOrigin(): Promise<string> {
  if (rendererOriginPromise) return rendererOriginPromise
  rendererOriginPromise = new Promise<string>((resolveUrl, reject) => {
    const root = runtime.rendererFile ? dirname(resolve(runtime.rendererFile)) : null
    if (!root) {
      reject(new Error('hwp: no renderer output configured'))
      return
    }
    const server = createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end()
        return
      }
      const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      const relative = normalize(urlPath).replace(/^([/\\]|\.\.)+/, '')
      const filePath = resolve(root, relative)
      if (!filePath.startsWith(root + sep) && filePath !== root) {
        res.writeHead(403).end()
        return
      }
      const target = existsSync(filePath) && !filePath.endsWith(sep) ? filePath : join(root, 'index.html')
      void readFile(target)
        .then((bytes) => {
          const ext = target.slice(target.lastIndexOf('.')).toLowerCase()
          res.writeHead(200, {
            'content-type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
            'cache-control': 'no-store',
          })
          res.end(req.method === 'HEAD' ? undefined : bytes)
        })
        .catch(() => res.writeHead(404).end())
    })
    server.on('error', (err) => {
      rendererOriginPromise = null
      reject(err)
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveUrl(`http://127.0.0.1:${port}/index.html`)
    })
  })
  return rendererOriginPromise
}

/** resolve the URL to load for the hwp renderer: dev server, or the loopback origin */
function rendererLoadUrl(): Promise<string> {
  if (runtime.rendererUrl) return Promise.resolve(runtime.rendererUrl)
  return ensureLoopbackRendererOrigin()
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
    const argPath = process.argv
      .slice(1)
      .find((a) => /\.(hwp|hwpx)$/i.test(a) && existsSync(a))
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
