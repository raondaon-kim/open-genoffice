import { constants } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { maskDocument, maskFileName, type MaskOutcome } from '@genoffice/doc-mask'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  TeamErrorCode,
  TeamFolders,
  TeamLibraryEntry,
  TeamLibraryKind,
  TeamLibraryList,
  TeamResult,
} from '../shared/team-library-api'

export const TEAM_DOCUMENT_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'hwp', 'hwpx', 'pdf']
export const TEAM_TEMPLATE_EXTENSIONS = TEAM_DOCUMENT_EXTENSIONS.filter((ext) => ext !== 'pdf')
/** what may be written to the NAS: only formats whose personal and company numbers can be masked */
export const TEAM_UPLOAD_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'hwpx']

export function teamUploadable(path: string): boolean {
  return TEAM_UPLOAD_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())
}

export type TeamMasker = (fileName: string, bytes: Uint8Array) => Promise<MaskOutcome>
const MAX_ENTRIES = 1000
const MAX_NODES = 4000
const MAX_DEPTH = 6
const NAS_TRASH_FOLDERS = new Set([
  'network trashes folder',
  '$recycle.bin',
  '#recycle',
  '@recycle',
])

export function teamFolderName(value: string): string {
  const clean = Array.from(value.normalize('NFC'), (character) =>
    character.charCodeAt(0) < 32 ? '_' : character,
  )
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 70)
  if (!clean || /^\.+$/.test(clean)) return '_'
  return NAS_TRASH_FOLDERS.has(clean.toLowerCase()) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)
    ? `_${clean}`
    : clean
}

export function teamDocumentType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.docx') return 'Word'
  if (extension === '.xlsx') return 'Excel'
  if (extension === '.pptx') return 'PowerPoint'
  if (extension === '.pdf') return 'PDF'
  return 'Hangul'
}

/**
 * The NAS project folder for a saved document: the name of the innermost home folder (the
 * default save folder or a folder the user added to the home tree) that holds it, else "Default".
 */
export function teamProjectName(path: string, roots: readonly string[]): string {
  const target = resolve(path)
  let best: string | null = null
  for (const root of roots) {
    const candidate = resolve(root)
    if (!isWithin(candidate, target)) continue
    if (best === null || candidate.length > best.length) best = candidate
  }
  return best === null ? 'Default' : basename(best) || best
}

/**
 * Supported documents under a local folder, for "send the documents in this folder": breadth
 * first, bounded like the NAS listing; lock files (~$), hidden entries, links and NAS recycle bins
 * are skipped, and unreadable subfolders are passed over.
 */
export async function localTeamDocuments(
  folder: string,
  limits: { maxFiles?: number; maxNodes?: number; maxDepth?: number } = {},
): Promise<string[]> {
  const maxFiles = limits.maxFiles ?? MAX_ENTRIES
  const maxNodes = limits.maxNodes ?? MAX_NODES
  const maxDepth = limits.maxDepth ?? MAX_DEPTH
  const found: string[] = []
  const queue = [{ path: folder, depth: 0 }]
  let nodes = 0
  while (queue.length && found.length < maxFiles && nodes < maxNodes) {
    const directory = queue.shift()!
    let children
    try {
      children = await readdir(directory.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++nodes > maxNodes || found.length >= maxFiles) break
      if (child.name.startsWith('.') || child.name.startsWith('~$') || child.isSymbolicLink()) {
        continue
      }
      const path = join(directory.path, child.name)
      if (child.isDirectory()) {
        if (!NAS_TRASH_FOLDERS.has(child.name.toLowerCase()) && directory.depth < maxDepth) {
          queue.push({ path, depth: directory.depth + 1 })
        }
      } else if (child.isFile() && supported('documents', path)) {
        found.push(path)
      }
    }
  }
  return found
}

export class TeamLibraryError extends Error {
  constructor(readonly code: TeamErrorCode) {
    super(code)
  }
}

export async function teamResult<T>(run: () => Promise<T>): Promise<TeamResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof TeamLibraryError) return { ok: false, error: error.code }
    const code = (error as NodeJS.ErrnoException)?.code
    return {
      ok: false,
      error: code === 'EACCES' || code === 'EPERM' ? 'permission' : 'unavailable',
    }
  }
}

export function requireTeamKind(value: unknown): TeamLibraryKind {
  if (value !== 'templates' && value !== 'documents') throw new TeamLibraryError('invalid-path')
  return value
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function supported(kind: TeamLibraryKind, path: string): boolean {
  const extensions = kind === 'templates' ? TEAM_TEMPLATE_EXTENSIONS : TEAM_DOCUMENT_EXTENSIONS
  return extensions.includes(extname(path).slice(1).toLowerCase())
}

function folderPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('\0') || !isAbsolute(raw.trim())) {
    throw new TeamLibraryError('invalid-path')
  }
  return resolve(raw.trim())
}

