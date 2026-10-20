import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { BrowserWindow, WebContentsView, app, dialog, ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import {
  confirmOverwriteIfConflicted,
  installNavigationGuard,
  recordDiskState,
  safeExternalUrl,
} from '@genoffice/electron-utils'
import type { SaveDiskState } from '@genoffice/electron-utils'
import { createI18n, getUiLang } from '@genoffice/i18n'
import { HWP_CHANNELS } from '../shared/ipc'
import type { HwpSaveMode, SaveHwpRequest, SaveHwpResult, StudioUrlResult } from '../shared/ipc'
import { exportDocStyles, loadDocStyles } from './doc-styles'
import { createHwpFromMarkdown } from './hwpforge-client'
import { resolveNativeBinary } from './native-binary-path'
import { createStaticServer } from './static-server'
import type {
  AiEditRequest,
  AiEditResult,
  AiQueryRequest,
  AiQueryResult,
  AiSnapshotRequest,
  AiSnapshotResult,
} from '../shared/ai-contract'
import { runEditChain } from './ai-edit-chain'
import { SnapshotStore } from './ai-snapshots'
import { safeDefaultSaveName } from '../shared/form-names'
import { HwpIntentStore } from './hwp-intents'
import type { NativeBinaryName } from './native-binary-path'
import { runRhwp } from './rhwp-cli'
import { dumpForShape } from './dump-shape'
import { legacyHangulHwpChecked } from './hwp5-legacy'
import { backupBeforeOverwrite, bytesMatchPath } from './save-guard'
import { paragraphsResult } from './rhwp-paragraphs'
import { buildQueryArgs, isAiQueryName } from './rhwp-queries'
import { buildStyledDocument } from './styled-document'
import { registerHwpAttachmentIpc, trackHwpAttachmentView } from './attachments'
import { StyledDrafts } from './styled-drafts'
import type { DraftBlock } from './styled-drafts'
import type { StaticRoot } from './static-server'

const tDlg = createI18n({
  zh: {
    closeUnsavedMsg: '此文档有未保存的更改。',
    closeUnsavedDetail: '关闭前是否保存？',
    saveAsTitle: '另存为',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'HWP 文档',
    filterHwpLegacy: '韩文文档 – 兼容韩文 2005 及更高版本',
    filterHwpx: 'HWPX 文档 – 韩文 2010 及更高版本',
    btnSave: '保存',
    btnDontSave: '不保存',
    btnCancel: '取消',
  },
  en: {
    closeUnsavedMsg: 'This document has unsaved changes.',
    closeUnsavedDetail: 'Do you want to save them before closing?',
    saveAsTitle: 'Save As',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Hangul Documents',
    filterHwpLegacy: 'Hangul Document – opens in Hangul 2005 and later',
    filterHwpx: 'HWPX Document – Hangul 2010 and later',
    btnSave: 'Save',
    btnDontSave: "Don't Save",
    btnCancel: 'Cancel',
  },
  vi: {
    closeUnsavedMsg: 'Tài liệu này có thay đổi chưa lưu.',
    closeUnsavedDetail: 'Bạn có muốn lưu trước khi đóng không?',
    saveAsTitle: 'Lưu thành',
    exportStylesTitle: 'Xuất wiki kiểu tài liệu — chọn thư mục',
    exportStylesOverwrite: 'Ghi đè',
    exportStylesCancel: 'Hủy',
    exportStylesConflict: 'Một số tệp đã tồn tại. Ghi đè chúng?',
    filterHwp: 'Tài liệu Hangul',
    filterHwpLegacy: 'Tài liệu Hangul – mở được trên Hangul 2005 trở lên',
    filterHwpx: 'Tài liệu HWPX – Hangul 2010 trở lên',
    btnSave: 'Lưu',
    btnDontSave: 'Không lưu',
    btnCancel: 'Hủy',
  },
  cs: {
    closeUnsavedMsg: 'Tento dokument obsahuje neuložené změny.',
    closeUnsavedDetail: 'Chcete je před zavřením uložit?',
    saveAsTitle: 'Uložit jako',
    exportStylesTitle: 'Exportovat wiki stylů dokumentů — vyberte složku',
    exportStylesOverwrite: 'Přepsat',
    exportStylesCancel: 'Zrušit',
    exportStylesConflict: 'Některé soubory již existují. Přepsat je?',
    filterHwp: 'Dokumenty Hangul',
    filterHwpLegacy: 'Dokument Hangul – otevře Hangul 2005 a novější',
    filterHwpx: 'Dokument HWPX – Hangul 2010 a novější',
    btnSave: 'Uložit',
    btnDontSave: 'Neukládat',
    btnCancel: 'Zrušit',
  },
  ja: {
    closeUnsavedMsg: 'このドキュメントに未保存の変更があります。',
    closeUnsavedDetail: '閉じる前に保存しますか？',
    saveAsTitle: '名前を付けて保存',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: '한글 ドキュメント',
    filterHwpLegacy: 'ハングル文書 – ハングル 2005 以降で開けます',
    filterHwpx: 'HWPX 文書 – ハングル 2010 以降',
    btnSave: '保存',
    btnDontSave: '保存しない',
    btnCancel: 'キャンセル',
  },
  ko: {
    closeUnsavedMsg: '이 문서에 저장하지 않은 변경 사항이 있습니다.',
    closeUnsavedDetail: '닫기 전에 저장하시겠습니까?',
    saveAsTitle: '다른 이름으로 저장',
    exportStylesTitle: '문서 서식 위키 내보내기 — 폴더를 고르세요',
    exportStylesOverwrite: '덮어쓰기',
    exportStylesCancel: '취소',
    exportStylesConflict: '이미 있는 파일이 있습니다. 덮어쓸까요?',
    filterHwp: '한글 문서',
    filterHwpLegacy: '한글 문서 – 한글 2005 이상에서 열림',
    filterHwpx: 'HWPX 문서 – 한글 2010 이상',
    btnSave: '저장',
    btnDontSave: '저장 안 함',
    btnCancel: '취소',
  },
  fr: {
    closeUnsavedMsg: 'Ce document contient des modifications non enregistrées.',
    closeUnsavedDetail: 'Voulez-vous les enregistrer avant de fermer ?',
    saveAsTitle: 'Enregistrer sous',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Documents Hangul',
    filterHwpLegacy: 'Document Hangul – s’ouvre dans Hangul 2005 et versions ultérieures',
    filterHwpx: 'Document HWPX – Hangul 2010 et versions ultérieures',
    btnSave: 'Enregistrer',
    btnDontSave: 'Ne pas enregistrer',
    btnCancel: 'Annuler',
  },
  de: {
    closeUnsavedMsg: 'Dieses Dokument enthält ungespeicherte Änderungen.',
    closeUnsavedDetail: 'Vor dem Schließen speichern?',
    saveAsTitle: 'Speichern unter',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Hangul-Dokumente',
    filterHwpLegacy: 'Hangul-Dokument – öffnet in Hangul 2005 und neuer',
    filterHwpx: 'HWPX-Dokument – Hangul 2010 und neuer',
    btnSave: 'Speichern',
    btnDontSave: 'Nicht speichern',
    btnCancel: 'Abbrechen',
  },
  es: {
    closeUnsavedMsg: 'Este documento tiene cambios sin guardar.',
    closeUnsavedDetail: '¿Quieres guardarlos antes de cerrar?',
    saveAsTitle: 'Guardar como',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Documentos Hangul',
    filterHwpLegacy: 'Documento Hangul – se abre en Hangul 2005 y posteriores',
    filterHwpx: 'Documento HWPX – Hangul 2010 y posteriores',
    btnSave: 'Guardar',
    btnDontSave: 'No guardar',
    btnCancel: 'Cancelar',
  },
  th: {
    closeUnsavedMsg: 'เอกสารนี้มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก',
    closeUnsavedDetail: 'ต้องการบันทึกก่อนปิดหรือไม่?',
    saveAsTitle: 'บันทึกเป็น',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'เอกสาร Hangul',
    filterHwpLegacy: 'เอกสาร Hangul – เปิดได้ใน Hangul 2005 ขึ้นไป',
    filterHwpx: 'เอกสาร HWPX – Hangul 2010 ขึ้นไป',
    btnSave: 'บันทึก',
    btnDontSave: 'ไม่บันทึก',
    btnCancel: 'ยกเลิก',
  },
  id: {
    closeUnsavedMsg: 'Dokumen ini memiliki perubahan yang belum disimpan.',
    closeUnsavedDetail: 'Simpan sebelum menutup?',
    saveAsTitle: 'Simpan sebagai',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Dokumen Hangul',
    filterHwpLegacy: 'Dokumen Hangul – terbuka di Hangul 2005 ke atas',
    filterHwpx: 'Dokumen HWPX – Hangul 2010 ke atas',
    btnSave: 'Simpan',
    btnDontSave: 'Jangan Simpan',
    btnCancel: 'Batal',
  },
  ru: {
    closeUnsavedMsg: 'В этом документе есть несохранённые изменения.',
    closeUnsavedDetail: 'Сохранить их перед закрытием?',
    saveAsTitle: 'Сохранить как',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Документы Hangul',
    filterHwpLegacy: 'Документ Hangul – открывается в Hangul 2005 и новее',
    filterHwpx: 'Документ HWPX – Hangul 2010 и новее',
    btnSave: 'Сохранить',
    btnDontSave: 'Не сохранять',
    btnCancel: 'Отмена',
  },
  ar: {
    closeUnsavedMsg: 'يحتوي هذا المستند على تغييرات غير محفوظة.',
    closeUnsavedDetail: 'هل تريد حفظها قبل الإغلاق؟',
    saveAsTitle: 'حفظ باسم',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'مستندات Hangul',
    filterHwpLegacy: 'مستند Hangul – يفتح في Hangul 2005 وما بعده',
    filterHwpx: 'مستند HWPX – Hangul 2010 وما بعده',
    btnSave: 'حفظ',
    btnDontSave: 'عدم الحفظ',
    btnCancel: 'إلغاء',
  },
  pt: {
    closeUnsavedMsg: 'Este documento tem alterações não salvas.',
    closeUnsavedDetail: 'Deseja salvá-las antes de fechar?',
    saveAsTitle: 'Salvar como',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Documentos Hangul',
    filterHwpLegacy: 'Documento Hangul – abre no Hangul 2005 e posteriores',
    filterHwpx: 'Documento HWPX – Hangul 2010 e posteriores',
    btnSave: 'Salvar',
    btnDontSave: 'Não Salvar',
    btnCancel: 'Cancelar',
  },
  it: {
    closeUnsavedMsg: 'Questo documento contiene modifiche non salvate.',
    closeUnsavedDetail: 'Vuoi salvarle prima di chiudere?',
    saveAsTitle: 'Salva con nome',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Documenti Hangul',
    filterHwpLegacy: 'Documento Hangul – si apre in Hangul 2005 e successivi',
    filterHwpx: 'Documento HWPX – Hangul 2010 e successivi',
    btnSave: 'Salva',
    btnDontSave: 'Non salvare',
    btnCancel: 'Annulla',
  },
  pl: {
    closeUnsavedMsg: 'Ten dokument ma niezapisane zmiany.',
    closeUnsavedDetail: 'Czy zapisać je przed zamknięciem?',
    saveAsTitle: 'Zapisz jako',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Dokumenty Hangul',
    filterHwpLegacy: 'Dokument Hangul – otwiera się w Hangul 2005 i nowszych',
    filterHwpx: 'Dokument HWPX – Hangul 2010 i nowsze',
    btnSave: 'Zapisz',
    btnDontSave: 'Nie zapisuj',
    btnCancel: 'Anuluj',
  },
  nl: {
    closeUnsavedMsg: 'Dit document bevat niet-opgeslagen wijzigingen.',
    closeUnsavedDetail: 'Wilt u ze opslaan voordat u sluit?',
    saveAsTitle: 'Opslaan als',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Hangul-documenten',
    filterHwpLegacy: 'Hangul-document – opent in Hangul 2005 en later',
    filterHwpx: 'HWPX-document – Hangul 2010 en later',
    btnSave: 'Opslaan',
    btnDontSave: 'Niet opslaan',
    btnCancel: 'Annuleren',
  },
  ms: {
    closeUnsavedMsg: 'Dokumen ini mempunyai perubahan yang belum disimpan.',
    closeUnsavedDetail: 'Simpan sebelum menutup?',
    saveAsTitle: 'Simpan sebagai',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Dokumen Hangul',
    filterHwpLegacy: 'Dokumen Hangul – dibuka dalam Hangul 2005 dan ke atas',
    filterHwpx: 'Dokumen HWPX – Hangul 2010 dan ke atas',
    btnSave: 'Simpan',
    btnDontSave: 'Jangan Simpan',
    btnCancel: 'Batal',
  },
  he: {
    closeUnsavedMsg: 'במסמך זה יש שינויים שלא נשמרו.',
    closeUnsavedDetail: 'האם לשמור אותם לפני הסגירה?',
    saveAsTitle: 'שמירה בשם',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'מסמכי Hangul',
    filterHwpLegacy: 'מסמך Hangul – נפתח ב-Hangul 2005 ואילך',
    filterHwpx: 'מסמך HWPX – Hangul 2010 ואילך',
    btnSave: 'שמירה',
    btnDontSave: 'אל תשמור',
    btnCancel: 'ביטול',
  },
  hi: {
    closeUnsavedMsg: 'इस दस्तावेज़ में सहेजे नहीं गए परिवर्तन हैं।',
    closeUnsavedDetail: 'क्या बंद करने से पहले उन्हें सहेजना चाहते हैं?',
    saveAsTitle: 'इस रूप में सहेजें',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'Hangul दस्तावेज़',
    filterHwpLegacy: 'Hangul दस्तावेज़ – Hangul 2005 और बाद में खुलता है',
    filterHwpx: 'HWPX दस्तावेज़ – Hangul 2010 और बाद',
    btnSave: 'सहेजें',
    btnDontSave: 'न सहेजें',
    btnCancel: 'रद्द करें',
  },
  'zh-TW': {
    closeUnsavedMsg: '此文件有未儲存的變更。',
    closeUnsavedDetail: '關閉前是否儲存？',
    saveAsTitle: '另存新檔',
    exportStylesTitle: 'Export the document-style wiki — choose a folder',
    exportStylesOverwrite: 'Overwrite',
    exportStylesCancel: 'Cancel',
    exportStylesConflict: 'Some of these files already exist. Overwrite them?',
    filterHwp: 'HWP 文件',
    filterHwpLegacy: '韓文文件 – 相容韓文 2005 及更新版本',
    filterHwpx: 'HWPX 文件 – 韓文 2010 及更新版本',
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
  | 'exportStylesTitle'
  | 'exportStylesOverwrite'
  | 'exportStylesCancel'
  | 'exportStylesConflict'
  | 'filterHwp'
  | 'filterHwpLegacy'
  | 'filterHwpx'
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
  /** bundled document-style wiki pages (apps/hwp/resources/doc-styles; packaged: modules/hwp-doc-styles) */
  docStylesDir?: string
  /** rhwp native CLI — the AI tools' engine for reading/editing snapshots */
  rhwpPath?: string
}

let runtime: RuntimePaths = { preloadPath: '' }

export function configureHwpRuntime(paths: RuntimePaths): void {
  runtime = paths
}

/**
 * What each view should open (a path, a blank document, a copy of a form); the
 * renderer consumes it after mount (avoids did-finish-load races). Blank and
 * form views get no path until Save As.
 */
const intents = new HwpIntentStore()
/** File paths granted to each view — readFile/save only allow these */
const allowedByWc = new Map<number, Set<string>>()
/**
 * Paths the app has already written this session, by any view: the first overwrite of a
 * file keeps a .bak of the user's original. Shared across views so a split-pane copy of
 * the same document does not replace that .bak with the other copy's save.
 */
const writtenThisSession = new Set<string>()
/** Unsaved-changes flags mirrored from the renderer; drives the save prompt before closing a tab/window */
const dirtyByWc = new Set<number>()
const saveWaiters = new Map<number, (ok: boolean) => void>()
/**
 * What each view last read or wrote of a path. While the same document is open as a
 * split-pane copy pair, a save compares this with the disk to tell whether the sibling
 * copy changed the file (see save-conflict in @genoffice/electron-utils).
 */
const diskStatesByWc = new Map<number, Map<string, SaveDiskState>>()

/** Record what the file holds now; an unreadable file leaves no record and no conflict. */
async function rememberDiskState(wcId: number, path: string): Promise<void> {
  const state = await recordDiskState(path)
  if (!state) return
  const states = diskStatesByWc.get(wcId) ?? new Map<string, SaveDiskState>()
  states.set(path, state)
  diskStatesByWc.set(wcId, states)
}

/** Mark the view as a fresh blank document instead of a file-backed one. */
export function markHwpNewBlank(webContentsId: number): void {
  intents.markBlank(webContentsId)
}

/** Open a COPY of a form in this view: bytes and name only, no path is granted. */
export function queueHwpForm(
  webContentsId: number,
  form: { fileName: string; data: ArrayBuffer },
): void {
  intents.queueForm(webContentsId, form)
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

function requestRendererSave(contents: WebContents, mode: HwpSaveMode = 'save'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      saveWaiters.delete(contents.id)
      resolve(false)
    }, 120_000)
    saveWaiters.set(contents.id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    contents.send(HWP_CHANNELS.saveRequest, mode)
  })
}

/** Menu Save: ask the renderer to write pending edits to disk; clean views resolve true immediately */
export function flushHwpSave(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(true)
  if (!dirtyByWc.has(contents.id)) return Promise.resolve(true)
  return requestRendererSave(contents)
}

/** Menu Save As: the renderer asks for a destination and writes the document there */
export function requestHwpSaveAs(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(false)
  return requestRendererSave(contents, 'saveAs')
}

/** exportHwpx bytes above this are refused — IPC copy + CLI parse would stall the tab */
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024

let snapshotStore: SnapshotStore | null = null

function snapshots(): SnapshotStore {
  if (!snapshotStore) {
    snapshotStore = new SnapshotStore({ rootDir: join(app.getPath('userData'), 'ai-snapshots') })
    app.once('will-quit', () => {
      void snapshotStore?.disposeAll()
    })
  }
  return snapshotStore
}

/** shared lookup for the bundled helpers: shell-injected path → env → resources/native → dev tree */
/** a file base name that is safe on every platform */
function safeBaseName(name: string): string {
  const cleaned = Array.from(name)
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
    .join('')
    .trim()
    .replace(/\.(hwpx?)$/i, '')
    .slice(0, 80)
  return cleaned || 'document'
}

/** writes <base>.hwpx, or <base> (2).hwpx … — never over an existing file, even when two calls race */
async function writeUniqueHwpx(dir: string, base: string, data: Uint8Array): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = join(dir, n === 1 ? `${base}.hwpx` : `${base} (${n}).hwpx`)
    try {
      await writeFile(candidate, data, { flag: 'wx' })
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('too many files with this name')
}

function nativeBinary(name: NativeBinaryName): string {
  const rhwp = name === 'rhwp'
  return resolveNativeBinary(name, {
    runtimePath: rhwp ? runtime.rhwpPath : runtime.hwpforgePath,
    envPath: rhwp ? process.env.RHWP_CLI_PATH : process.env.HWPFORGE_MCP_PATH,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    // apps/shell or apps/hwp → repo root
    repoRoot: join(app.getAppPath(), '..', '..'),
    platform: process.platform,
    arch: process.arch,
  })
}

function rhwpBinary(): { ok: true; path: string } | { ok: false; error: string } {
  const path = nativeBinary('rhwp')
  return existsSync(path)
    ? { ok: true, path }
    : { ok: false, error: `rhwp binary not found: ${path}` }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

let ipcRegistered = false

function registerHwpIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  registerHwpAttachmentIpc()

  ipcMain.handle(HWP_CHANNELS.consumePending, (e) => intents.consume(e.sender.id))

  ipcMain.handle(HWP_CHANNELS.readFile, async (e, path: unknown) => {
    if (typeof path !== 'string' || !allowedByWc.get(e.sender.id)?.has(path)) {
      throw new Error('hwp: path not granted to this view')
    }
    const buf = await readFile(path)
    await rememberDiskState(e.sender.id, path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle(HWP_CHANNELS.save, async (e, request: SaveHwpRequest): Promise<SaveHwpResult> => {
    const path = request?.path
    if (typeof path !== 'string' || !allowedByWc.get(e.sender.id)?.has(path)) {
      return { ok: false, error: 'hwp: path not granted to this view' }
    }
    try {
      let bytes: Uint8Array = new Uint8Array(request.data)
      if (bytes.byteLength === 0) return { ok: false, error: 'hwp: empty save payload' }
      // the bytes must be the format the file name says (an .hwpx is a zip, an .hwp a compound file)
      if (!bytesMatchPath(bytes, path)) {
        return { ok: false, error: 'hwp: the exported bytes do not match the file type' }
      }
      // an .hwp is written so older Hangul (2005 and up) opens it too; a re-packed file that
      // fails its own check is dropped in favour of what rhwp wrote
      if (/\.hwp$/i.test(path)) {
        const legacy = legacyHangulHwpChecked(bytes)
        if (!legacy.repacked) {
          console.warn('hwp: kept the rhwp bytes, the Hangul 2005 re-pack did not check out')
        }
        bytes = legacy.bytes
      }
      // split-pane copy pair: when the sibling copy changed the file after this copy read
      // or wrote it, ask before overwriting; a file open nowhere else saves as before.
      // This runs before the backup and the write, so neither happens when declined.
      const verdict = await confirmOverwriteIfConflicted({
        parent: BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow(),
        path,
        recorded: diskStatesByWc.get(e.sender.id)?.get(path),
        lang: getUiLang(),
      })
      if (verdict === 'cancel') return { ok: false, canceled: true }
      // the user's original is kept as <name>.bak before the app's first overwrite of it
      const backupPath = await backupBeforeOverwrite(path, writtenThisSession)
      // Temp file + rename for atomic replace; a mid-write crash won't corrupt the original
      const tmp = `${path}.gensave-${process.pid}.tmp`
      await writeFile(tmp, bytes)
      await rename(tmp, path)
      await rememberDiskState(e.sender.id, path)
      // first save of an untitled doc / title + recent-file updates
      runtime.onSaved?.(e.sender.id, path)
      return backupPath ? { ok: true, backupPath } : { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Save As for untitled tabs: pick a destination (and grant it) without writing yet —
  // the renderer exports and calls HWP_CHANNELS.save with the granted path.
  ipcMain.handle(
    HWP_CHANNELS.saveAs,
    async (
      e,
      defaultName: unknown,
    ): Promise<SaveHwpResult & { path?: string; canceled?: boolean }> => {
      const parent = BrowserWindow.fromWebContents(e.sender)
      // a form copy proposes "<form>_작성.<ext>"; only a bare file name is accepted
      const defaultPath = safeDefaultSaveName(defaultName)
      // the file type picked decides the format; the suggested name's type comes first
      const hwp = { name: tm('filterHwpLegacy'), extensions: ['hwp'] }
      const hwpx = { name: tm('filterHwpx'), extensions: ['hwpx'] }
      const options = {
        title: tm('saveAsTitle'),
        defaultPath,
        filters: /\.hwpx$/i.test(defaultPath) ? [hwpx, hwp] : [hwp, hwpx],
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
          binPath: nativeBinary('hwpforge-mcp'),
        },
      )
      if (result.ok && result.path) runtime.onCreateDocument?.(result.path)
      return result
    },
  )

  ipcMain.handle(HWP_CHANNELS.listDocStyles, () => {
    if (!runtime.docStylesDir)
      return { ok: false as const, error: 'hwp: the style wiki is not available in this build' }
    const { pages, errors } = loadDocStyles(runtime.docStylesDir)
    return {
      ok: true as const,
      styles: pages.map((p) => ({
        id: p.style.id,
        title: p.style.title,
        draft: p.style.draft === true,
        evidence: p.style.evidence,
      })),
      errors,
    }
  })

  ipcMain.handle(HWP_CHANNELS.readDocStyle, (_e, id: unknown) => {
    if (typeof id !== 'string' || !runtime.docStylesDir)
      return { ok: false as const, error: 'hwp: unknown style' }
    const page = loadDocStyles(runtime.docStylesDir).pages.find((p) => p.style.id === id)
    return page
      ? { ok: true as const, style: page.style, description: page.description }
      : { ok: false as const, error: `hwp: no style "${id}"` }
  })

  const drafts = new StyledDrafts()
  ipcMain.handle(HWP_CHANNELS.createStyledDocument, async (_e, request: unknown) => {
    const bad = (error: string) => ({ ok: false as const, error })
    if (!runtime.docStylesDir) return bad('hwp: the style wiki is not available in this build')
    const req = request as {
      style?: unknown
      blocks?: unknown
      fileName?: unknown
      draftId?: unknown
      done?: unknown
    } | null
    if (!req || typeof req.style !== 'string' || !Array.isArray(req.blocks)) {
      return bad('hwp: createStyledDocument needs a style id and blocks')
    }
    const page = loadDocStyles(runtime.docStylesDir).pages.find((p) => p.style.id === req.style)
    if (!page) return bad(`hwp: no style "${req.style}"`)
    // a stage's blocks are checked when it arrives, so an error points at that stage
    const roleIds = new Set(page.style.roles.map((r) => r.id))
    const stage: DraftBlock[] = []
    for (const [i, b] of (req.blocks as unknown[]).entries()) {
      const block = b as { role?: unknown; text?: unknown } | null
      if (typeof block?.role !== 'string' || !roleIds.has(block.role)) {
        return bad(
          `block ${i + 1}: unknown role "${String(block?.role)}" — roles are ${[...roleIds].join(', ')}`,
        )
      }
      if (typeof block.text !== 'string') return bad(`block ${i + 1}: text must be a string`)
      stage.push({ role: block.role, text: block.text })
    }
    // staged writing: done:false keeps the blocks in a draft; the call with done (default) builds it
    const done = req.done !== false
    const draftId = typeof req.draftId === 'string' && req.draftId ? req.draftId : undefined
    let blocks = stage
    if (!done || draftId) {
      const added = drafts.add(req.style, stage, draftId)
      if (!added.ok) return bad(added.error)
      if (!done) {
        return {
          ok: true as const,
          staged: true as const,
          draftId: added.draftId,
          paragraphs: added.blocks.length,
        }
      }
      blocks = drafts.take(added.draftId) ?? stage
    }
    const bin = rhwpBinary()
    if (!bin.ok) return bad(bin.error)
    const outDir = join(app.getPath('userData'), 'ai-created')
    await mkdir(outDir, { recursive: true })
    const workDir = await mkdtemp(join(outDir, '.styled-'))
    try {
      const built = await buildStyledDocument(page.style, blocks, {
        rhwpPath: bin.path,
        workDir,
      })
      if (!built.ok) return bad(built.error)
      const base = safeBaseName(typeof req.fileName === 'string' ? req.fileName : page.style.title)
      const path = await writeUniqueHwpx(outDir, base, built.data)
      runtime.onCreateDocument?.(path)
      return {
        ok: true as const,
        path,
        paragraphs: built.paragraphs,
        roleCounts: built.roleCounts,
        warnings: built.warnings,
      }
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })

  ipcMain.handle(HWP_CHANNELS.exportDocStyles, async (e) => {
    if (!runtime.docStylesDir)
      return { ok: false as const, error: 'hwp: the style wiki is not available in this build' }
    const parent = BrowserWindow.fromWebContents(e.sender)
    const options = {
      title: tm('exportStylesTitle'),
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
    }
    const picked = await (parent && !parent.isDestroyed()
      ? dialog.showOpenDialog(parent, options)
      : dialog.showOpenDialog(options))
    if (picked.canceled || !picked.filePaths[0]) return { ok: false as const, canceled: true }
    let result = exportDocStyles(runtime.docStylesDir, picked.filePaths[0], { overwrite: false })
    if (!result.ok && result.error !== undefined) return { ok: false as const, error: result.error }
    if (!result.ok) {
      const answer = await dialog.showMessageBox({
        type: 'question',
        buttons: [tm('exportStylesOverwrite'), tm('exportStylesCancel')],
        defaultId: 1,
        cancelId: 1,
        message: `${tm('exportStylesConflict')}\n${result.conflicts.join(', ')}`,
      })
      if (answer.response !== 0) return { ok: false as const, canceled: true }
      result = exportDocStyles(runtime.docStylesDir, picked.filePaths[0], { overwrite: true })
    }
    return result.ok
      ? { ok: true as const, target: result.target, count: result.count }
      : { ok: false as const, error: result.error ?? 'hwp: export failed' }
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

  ipcMain.handle(HWP_CHANNELS.getStudioUrl, () => studioUrl())

  ipcMain.handle(
    HWP_CHANNELS.aiSnapshot,
    async (e, request: AiSnapshotRequest): Promise<AiSnapshotResult> => {
      if (!request || typeof request.sha !== 'string' || !(request.data instanceof ArrayBuffer)) {
        return { ok: false, error: 'hwp: malformed snapshot request' }
      }
      if (request.data.byteLength > MAX_SNAPSHOT_BYTES) {
        const mb = (request.data.byteLength / 1048576).toFixed(1)
        return { ok: false, error: `hwp: document too large for the AI tools (${mb} MB > 50 MB)` }
      }
      const put = await snapshots().put(e.sender.id, request.sha, new Uint8Array(request.data))
      return put.ok ? { ok: true } : { ok: false, error: put.error }
    },
  )

  ipcMain.handle(
    HWP_CHANNELS.aiQuery,
    async (e, request: AiQueryRequest): Promise<AiQueryResult> => {
      if (!request || typeof request.sha !== 'string' || !isAiQueryName(request.tool)) {
        return { ok: false, error: 'hwp: malformed query request' }
      }
      const path = snapshots().path(e.sender.id, request.sha)
      if (!path) return { ok: false, error: 'hwp: snapshot missing — send it again' }
      const bin = rhwpBinary()
      if (!bin.ok) return bin
      const built = buildQueryArgs(request.tool, request.args ?? {}, path)
      if (!built.ok) return { ok: false, error: built.error }
      try {
        if (request.tool === 'paragraphs') {
          const dumped = await dumpForShape(runRhwp, bin.path, path)
          return { ok: true, result: paragraphsResult(dumped) }
        }
        return { ok: true, result: await runRhwp(bin.path, built.args) }
      } catch (err) {
        return { ok: false, error: errorText(err) }
      }
    },
  )

  ipcMain.handle(HWP_CHANNELS.aiEdit, async (e, request: AiEditRequest): Promise<AiEditResult> => {
    const preflight = (error: string): AiEditResult => ({
      ok: false,
      failedOp: null,
      error,
      journal: [],
    })
    if (!request || typeof request.sha !== 'string') return preflight('hwp: malformed edit request')
    const path = snapshots().path(e.sender.id, request.sha)
    if (!path) return preflight('hwp: snapshot missing — send it again')
    const bin = rhwpBinary()
    if (!bin.ok) return preflight(bin.error)
    const result = await runEditChain({
      rhwpPath: bin.path,
      snapshotPath: path,
      workDir: snapshots().ownerDir(e.sender.id),
      ops: request.ops,
    })
    // the renderer reloads these bytes; caching them now spares a resend on the next read
    if (result.ok) await snapshots().put(e.sender.id, result.outputSha, new Uint8Array(result.data))
    return result
  })
}

function grantAndTrack(wc: WebContents, openPath?: string | null): void {
  const wcId = wc.id
  if (openPath && existsSync(openPath)) {
    intents.queuePath(wcId, openPath)
    allowedByWc.set(wcId, new Set([openPath]))
  }
  // External links opened from inside the embedded studio go to the system browser
  wc.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url, { allowedProtocols: ['http:', 'https:', 'mailto:'] })
    if (target) void shell.openExternal(target)
    return { action: 'deny' }
  })
  wc.once('destroyed', () => {
    intents.forget(wcId)
    allowedByWc.delete(wcId)
    diskStatesByWc.delete(wcId)
    dirtyByWc.delete(wcId)
    saveWaiters.get(wcId)?.(false)
    saveWaiters.delete(wcId)
    void snapshotStore?.dispose(wcId)
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
  trackHwpAttachmentView(view.webContents)
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
    // dev: apps/hwp/out/main → apps/hwp/dist/studio
    studioDir: join(__dirname, '../../dist/studio'),
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
