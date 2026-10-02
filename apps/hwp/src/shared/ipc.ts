import type { Lang } from '@genoffice/i18n'
import type { AiModelSummary, AiRoute, AiStreamChunk } from '@genoffice/ai-provider'
import type { AgentMessage, AgentToolDef } from '@genoffice/agent-core'
import type {
  AiEditRequest,
  AiEditResult,
  AiQueryRequest,
  AiQueryResult,
  AiSnapshotRequest,
  AiSnapshotResult,
} from './ai-contract'

export const HWP_EXTENSIONS = ['hwp', 'hwpx'] as const

export const HWP_CHANNELS = {
  consumePending: 'hwp:consume-pending',
  readFile: 'hwp:read-file',
  save: 'hwp:save',
  saveAs: 'hwp:save-as',
  saveRequest: 'hwp:save-request',
  saveResult: 'hwp:save-result',
  dirtyChanged: 'hwp:dirty-changed',
  createDocument: 'hwp:create-document',
  getStudioUrl: 'hwp:get-studio-url',
  aiSnapshot: 'hwp:ai-snapshot',
  aiQuery: 'hwp:ai-query',
  aiEdit: 'hwp:ai-edit',
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

export interface CreateDocumentResult {
  ok: boolean
  path?: string
  error?: string
}

/** Where the renderer should point the rhwp studio iframe (served from the loopback origin). */
export type StudioUrlResult = { ok: true; url: string } | { ok: false; error: string }

/** What this tab should do once its renderer mounts. */
export type HwpOpenIntent =
  | { mode: 'open'; path: string }
  | { mode: 'blank' }
  /** a copy of a form file: bytes and name only — the tab cannot save over the form */
  | { mode: 'form'; fileName: string; data: ArrayBuffer }

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
  reasoning?: string
  thinking?: string
}

export interface HwpApi {
  /** tab-start intent queued at view creation; consumed once after mount */
  consumePending(): Promise<HwpOpenIntent | null>
  readFile(path: string): Promise<ArrayBuffer>
  save(request: SaveHwpRequest): Promise<SaveHwpResult>
  /** ask main for a destination path for an untitled document (Save As); grants the returned path for this view */
  saveAs(): Promise<SaveHwpResult & { path?: string; canceled?: boolean }>
  /**
   * Compile Markdown (GFM tables included) into a NEW .hwpx document via the
   * HwpForge generator and open it in a new tab. Returns the created path.
   */
  createDocument(markdown: string, fileName?: string): Promise<CreateDocumentResult>
  /** loopback URL of the bundled rhwp studio; fails when studio assets are not built/installed */
  getStudioUrl(): Promise<StudioUrlResult>
  // ---- AI tools (Phase 2): snapshot → rhwp CLI in main ----
  /** cache the current document bytes in main under their documentSha256 */
  aiSnapshot(request: AiSnapshotRequest): Promise<AiSnapshotResult>
  /** run an allow-listed read query on a cached snapshot */
  aiQuery(request: AiQueryRequest): Promise<AiQueryResult>
  /** apply an edit-op chain to a cached snapshot and return the edited bytes */
  aiEdit(request: AiEditRequest): Promise<AiEditResult>
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
    reasoning?: string
    thinking?: string
    ai?: { requested: AiRoute }
  }): Promise<void>
  loadProjectChat(args: {
    projectId: string
    chatId: string
    limit?: number
  }): Promise<ProjectChatMessage[]>
}