async function existingFolder(path: string): Promise<string> {
  const canonical = await realpath(folderPath(path))
  if (!(await stat(canonical)).isDirectory()) throw new TeamLibraryError('invalid-path')
  return canonical
}

async function subfolder(root: string, names: string[]): Promise<string> {
  let current = root
  for (const name of names) {
    const next = join(current, name)
    await mkdir(next).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    current = await realpath(next)
    if (!isWithin(root, current) || !(await stat(current)).isDirectory()) {
      throw new TeamLibraryError('invalid-path')
    }
  }
  return current
}

export class TeamLibrary {
  constructor(
    private readonly readFolders: () => TeamFolders,
    private readonly writeFolders: (folders: TeamFolders) => void,
    private readonly draftsDir: () => string,
    /** every copy written to the NAS goes through it (tests may pass a stand-in) */
    private readonly mask: TeamMasker = maskDocument,
  ) {}

  /**
   * The bytes that may be written to the NAS: the document with phone, resident, business,
   * corporate, account and card numbers and e-mail addresses replaced by placeholders. A format
   * the masker cannot rewrite, or a document it cannot mask completely, is refused.
   */
  private async maskedBytes(source: string): Promise<Uint8Array> {
    if (!teamUploadable(source)) throw new TeamLibraryError('not-maskable')
    const outcome = await this.mask(basename(source), new Uint8Array(await readFile(source)))
    if (!outcome.ok) {
      throw new TeamLibraryError(
        outcome.reason === 'unsupported' ? 'not-maskable' : 'masking-failed',
      )
    }
    return outcome.bytes
  }

  getFolders(): TeamFolders {
    return this.readFolders()
  }

  async configure(raw: unknown): Promise<TeamFolders> {
    if (!raw || typeof raw !== 'object') throw new TeamLibraryError('invalid-path')
    const input = raw as Record<string, unknown>
    if (
      typeof input.memberName !== 'string' ||
      !input.memberName.trim() ||
      input.memberName.length > 70 ||
      typeof input.autoSync !== 'boolean'
    ) {
      throw new TeamLibraryError('invalid-path')
    }
    const folders: TeamFolders = {
      templates: folderPath(input.templates),
      documents: folderPath(input.documents),
      memberName: input.memberName.trim(),
      autoSync: input.autoSync,
    }
    const [templates, documents] = await Promise.all([
      existingFolder(folders.templates),
      existingFolder(folders.documents),
    ])
    if (isWithin(templates, documents) || isWithin(documents, templates)) {
      throw new TeamLibraryError('invalid-path')
    }
    // Readers do not need write access to the templates folder.
    await Promise.all([readdir(templates), readdir(documents)])
    this.writeFolders(folders)
    return folders
  }

  async root(kind: TeamLibraryKind): Promise<string> {
    requireTeamKind(kind)
    const folder = this.getFolders()[kind]
    if (!folder) throw new TeamLibraryError('not-configured')
    return existingFolder(folder)
  }

