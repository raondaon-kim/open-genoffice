import { dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { TEAM_LIBRARY_CHANNELS as CHANNELS } from '../shared/team-library-api'
import {
  requireTeamKind,
  TEAM_UPLOAD_EXTENSIONS,
  TeamLibrary,
  TeamLibraryError,
  teamResult,
} from './team-library'
import type { TeamSync } from './team-sync'
import type { TeamTemplates } from './team-templates'

export function registerTeamLibraryIpc(options: {
  library: TeamLibrary
  sync: TeamSync
  templates: TeamTemplates
  /** open a template's working copy and remember which template it came from */
  openTemplateCopy(path: string, templateMd: string): void
  getWindow(): BrowserWindow | null
  openWorkingCopy(path: string): void
  isKorean(): boolean
  /** the folder is one of the home tree's roots (or inside one) and can be written */
  isHomeFolder(path: string): boolean
  /** queue every supported document under a home folder; the number queued */
  syncFolder(folder: string): Promise<number>
  projectName(path: string): string
}): void {
  const { library } = options
  function homeWindow(event: IpcMainInvokeEvent): BrowserWindow {
    const window = options.getWindow()
    if (!window || window.isDestroyed() || event.sender.id !== window.webContents.id) {
      throw new TeamLibraryError('permission')
    }
    return window
  }

  ipcMain.handle(CHANNELS.getFolders, (event) => {
    homeWindow(event)
    return library.getFolders()
  })
  ipcMain.handle(CHANNELS.pickFolder, async (event) => {
    const window = homeWindow(event)
    const picked = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    return picked.canceled ? null : (picked.filePaths[0] ?? null)
  })
  ipcMain.handle(CHANNELS.configure, (event, raw: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      const settings = await library.configure(raw)
      options.sync.retry()
      return settings
    }),
  )
  ipcMain.handle(CHANNELS.list, (event, kind: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      return library.list(requireTeamKind(kind))
    }),
  )
  ipcMain.handle(CHANNELS.useEntry, (event, rawKind: unknown, id: unknown, folder: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      if (folder !== undefined && (typeof folder !== 'string' || !options.isHomeFolder(folder))) {
        throw new TeamLibraryError('invalid-path')
      }
      const path = await library.createWorkingCopy(
        requireTeamKind(rawKind),
        id,
        folder as string | undefined,
      )
      options.openWorkingCopy(path)
      return path
    }),
  )
  ipcMain.handle(CHANNELS.publish, (event, rawKind: unknown) =>
    teamResult(async () => {
      const window = homeWindow(event)
      const kind = requireTeamKind(rawKind)
      await library.root(kind)
      const picked = await dialog.showOpenDialog(window, {
        title: options.isKorean()
          ? kind === 'templates'
            ? '저장된 문서를 팀 템플릿으로 등록'
            : '저장된 문서를 팀에 보내기'
          : kind === 'templates'
            ? 'Register a saved document as a team template'
            : 'Send a saved document to the team',
        filters: [
          {
            name: options.isKorean() ? '문서' : 'Documents',
            // only formats whose numbers can be masked may be written to the NAS
            extensions: TEAM_UPLOAD_EXTENSIONS,
          },
        ],
        properties: ['openFile'],
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      return library.publish(kind, picked.filePaths[0], options.projectName(picked.filePaths[0]))
    }),
  )
  ipcMain.handle(CHANNELS.revealFolder, (event, kind: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      const error = await shell.openPath(await library.root(requireTeamKind(kind)))
      if (error) throw new TeamLibraryError('unavailable')
    }),
  )
  ipcMain.handle(CHANNELS.syncStatus, (event) => {
    homeWindow(event)
    return options.sync.status()
  })
  ipcMain.handle(CHANNELS.retrySync, (event) => {
    homeWindow(event)
    options.sync.retry()
  })
  const { templates } = options
  const text = (v: unknown): string => {
    if (typeof v !== 'string' || v.length > 1_000_000) throw new TeamLibraryError('invalid-path')
    return v
  }
  ipcMain.handle(CHANNELS.templateList, (event) =>
    teamResult(async () => {
      homeWindow(event)
      return templates.list()
    }),
  )
  ipcMain.handle(CHANNELS.templateRebuild, (event) =>
    teamResult(async () => {
      homeWindow(event)
      return templates.rebuildIndex()
    }),
  )
  ipcMain.handle(CHANNELS.templateCandidates, (event) =>
    teamResult(async () => {
      homeWindow(event)
      return templates.candidates()
    }),
  )
  ipcMain.handle(CHANNELS.templateDraft, (event, source: unknown, replaces: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      const s = (source ?? {}) as Record<string, unknown>
      const checked =
        typeof s.loose === 'string'
          ? { loose: text(s.loose) }
          : {
              candidateKey: text(s.candidateKey),
              ...(typeof s.docId === 'string' ? { docId: s.docId } : {}),
            }
      return templates.draft(checked, replaces === undefined ? undefined : text(replaces))
    }),
  )
  ipcMain.handle(CHANNELS.templateConfirm, (event, draftId: unknown, markdown: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      return templates.confirm(text(draftId), text(markdown))
    }),
  )
  ipcMain.handle(CHANNELS.templateRemove, (event, path: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      await templates.remove(text(path))
    }),
  )
  ipcMain.handle(CHANNELS.templateOpen, (event, path: unknown, folder: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      if (folder !== undefined && (typeof folder !== 'string' || !options.isHomeFolder(folder))) {
        throw new TeamLibraryError('invalid-path')
      }
      const opened = await templates.openSet(text(path), folder as string | undefined)
      options.openTemplateCopy(opened.workingCopy, opened.templateMd)
      return opened.workingCopy
    }),
  )
  ipcMain.handle(CHANNELS.syncFolder, (event, folder: unknown) =>
    teamResult(async () => {
      homeWindow(event)
      if (typeof folder !== 'string' || !options.isHomeFolder(folder)) {
        throw new TeamLibraryError('invalid-path')
      }
      if (!library.getFolders().autoSync) throw new TeamLibraryError('not-configured')
      await library.root('documents')
      return options.syncFolder(folder)
    }),
  )
}
