export type TeamLibraryKind = 'templates' | 'documents'

export interface TeamFolders {
  templates: string
  documents: string
  memberName: string
  autoSync: boolean
}

export interface TeamSyncEntry {
  id: string
  name: string
  projectName: string
  status: 'pending' | 'uploading' | 'synced' | 'error'
  updatedAt: string
  remotePath?: string
  error?: TeamErrorCode
}

export interface TeamLibraryEntry {
  /** Relative to the configured folder; never an arbitrary source path. */
  id: string
  name: string
  ext: string
  sizeBytes: number
  mtimeMs: number
}

export type TeamErrorCode =
  | 'not-configured'
  | 'unavailable'
  | 'permission'
  | 'invalid-path'
  | 'unsupported'
  | 'copy-failed'
  | 'open-failed'
  /** .hwp and .pdf: the masker cannot rewrite them, so they are not sent */
  | 'not-maskable'
  /** an embedded object the masker cannot open, or a number left after masking */
  | 'masking-failed'

export type TeamResult<T> = { ok: true; value: T } | { ok: false; error: TeamErrorCode }

export interface TeamLibraryList {
  entries: TeamLibraryEntry[]
  /** A large library or an unreadable subfolder can yield a partial list. */
  partial: boolean
}

export interface TeamLibraryApi {
  getFolders(): Promise<TeamFolders>
  /** Choose an existing folder using the operating system's authenticated connection. */
  pickFolder(): Promise<string | null>
  configure(folders: TeamFolders): Promise<TeamResult<TeamFolders>>
  list(kind: TeamLibraryKind): Promise<TeamResult<TeamLibraryList>>
  /** Open a local working copy, leaving the shared original untouched. */
  /** folder: a home folder to create the working copy in (default: Documents/GenOffice/Team) */
  useEntry(kind: TeamLibraryKind, id: string, folder?: string): Promise<TeamResult<string>>
  /** Choose a saved file and publish a new copy; existing files are never replaced. */
  publish(kind: TeamLibraryKind): Promise<TeamResult<TeamLibraryEntry | null>>
  revealFolder(kind: TeamLibraryKind): Promise<TeamResult<void>>
  syncStatus(): Promise<TeamSyncEntry[]>
  retrySync(): Promise<void>
  /** queue every supported document in a home folder; resolves to the number queued */
  syncFolder(folder: string): Promise<TeamResult<number>>
}

export const TEAM_LIBRARY_CHANNELS = {
  getFolders: 'team-library:get-folders',
  pickFolder: 'team-library:pick-folder',
  configure: 'team-library:configure',
  list: 'team-library:list',
  useEntry: 'team-library:use-entry',
  publish: 'team-library:publish',
  revealFolder: 'team-library:reveal-folder',
  syncStatus: 'team-library:sync-status',
  retrySync: 'team-library:retry-sync',
  syncFolder: 'team-library:sync-folder',
} as const
