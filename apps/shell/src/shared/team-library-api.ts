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
  /** a template still holds words of the document it was made from (detail: the line) */
  | 'source-words'
  /** another member replaced or removed the template meanwhile */
  | 'changed'
  /** the AI could not draft the template definition */
  | 'draft-failed'
  /** template.md does not parse or does not match its form (detail: why) */
  | 'invalid-template'
  /** the template's folder is gone; the list was repaired */
  | 'moved'

export type TeamResult<T> =
  { ok: true; value: T } | { ok: false; error: TeamErrorCode; detail?: string }

/** one template set as the 팀 템플릿 list shows it */
export interface TeamTemplateSet {
  /** relative to the templates folder, with a trailing slash: `Word/KOICA-ODA-기술제안서/` */
  path: string
  title: string
  kind: string
  purpose: string
  /** computed when read: the form changed since the md was written, or a file is missing */
  status: 'ok' | 'stale-md' | 'broken'
  hash8: string
}

export interface TeamTemplateList {
  sets: TeamTemplateSet[]
  /** files in the templates folder that are not in a set (the 0.5.7 layout) */
  loose: TeamLibraryEntry[]
  /** this member can write to the templates folder */
  writable: boolean
  /** the index did not match the folders and was repaired (in memory when not writable) */
  repaired: boolean
}

export interface TeamTemplateCandidate {
  /** the group's signature hash */
  key: string
  /** newest first; docs[0] is the representative */
  docs: Array<{ id: string; name: string; mtimeMs: number }>
  /** false when headings were guessed */
  certain: boolean
  /** the set that already has this form */
  coveredBy?: string
}

export interface TeamTemplateDraftView {
  draftId: string
  /** template.md as drafted; the reviewer edits it */
  markdown: string
  formHeadings: string[]
  headerFooter: Record<string, string>
  coverLabels: string[]
  /** the set this draft replaces (다시 만들기) */
  replaces?: string
}

export type TeamTemplateSource = { candidateKey: string; docId?: string } | { loose: string }

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
  /** template sets from index.md plus one listing per kind folder */
  templateList(): Promise<TeamResult<TeamTemplateList>>
  /** Word documents in the team documents folder grouped by form */
  templateCandidates(): Promise<TeamResult<TeamTemplateCandidate[]>>
  /** a reviewable template.md and form for a candidate or a loose file; replaces = 다시 만들기 */
  templateDraft(
    source: TeamTemplateSource,
    replaces?: string,
  ): Promise<TeamResult<TeamTemplateDraftView>>
  /** writes the set (the only NAS write besides remove) */
  templateConfirm(draftId: string, markdown: string): Promise<TeamResult<TeamTemplateSet>>
  templateRemove(path: string): Promise<TeamResult<void>>
  /** a local working copy of the set's form, opened in Word; folder = a home folder */
  templateOpen(
    path: string,
    folder?: string,
  ): Promise<TeamResult<{ path: string; status: TeamTemplateSet['status'] }>>
  /** index.md rebuilt from the sets on disk */
  templateRebuild(): Promise<TeamResult<TeamTemplateList>>
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
  templateList: 'team-library:template-list',
  templateCandidates: 'team-library:template-candidates',
  templateDraft: 'team-library:template-draft',
  templateConfirm: 'team-library:template-confirm',
  templateRemove: 'team-library:template-remove',
  templateOpen: 'team-library:template-open',
  templateRebuild: 'team-library:template-rebuild',
} as const
