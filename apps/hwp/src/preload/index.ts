import { contextBridge, ipcRenderer } from 'electron'
import { createWorkWikiPreloadApi } from '@genoffice/work-wiki'
import { splitPaneBridge } from '@genoffice/electron-utils/split-pane-bridge'
import type { AiPanelPrefs } from '@genoffice/ui/ai-panel-prefs'
import {
  AI_CHANNELS,
  AI_PANEL_PREFS_CHANNELS,
  HWP_CHANNELS,
  PROJECT_CHANNELS,
  THEME_CHANNELS,
} from '../shared/ipc'
import type { HwpApi, UiTheme } from '../shared/ipc'

const api: HwpApi = {
  consumePending: () => ipcRenderer.invoke(HWP_CHANNELS.consumePending),
  readFile: (path) => ipcRenderer.invoke(HWP_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(HWP_CHANNELS.save, request),
  saveAs: (defaultName) => ipcRenderer.invoke(HWP_CHANNELS.saveAs, defaultName),
  createDocument: (markdown, fileName) =>
    ipcRenderer.invoke(HWP_CHANNELS.createDocument, markdown, fileName),
  listDocStyles: () => ipcRenderer.invoke(HWP_CHANNELS.listDocStyles),
  readDocStyle: (id) => ipcRenderer.invoke(HWP_CHANNELS.readDocStyle, id),
  createStyledDocument: (request) => ipcRenderer.invoke(HWP_CHANNELS.createStyledDocument, request),
  exportDocStyles: () => ipcRenderer.invoke(HWP_CHANNELS.exportDocStyles),
  getStudioUrl: () => ipcRenderer.invoke(HWP_CHANNELS.getStudioUrl),
  aiSnapshot: (request) => ipcRenderer.invoke(HWP_CHANNELS.aiSnapshot, request),
  aiQuery: (request) => ipcRenderer.invoke(HWP_CHANNELS.aiQuery, request),
  aiEdit: (request) => ipcRenderer.invoke(HWP_CHANNELS.aiEdit, request),
  setDirty: (dirty) => ipcRenderer.send(HWP_CHANNELS.dirtyChanged, dirty),
  onSaveRequest: (handler) => {
    const listener = (_e: unknown, mode?: unknown) => handler(mode === 'saveAs' ? 'saveAs' : 'save')
    ipcRenderer.on(HWP_CHANNELS.saveRequest, listener)
    return () => ipcRenderer.removeListener(HWP_CHANNELS.saveRequest, listener)
  },
  sendSaveResult: (ok) => ipcRenderer.send(HWP_CHANNELS.saveResult, ok),
  getLanguage: () => ipcRenderer.invoke(HWP_CHANNELS.getLanguage),
  getTheme: () => ipcRenderer.invoke(THEME_CHANNELS.getTheme),
  pickAttachments: () => ipcRenderer.invoke(HWP_CHANNELS.pickAttachments),
  readAttachment: (path, offset, maxChars) =>
    ipcRenderer.invoke(HWP_CHANNELS.readAttachment, path, offset, maxChars),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(THEME_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(THEME_CHANNELS.themeChanged, listener)
  },
  getAiPanelPrefs: () => ipcRenderer.invoke(AI_PANEL_PREFS_CHANNELS.get),
  setAiPanelPrefs: (patch) => ipcRenderer.invoke(AI_PANEL_PREFS_CHANNELS.set, patch),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, prefs: AiPanelPrefs) => handler(prefs)
    ipcRenderer.on(AI_PANEL_PREFS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(AI_PANEL_PREFS_CHANNELS.changed, listener)
  },
  getAiSettings: () => ipcRenderer.invoke(AI_CHANNELS.getSettings),
  aiStream: (request) => ipcRenderer.invoke(AI_CHANNELS.stream, request),
  aiStreamCancel: (requestId) => ipcRenderer.invoke(AI_CHANNELS.streamCancel, requestId),
  onAiStream: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, chunk: Parameters<typeof handler>[0]) =>
      handler(chunk)
    ipcRenderer.on(AI_CHANNELS.streamChunk, listener)
    return () => ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener)
  },
  resolveProjectChat: (args) => ipcRenderer.invoke(PROJECT_CHANNELS.resolveChat, args),
  appendProjectChat: (args) => ipcRenderer.invoke(PROJECT_CHANNELS.appendChat, args),
  loadProjectChat: (args) => ipcRenderer.invoke(PROJECT_CHANNELS.loadChat, args),
  rebindProjectChat: (args) => ipcRenderer.invoke(PROJECT_CHANNELS.rebindChat, args),
}

contextBridge.exposeInMainWorld('hwpApi', api)
// the work wiki (shell-registered wiki:* channels) for the assistant
contextBridge.exposeInMainWorld(
  'workWiki',
  createWorkWikiPreloadApi((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
)
// The shell's split panes: this view's pane role, and its way to ask for focus
contextBridge.exposeInMainWorld('aiOfficeSplit', splitPaneBridge(ipcRenderer))
