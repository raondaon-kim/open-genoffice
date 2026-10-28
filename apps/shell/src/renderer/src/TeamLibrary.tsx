import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TeamFolders,
  TeamLibraryApi,
  TeamLibraryEntry,
  TeamLibraryKind,
  TeamSyncEntry,
} from '../../shared/team-library-api'
import type { FolderRoot } from '../../shared/home-api'
import { useI18n } from './locale'
import { teamError, teamStrings } from './team-library-strings'
import './team-library.css'

declare global {
  interface Window {
    aiOfficeTeam?: TeamLibraryApi
  }
}

export function TeamLibrary({
  project,
  kind,
}: {
  project?: Pick<FolderRoot, 'path' | 'name'>
  kind: TeamLibraryKind
}) {
  const { lang, dateLocale } = useI18n()
  const text = teamStrings(lang)
  const api = window.aiOfficeTeam!
  const [settings, setSettings] = useState<TeamFolders | null>(null)
  const [draft, setDraft] = useState<TeamFolders>({
    templates: '',
    documents: '',
    memberName: '',
    autoSync: true,
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [entries, setEntries] = useState<TeamLibraryEntry[]>([])
  const [partial, setPartial] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [extension, setExtension] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [authorFilter, setAuthorFilter] = useState('')
  const [uploads, setUploads] = useState<TeamSyncEntry[]>([])
  const request = useRef(0)
  const configured = Boolean(settings?.templates && settings?.documents)

  const refresh = useCallback(async () => {
    const id = ++request.current
    setLoading(true)
    setError('')
    try {
      const result = await api.list(kind)
      if (id !== request.current) return
      if (result.ok) {
        setEntries(result.value.entries)
        setPartial(result.value.partial)
      } else {
        setEntries([])
        setError(teamError(lang, result.error))
      }
    } catch {
      if (id === request.current) setError(teamStrings(lang).failed)
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [api, kind, lang])

  useEffect(() => {
    let active = true
    void api
      .getFolders()
      .then((next) => {
        if (!active) return
        setSettings(next)
        setDraft(next)
        setSettingsOpen(!next.templates || !next.documents)
      })
      .catch(() => {
        if (active) setError(teamStrings(lang).failed)
      })
    return () => {
      active = false
    }
  }, [api, lang])

  useEffect(() => {
    if (configured) void refresh()
    const requests = request
    return () => {
      ++requests.current
    }
  }, [configured, settings, refresh])

  useEffect(() => {
    if (kind !== 'documents') return
    let active = true
    const poll = () => {
      void api
        .syncStatus()
        .then((next) => {
          if (active) setUploads(next)
        })
        .catch(() => {})
    }
    poll()
    const timer = window.setInterval(poll, 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [api, kind])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch {
      setError(text.failed)
    } finally {
      setBusy(false)
    }
  }

  async function saveSettings() {
    const result = await api.configure(draft)
    if (!result.ok) {
      setError(teamError(lang, result.error))
      return
    }
    setSettings(result.value)
    setDraft(result.value)
    setSettingsOpen(false)
    setNotice(text.configured)
  }

  async function publish() {
    const result = await api.publish(kind)
    if (!result.ok) {
      setError(teamError(lang, result.error))
      return
    }
    if (result.value) {
      await refresh()
      setNotice(text.published + result.value.name)
    }
  }

  async function open(entry: TeamLibraryEntry) {
    const result = await api.useEntry(kind, entry.id, project?.path)
    if (!result.ok) setError(teamError(lang, result.error))
    else setNotice(text.opened)
  }

  const visible = entries.filter(
    (entry) =>
      (!extension || entry.ext === extension) &&
      (!projectFilter || entry.id.split('/')[0] === projectFilter) &&
      (!authorFilter || entry.id.split('/')[1] === authorFilter) &&
      entry.id.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  const types = [...new Set(entries.map((entry) => entry.ext))].sort()
  const projectFolders = [
    ...new Set(
      entries
        .filter((entry) => entry.id.split('/').length > 3)
        .map((entry) => entry.id.split('/')[0]!),
    ),
  ].sort()
  const authors = [
    ...new Set(
      entries
        .filter(
          (entry) =>
            entry.id.split('/').length > 3 &&
            (!projectFilter || entry.id.split('/')[0] === projectFilter),
        )
        .map((entry) => entry.id.split('/')[1]!),
    ),
  ].sort()

  return (
    <main className="content team-library">
      <header className="team-header">
        <div>
          <h1>{kind === 'templates' ? text.title : text.documentsTitle}</h1>
          <p>{kind === 'templates' ? text.subtitle : text.documentsSubtitle}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setSettingsOpen((open) => !open)}>
          {settingsOpen ? text.close : text.settings}
        </button>
      </header>
      {settingsOpen && (
        <form
          className="team-settings"
          onSubmit={(event) => {
            event.preventDefault()
            void run(saveSettings)
          }}
        >
          <p>{text.connectionHint}</p>
          {(['templates', 'documents'] as const).map((key) => (
            <label className="team-setting-field" key={key}>
              <span>{key === 'templates' ? text.templatesFolder : text.documentsFolder}</span>
              <span className="team-folder-input">
                <input
                  value={draft[key]}
                  required
                  disabled={busy}
                  placeholder="\\\\server\share\folder"
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, [key]: event.target.value }))
                  }
                />
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const folder = await api.pickFolder()
                      if (folder) setDraft((previous) => ({ ...previous, [key]: folder }))
                    })
                  }
                >
                  {text.browse}
                </button>
              </span>
            </label>
          ))}
          <label className="team-setting-field">
            <span>{text.memberName}</span>
            <input
              value={draft.memberName}
              required
              maxLength={70}
              disabled={busy}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, memberName: event.target.value }))
              }
            />
          </label>
          <label className="team-auto-sync">
            <input
              type="checkbox"
              checked={draft.autoSync}
              disabled={busy}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, autoSync: event.target.checked }))
              }
            />
            {text.autoSync}
          </label>
          <p>{text.structure}</p>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? text.saving : text.save}
          </button>
        </form>
      )}
      {error && (
        <p className="team-feedback team-feedback-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="team-feedback" role="status">
          {notice}
        </p>
      )}
      {!configured ? (
        <p className="team-empty">{text.notConfigured}</p>
      ) : (
        <>
          <div className="team-toolbar">
            <p className="team-hint team-storage-location">
              {text.storageLocation}: {settings?.[kind]}
            </p>
            <div className="team-actions">
              <button
                className="btn btn-secondary"
                disabled={busy || loading}
                onClick={() => void refresh()}
              >
                {text.refresh}
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api.revealFolder(kind)
                    if (!result.ok) setError(teamError(lang, result.error))
                  })
                }
              >
                {text.folder}
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void run(publish)}>
                {busy ? text.working : kind === 'templates' ? text.register : text.send}
              </button>
            </div>
          </div>
          <p className="team-hint">{text.sourceHint}</p>
          <p className="team-hint">{text.diskHint}</p>
          {project && (
            <p className="team-hint">
              {text.project}
              <strong>{project.name}</strong>
            </p>
          )}
          <div className="team-search">
            <input
              type="search"
              aria-label={text.search}
              placeholder={text.search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {kind === 'documents' && (
              <>
                <select
                  aria-label={text.allProjects}
                  value={projectFilter}
                  onChange={(event) => {
                    setProjectFilter(event.target.value)
                    setAuthorFilter('')
                  }}
                >
                  <option value="">{text.allProjects}</option>
                  {projectFolders.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={text.allAuthors}
                  value={authorFilter}
                  onChange={(event) => setAuthorFilter(event.target.value)}
                >
                  <option value="">{text.allAuthors}</option>
                  {authors.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <select
              aria-label={text.all}
              value={extension}
              onChange={(event) => setExtension(event.target.value)}
            >
              <option value="">{text.all}</option>
              {types.map((ext) => (
                <option key={ext} value={ext}>
                  {ext.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          {loading ? (
            <p className="team-empty" role="status">
              {text.loading}
            </p>
          ) : (
            <ul className="team-files">
              {visible.map((entry) => (
                <li key={entry.id}>
                  <span className={`team-file-type team-file-type-${entry.ext}`}>
                    {entry.ext.toUpperCase()}
                  </span>
                  <div className="team-file-details">
                    <strong>{entry.name}</strong>
                    <small>{entry.id}</small>
                  </div>
                  <span className="team-file-date">
                    {new Date(entry.mtimeMs).toLocaleDateString(dateLocale)}
                  </span>
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => void run(() => open(entry))}
                  >
                    {kind === 'templates' ? text.choose : text.open}
                  </button>
                </li>
              ))}
              {visible.length === 0 && <li className="team-empty">{text.empty}</li>}
            </ul>
          )}
          {partial && <p className="team-hint">{text.partial}</p>}
        </>
      )}
      {kind === 'documents' && (
        <section className="team-sync" aria-label={text.syncTitle}>
          <div className="team-toolbar">
            <h2>{text.syncTitle}</h2>
            <div className="team-actions">
              {project && (
                <button
                  className="btn btn-secondary"
                  disabled={busy || !configured || !settings?.autoSync}
                  onClick={() =>
                    void run(async () => {
                      const result = await api.syncFolder(project.path)
                      if (!result.ok) setError(teamError(lang, result.error))
                      else setNotice(text.queued + result.value)
                      setUploads(await api.syncStatus())
                    })
                  }
                >
                  {text.syncProject}
                </button>
              )}
              <button
                className="btn btn-secondary"
                disabled={busy || !configured || !settings?.autoSync}
                onClick={() =>
                  void run(async () => {
                    await api.retrySync()
                    setUploads(await api.syncStatus())
                  })
                }
              >
                {text.retry}
              </button>
            </div>
          </div>
          {uploads.length === 0 ? (
            <p className="team-hint">{text.noUploads}</p>
          ) : (
            <ul className="team-uploads">
              {uploads.map((upload) => (
                <li key={upload.id}>
                  <div className="team-file-details">
                    <strong>{upload.name}</strong>
                    <small>{upload.projectName}</small>
                    {upload.remotePath && (
                      <small title={upload.remotePath}>{upload.remotePath}</small>
                    )}
                    {upload.error && (
                      <small className="team-upload-error">{teamError(lang, upload.error)}</small>
                    )}
                  </div>
                  <span className={`team-upload-status team-upload-${upload.status}`}>
                    {text[upload.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  )
}