  async list(kind: TeamLibraryKind): Promise<TeamLibraryList> {
    const root = await this.root(kind)
    const entries: TeamLibraryEntry[] = []
    const queue = [{ path: root, depth: 0 }]
    let nodes = 0
    let partial = false
    while (queue.length && entries.length < MAX_ENTRIES && nodes < MAX_NODES) {
      const directory = queue.shift()!
      let children
      try {
        children = await readdir(directory.path, { withFileTypes: true })
      } catch (error) {
        if (directory.path === root) throw error
        partial = true
        continue
      }
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++nodes > MAX_NODES || entries.length >= MAX_ENTRIES) {
          partial = true
          break
        }
        if (child.name.startsWith('.') || child.name.startsWith('~$') || child.isSymbolicLink())
          continue
        const path = join(directory.path, child.name)
        if (child.isDirectory()) {
          if (NAS_TRASH_FOLDERS.has(child.name.toLowerCase())) continue
          if (directory.depth < MAX_DEPTH) queue.push({ path, depth: directory.depth + 1 })
          else partial = true
        } else if (child.isFile() && supported(kind, path)) {
          try {
            const canonical = await realpath(path)
            if (!isWithin(root, canonical)) continue
            entries.push(await this.entry(root, path))
          } catch {
            partial = true
          }
        }
      }
    }
    return {
      entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
      partial: partial || queue.length > 0,
    }
  }

  private async entry(root: string, path: string): Promise<TeamLibraryEntry> {
    const info = await stat(path)
    if (!info.isFile()) throw new TeamLibraryError('invalid-path')
    return {
      id: relative(root, path).split(sep).join('/'),
      name: basename(path),
      ext: extname(path).slice(1).toLowerCase(),
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    }
  }

  async resolveEntry(kind: TeamLibraryKind, id: unknown): Promise<string> {
    if (
      typeof id !== 'string' ||
      !id ||
      id.length > 4096 ||
      /[\\:\0]/.test(id) ||
      id.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new TeamLibraryError('invalid-path')
    const root = await this.root(kind)
    const path = await realpath(join(root, ...id.split('/')))
    if (!isWithin(root, path) || !(await stat(path)).isFile()) {
      throw new TeamLibraryError('invalid-path')
    }
    if (!supported(kind, path)) throw new TeamLibraryError('unsupported')
    return path
  }

  /** a folder the user may write working copies into: not inside either shared library */
  private async localFolder(raw: string): Promise<string> {
    const folder = await existingFolder(raw)
    for (const kind of ['templates', 'documents'] as const) {
      const shared = this.getFolders()[kind]
      if (!shared) continue
      const sharedRoot = await realpath(shared).catch(() => resolve(shared))
      if (isWithin(sharedRoot, folder)) throw new TeamLibraryError('invalid-path')
    }
    return folder
  }

  async createWorkingCopy(kind: TeamLibraryKind, id: unknown, targetDir?: string): Promise<string> {
    const source = await this.resolveEntry(kind, id)
    if (targetDir !== undefined) {
      // a chosen home folder: the copy sits beside the user's files, never over one of them
      const folder = await this.localFolder(targetDir)
      const extension = extname(source)
      const stem = basename(source, extension)
      for (let index = 1; index <= 1000; index++) {
        const name = index === 1 ? `${stem}${extension}` : `${stem} (${index})${extension}`
        const path = join(folder, name)
        try {
          await copyFile(source, path, constants.COPYFILE_EXCL)
          return path
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
          throw error
        }
      }
      throw new TeamLibraryError('copy-failed')
    }
    const drafts = this.draftsDir()
    const root = await this.root(kind)
    // A local workspace must never be placed inside the shared source library.
    await mkdir(drafts, { recursive: true })
    if (isWithin(root, await realpath(drafts))) throw new TeamLibraryError('invalid-path')
    const workdir = await mkdtemp(join(drafts, 'team-'))
    const path = join(workdir, basename(source))
    try {
      await copyFile(source, path, constants.COPYFILE_EXCL)
      return path
    } catch (error) {
      await rm(workdir, { recursive: true, force: true })
      throw error
    }
  }

  async publish(
    kind: TeamLibraryKind,
    sourcePath: string,
    projectName = 'Default',
  ): Promise<TeamLibraryEntry> {
    const source = await realpath(folderPath(sourcePath))
    if (!supported(kind, source)) throw new TeamLibraryError('unsupported')
    if (!(await stat(source)).isFile()) throw new TeamLibraryError('invalid-path')
    const bytes = await this.maskedBytes(source)
    const base = await this.root(kind)
    const root = await subfolder(
      base,
      kind === 'templates'
        ? [teamDocumentType(source)]
        : [
            teamFolderName(projectName),
            teamFolderName(this.getFolders().memberName),
            teamDocumentType(source),
          ],
    )
    const maskedName = maskFileName(basename(source))
    const extension = extname(maskedName)
    const stem = basename(maskedName, extension)
    // Stage the complete bytes under an ignored name. COPYFILE_EXCL reserves a
    // fresh visible name without relying on a racy exists-check or SMB hard links.
    const staged = join(root, `.genoffice-${randomUUID()}.tmp`)
    try {
      await writeFile(staged, bytes, { flag: 'wx' })
      for (let index = 1; index <= 1000; index++) {
        const name = index === 1 ? `${stem}${extension}` : `${stem} (${index})${extension}`
        const target = join(root, name)
        try {
          await copyFile(staged, target, constants.COPYFILE_EXCL)
          return await this.entry(base, target)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
          throw error
        }
      }
      throw new TeamLibraryError('copy-failed')
    } finally {
      await rm(staged, { force: true }).catch(() => {})
    }
  }

  /** Replace only this installation's stable copy, after staging complete bytes on the NAS. */
  async syncDocument(
    sourcePath: string,
    projectName: string,
    memberName: string,
    documentId: string,
  ): Promise<string> {
    if (!/^[a-f0-9]{16}$/.test(documentId)) throw new TeamLibraryError('invalid-path')
    const source = await realpath(folderPath(sourcePath))
    if (!supported('documents', source)) throw new TeamLibraryError('unsupported')
    const root = await this.root('documents')
    if (isWithin(root, source)) return source
    const bytes = await this.maskedBytes(source)
    const folder = await subfolder(root, [
      teamFolderName(projectName),
      teamFolderName(memberName),
      teamDocumentType(source),
    ])
    const maskedName = maskFileName(basename(source))
    const extension = extname(maskedName)
    const name = `${teamFolderName(basename(maskedName, extension))} [${documentId}]${extension}`
    const target = join(folder, name)
    const staged = join(folder, `.genoffice-${randomUUID()}.tmp`)
    try {
      await writeFile(staged, bytes, { flag: 'wx' })
      await rename(staged, target)
      return target
    } finally {
      await rm(staged, { force: true }).catch(() => {})
    }
  }
}
