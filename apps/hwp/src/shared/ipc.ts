import type { Lang } from '@genoffice/i18n'
import type { DocStyle } from './doc-style'
import type { AiSettings, AiStreamChunk, AiStreamRequest } from '@genoffice/ai-provider'
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
  listDocStyles: 'hwp:list-doc-styles',
  readDocStyle: 'hwp:read-doc-style',
  createStyledDocument: 'hwp:create-styled-document',
  exportDocStyles: 'hwp:export-doc-styles',
  getStudioUrl: 'hwp:get-studio-url',
  aiSnapshot: 'hwp:ai-snapshot',
  aiQuery: 'hwp:ai-query',
  aiEdit: 'hwp:ai-edit',
  getLanguage: 'hwp:get-language',
  languageChanged: 'hwp:language-changed',
} as const

// ---- AI + project chat channels: the shell registers these globally ----

/** the suite's UI theme; 'system' follows the OS */
export type UiTheme = 'light' | 'dark' | 'system'

/** app-wide theme channels (the shell answers and broadcasts them to every tab) */
export const THEME_CHANNELS = {
  getTheme: 'app:get-theme',
  themeChanged: 'app:theme-changed',
} as const

/** AI channels are app-wide shared ipcMain handlers (the shell registers them); pass-through only */
export const AI_CHANNELS = {
  getSettings: 'ai:get-settings',
  stream: 'ai:stream',
  streamChunk: 'ai:stream-chunk',
  streamCancel: 'ai:stream-cancel',
} as const

export const PROJECT_CHANNELS = {
  resolveChat: 'project:resolveChat',
  appendChat: 'project:appendChat',
  loadChat: 'project:loadChat',
  rebindChat: 'project:rebindChat',
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

export interface DocStyleSummary {
  id: string
  title: string
  draft: boolean
  evidence: { documents: number; note: string }
}

export interface CreateStyledDocumentRequest {
  style: string
  blocks: Array<{ role: string; text: string }>
  fileName?: string
}

export type CreateStyledDocumentResult =
  | {
      ok: true
      path: string
      paragraphs: number
      roleCounts: Record<string, number>
      warnings: string[]
    }
  | { ok: false; error: string }

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
  /** tab-start intent queued at view creation; consumed once after mount */
  consumePending(): Promise<HwpOpenIntent | null>
  readFile(path: string): Promise<ArrayBuffer>
  save(request: SaveHwpRequest): Promise<SaveHwpResult>
  /** ask main for a destination path for an untitled document (Save As); grants the returned path for this view */
  saveAs(defaultName?: string): Promise<SaveHwpResult & { path?: string; canceled?: boolean }>
  /**
   * Compile Markdown (GFM tables included) into a NEW .hwpx document via the
   * HwpForge generator and open it in a new tab. Returns the created path.
   */
  createDocument(markdown: string, fileName?: string): Promise<CreateDocumentResult>
  /** the bundled document-style wiki: list, read one page, create a document from it, export the pages */
  listDocStyles(): Promise<
    { ok: true; styles: DocStyleSummary[]; errors: string[] } | { ok: false; error: string }
  >
  readDocStyle(
    id: string,
  ): Promise<{ ok: true; style: DocStyle; description: string } | { ok: false; error: string }>
  createStyledDocument(request: CreateStyledDocumentRequest): Promise<CreateStyledDocumentResult>
  exportDocStyles(): Promise<
    { ok: true; target: string; count: number } | { ok: false; canceled?: boolean; error?: string }
  >
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
  getTheme(): Promise<UiTheme>
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  // ---- AI ----
  getAiSettings(): Promise<AiSettings>
  aiStream(request: AiStreamRequest): Promise<void>
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
  }): Promise<void>
  loadProjectChat(args: {
    projectId: string
    chatId: string
    limit?: number
  }): Promise<ProjectChatMessage[]>
  /** move an unsaved-* conversation to the file it was first saved as */
  rebindProjectChat(args: {
    projectId: string
    tempChatId: string
    newFilePath: string
  }): Promise<AiConversationIdentity>
}
