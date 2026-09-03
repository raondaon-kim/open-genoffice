import type { Lang } from '@genoffice/i18n'
import type { AiModelSummary, AiRoute, AiStreamChunk } from '@genoffice/ai-provider'
import type { AgentMessage, AgentToolDef } from '@genoffice/agent-core'

export const HWP_EXTENSIONS = ['hwp', 'hwpx'] as const

export const HWP_CHANNELS = {
  consumePending: 'hwp:consume-pending',
  readFile: 'hwp:read-file',
  save: 'hwp:save',
  saveRequest: 'hwp:save-request',
  saveResult: 'hwp:save-result',
  dirtyChanged: 'hwp:dirty-changed',
  getLanguage: 'hwp:get-language',
  languageChanged: 'hwp:language-changed',
} as const

// ---- AI + project chat channels: the shell registers these globally ----

export const AI_CHANNELS = {
  getPublicSettings: 'ai:settings:get-public',
  listModels: 'ai:models:list',
  getConversationRoute: 'ai:conversation:get-route',
  setConversationRoute: 'ai:conversation:set-route',
  stream: 'ai:stream',
  streamCancel: 'ai:stream-cancel',
  streamChunk: 'ai:stream-chunk',
} as const

export const PROJECT_CHANNELS = {
  resolveChat: 'project:resolveChat',
  appendChat: 'project:appendChat',
  loadChat: 'project:loadChat',
} as const

export interface SaveHwpRequest {
  path: string
  /** serialized HWP or HWPX bytes from the rhwp editor */
  data: ArrayBuffer
}

export interface SaveHwpResult {
  ok: boolean
  error?: string
}

export interface AiConversationIdentity {
  projectId: string
  chatId: string
}

export interface PublicAiProvider {
  id: string
  label: string
  status: string
  hasApiKey: boolean
}

/** Renderer-safe AI stream request; provider settings and secrets stay in Electron main. */
export interface HwpAiStreamRequest {
  requestId: string
  conversation?: AiConversationIdentity
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
}

export interface ProjectToolActivity {
  name: string
  summary: string
  isError?: boolean
  input?: string
  output?: string
}

export interface ProjectChatMessage {
  seq: number
  ts: string
  role: 'user' | 'assistant'
  text: string
  tools?: ProjectToolActivity[]
}

export interface HwpApi {
  /** path queued at tab creation; consumed once after mount */
  consumePending(): Promise<string | null>
  readFile(path: string): Promise<ArrayBuffer>
  save(request: SaveHwpRequest): Promise<SaveHwpResult>
  /** mirror the editor's dirty flag into the main process (drives close guards) */
  setDirty(dirty: boolean): void
  /** main → renderer: write pending edits to disk (menu Save / close guard) */
  onSaveRequest(handler: () => void): () => void
  sendSaveResult(ok: boolean): void
  getLanguage(): Promise<Lang>
  // ---- AI ----
  getAiPublicSettings(): Promise<{
    globalDefault: AiRoute
    providers: Array<{
      id: string
      label: string
      status: string
      hasApiKey: boolean
    }>
  }>
  listAiModels(): Promise<{ models: AiModelSummary[] }>
  getAiConversationRoute(identity: AiConversationIdentity): Promise<AiRoute>
  setAiConversationRoute(identity: AiConversationIdentity, route: AiRoute): Promise<AiRoute>
  aiStream(request: HwpAiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  // ---- project chat persistence ----
  resolveProjectChat(args: {
    filePath?: string | null
    tempChatId?: string
  }): Promise<AiConversationIdentity>
  appendProjectChat(args: {
    projectId: string
    chatId: string
    role: 'user' | 'assistant'
    text: string
    tools?: ProjectToolActivity[]
    ai?: { requested: AiRoute }
  }): Promise<void>
  loadProjectChat(args: {
    projectId: string
    chatId: string
    limit?: number
  }): Promise<ProjectChatMessage[]>
}
