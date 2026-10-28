import { WIKI_CHANNELS } from './types'
import type { WorkWikiApi } from './types'

/** the window.workWiki object a preload exposes; invoke is ipcRenderer.invoke */
export function createWorkWikiPreloadApi(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): WorkWikiApi {
  return {
    catalog: (query) => invoke(WIKI_CHANNELS.catalog, query) as Promise<string>,
    index: (category, group) => invoke(WIKI_CHANNELS.index, category, group) as Promise<string>,
    search: (query) => invoke(WIKI_CHANNELS.search, query) as ReturnType<WorkWikiApi['search']>,
    read: (slug) => invoke(WIKI_CHANNELS.read, slug) as ReturnType<WorkWikiApi['read']>,
    remember: (points, work) =>
      invoke(WIKI_CHANNELS.remember, points, work) as ReturnType<WorkWikiApi['remember']>,
    status: () => invoke(WIKI_CHANNELS.status) as ReturnType<WorkWikiApi['status']>,
    addMaterial: (paths) =>
      invoke(WIKI_CHANNELS.addMaterial, paths) as ReturnType<WorkWikiApi['addMaterial']>,
    ensureReady: () =>
      invoke(WIKI_CHANNELS.ensureReady) as ReturnType<NonNullable<WorkWikiApi['ensureReady']>>,
  }
}
