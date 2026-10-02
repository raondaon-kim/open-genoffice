import { contextBridge, ipcRenderer } from 'electron'
import { AI_CHANNELS, HWP_CHANNELS, PROJECT_CHANNELS } from '../shared/ipc'
import type { HwpApi, HwpAiStreamRequest } from '../shared/ipc'

function routeOnlyStreamRequest(request: HwpAiStreamRequest): HwpAiStreamRequest {
  return {
    requestId: request.requestId,
    ...(request.conversation ? { conversation: request.conversation } : {}),
    system: request.system,
    messages: request.messages,
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
  }
}

const api: HwpApi = {
  consumePending: () => ipcRenderer.invoke(HWP_CHANNELS.consumePending),
  readFile: (path) => ipcRenderer.invoke(HWP_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(HWP_CHANNELS.save, request),
  saveAs: (defaultName) => ipcRenderer.invoke(HWP_CHANNELS.saveAs, defaultName),
  createDocument: (markdown, fileName) =>
    ipcRenderer.invoke(HWP_CHANNELS.createDocument, markdown, fileName),
  getStudioUrl: () => ipcRenderer.invoke(HWP_CHANNELS.getStudioUrl),
  aiSnapshot: (request) => ipcRenderer.invoke(HWP_CHANNELS.aiSnapshot, request),
  aiQuery: (request) => ipcRenderer.invoke(HWP_CHANNELS.aiQuery, request),
  aiEdit: (request) => ipcRenderer.invoke(HWP_CHANNELS.aiEdit, request),
  setDirty: (dirty) => ipcRenderer.send(HWP_CHANNELS.dirtyChanged, dirty),
  onSaveRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(HWP_CHANNELS.saveRequest, listener)
    return () => ipcRenderer.removeListener(HWP_CHANNELS.saveRequest, listener)
  },
  sendSaveResult: (ok) => ipcRenderer.send(HWP_CHANNELS.saveResult, ok),
  getLanguage: () => ipcRenderer.invoke(HWP_CHANNELS.getLanguage),
  getAiPublicSettings: () => ipcRenderer.invoke(AI_CHANNELS.getPublicSettings),
  listAiModels: () => ipcRenderer.invoke(AI_CHANNELS.listModels),
  getAiConversationRoute: (identity) =>
    ipcRenderer.invoke(AI_CHANNELS.getConversationRoute, identity),
  setAiConversationRoute: (identity, route) =>
    ipcRenderer.invoke(AI_CHANNELS.setConversationRoute, identity, route),
  aiStream: (request) => ipcRenderer.invoke(AI_CHANNELS.stream, routeOnlyStreamRequest(request)),
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
}

contextBridge.exposeInMainWorld('hwpApi', api)
