import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TeamLibraryApi,
  TeamResult,
  TeamTemplateCandidate,
  TeamTemplateDraftView,
  TeamTemplateList,
  TeamTemplateSource,
} from '../../shared/team-library-api'
import { teamError, teamStrings } from './team-library-strings'

/**
 * The 팀 템플릿 space's sets, loose files and candidates. The NAS is written only by 확정 and
 * 삭제; everything else reads.
 */
export function TeamTemplateSets({
  api,
  lang,
  reloadKey,
  project,
}: {
  api: TeamLibraryApi
  lang: string
  /** bumped by the parent to reload (refresh button, a registered template) */
  reloadKey: number
  /** a home folder for working copies */
  project?: { path: string }
}) {
  const text = teamStrings(lang)
  const [list, setList] = useState<TeamTemplateList | null>(null)
  const [candidates, setCandidates] = useState<TeamTemplateCandidate[] | null>(null)
  const [draft, setDraft] = useState<TeamTemplateDraftView | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [remakeTarget, setRemakeTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef(0)

  const fail = useCallback(
    (result: Extract<TeamResult<unknown>, { ok: false }>) =>
      setError(teamError(lang, result.error) + (result.detail ?? '')),
    [lang],
  )

  const load = useCallback(async () => {
    const id = ++request.current
    setError('')
    const listed = await api.templateList()
    if (id !== request.current) return
    if (!listed.ok) {
      fail(listed)
      return
    }
    setList(listed.value)
    if (listed.value.repaired) setNotice(text.repaired)
    const found = await api.templateCandidates()
    if (id !== request.current) return
    if (found.ok) setCandidates(found.value)
    else fail(found)
  }, [api, fail, text.repaired])

  useEffect(() => {
    void load()
    const requests = request
    return () => {
      ++requests.current
    }
  }, [load, reloadKey])

  async function run(label: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await action()
    } catch {
      setError(text.failed)
    } finally {
      setBusy('')
    }
  }

  const startDraft = (source: TeamTemplateSource, replaces?: string) =>
    run(text.drafting, async () => {
      const result = await api.templateDraft(source, replaces)
      if (!result.ok) return fail(result)
      setRemakeTarget(null)
      setDraft(result.value)
      setMarkdown(result.value.markdown)
    })

  const confirm = () =>
    run(text.writingNas, async () => {
      if (!draft) return
      const result = await api.templateConfirm(draft.draftId, markdown)
      if (!result.ok) return fail(result)
      setDraft(null)
      setNotice(text.confirmed + result.value.title)
      await load()
    })

  const remove = (path: string) => {
    if (!window.confirm(text.removeConfirm)) return
    void run(text.writingNas, async () => {
      const result = await api.templateRemove(path)
      if (!result.ok) return fail(result)
      setNotice(text.removed)
      await load()
    })
  }

  const open = (path: string) =>
    run(text.working, async () => {
      const result = await api.templateOpen(path, project?.path)
      if (!result.ok) {
        fail(result)
        if (result.error === 'moved') await load()
      } else setNotice(text.opened)
    })

  const openLoose = (id: string) =>
    run(text.working, async () => {
      const result = await api.useEntry('templates', id, project?.path)
      if (!result.ok) fail(result)
      else setNotice(text.opened)
    })

  const writable = list?.writable ?? false
  const titleOf = (path: string) => list?.sets.find((s) => s.path === path)?.title ?? path

  return (
    <div className="team-templates">
      {busy && (
        <p className="team-feedback" role="status">
          {busy}
        </p>
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

      {draft && (
        <section className="team-review" aria-label={text.reviewTitle}>
          <h2>{text.reviewTitle}</h2>
          <p className="team-hint">{text.reviewHint}</p>
          <div className="team-review-body">
            <textarea
              aria-label={text.reviewTitle}
              value={markdown}
              spellCheck={false}
              disabled={Boolean(busy)}
              onChange={(event) => setMarkdown(event.target.value)}
            />
            <aside>
              <h3>{text.formHeadings}</h3>
              <ol>
                {draft.formHeadings.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
              {draft.coverLabels.some(Boolean) && (
                <>
                  <h3>{text.coverLabels}</h3>
                  <p>
                    {draft.coverLabels
                      .filter(Boolean)
                      .map((l) => `[${l}]`)
                      .join(' ')}
                  </p>
                </>
              )}
              {Object.keys(draft.headerFooter).length > 0 && (
                <>
                  <h3>{text.headerFooter}</h3>
                  <p>{Object.values(draft.headerFooter).join(' / ')}</p>
                </>
              )}
            </aside>
          </div>
          <div className="team-actions">
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy)}
              onClick={() => setDraft(null)}
            >
              {text.cancel}
            </button>
            <button
              className="btn btn-primary"
              disabled={Boolean(busy)}
              onClick={() => void confirm()}
            >
              {text.confirm}
            </button>
          </div>
        </section>
      )}

      <section aria-label={text.templateSets}>
        <div className="team-toolbar">
          <h2>{text.templateSets}</h2>
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy)}
            onClick={() =>
              void run(text.working, async () => {
                const result = await api.templateRebuild()
                if (!result.ok) return fail(result)
                setList(result.value)
              })
            }
          >
            {text.rebuild}
          </button>
        </div>
        <ul className="team-files">
          {list?.sets.map((set) => (
            <li key={set.path}>
              <span className="team-file-type team-file-type-docx">{set.kind}</span>
              <div className="team-file-details">
                <strong>{set.title}</strong>
                <small>{set.purpose || set.path}</small>
                {set.status !== 'ok' && (
                  <small className="team-upload-error">
                    {set.status === 'stale-md' ? text.staleMd : text.broken}
                  </small>
                )}
              </div>
              <div className="team-actions">
                <button
                  className="btn btn-primary"
                  disabled={Boolean(busy)}
                  onClick={() => void open(set.path)}
                >
                  {text.choose}
                </button>
                {writable && (
                  <>
                    <button
                      className="btn btn-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => setRemakeTarget(set.path)}
                    >
                      {text.remake}
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => remove(set.path)}
                    >
                      {text.remove}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
          {list && list.sets.length === 0 && <li className="team-empty">{text.noSets}</li>}
        </ul>
      </section>

      {list && list.loose.length > 0 && (
        <section aria-label={text.looseFiles}>
          <h2>{text.looseFiles}</h2>
          <ul className="team-files">
            {list.loose.map((entry) => (
              <li key={entry.id}>
                <span className={`team-file-type team-file-type-${entry.ext}`}>
                  {entry.ext.toUpperCase()}
                </span>
                <div className="team-file-details">
                  <strong>{entry.name}</strong>
                  <small>{entry.id}</small>
                </div>
                <div className="team-actions">
                  <button
                    className="btn btn-secondary"
                    disabled={Boolean(busy)}
                    onClick={() => void openLoose(entry.id)}
                  >
                    {text.choose}
                  </button>
                  {writable && entry.ext === 'docx' && (
                    <button
                      className="btn btn-secondary"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void startDraft({ loose: entry.id }, remakeTarget ?? undefined)
                      }
                    >
                      {remakeTarget ? text.remakeFrom : text.makeTemplate}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={text.candidates}>
        <h2>{text.candidates}</h2>
        <p className="team-hint">
          {remakeTarget ? (
            <>
              {text.remakeHint}
              <strong>{titleOf(remakeTarget)}</strong>{' '}
              <button className="btn btn-secondary" onClick={() => setRemakeTarget(null)}>
                {text.cancel}
              </button>
            </>
          ) : (
            text.candidatesHint
          )}
        </p>
        {candidates === null ? (
          <p className="team-empty" role="status">
            {text.loading}
          </p>
        ) : (
          <ul className="team-files">
            {candidates.map((c) => (
              <li key={c.key}>
                <span className="team-file-type team-file-type-docx">DOCX</span>
                <div className="team-file-details">
                  <strong>{c.docs[0]!.name}</strong>
                  <small>
                    {text.similarDocs.replace('{n}', String(c.docs.length))}
                    {' · '}
                    {c.docs
                      .slice(0, 3)
                      .map((d) => d.id)
                      .join(', ')}
                  </small>
                  {!c.certain && <small className="team-upload-error">{text.uncertain}</small>}
                  {c.coveredBy && (
                    <small>
                      {text.covered}
                      {titleOf(c.coveredBy)}
                    </small>
                  )}
                </div>
                {writable && (remakeTarget || !c.coveredBy) && (
                  <button
                    className="btn btn-secondary"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void startDraft({ candidateKey: c.key }, remakeTarget ?? undefined)
                    }
                  >
                    {remakeTarget ? text.remakeFrom : text.makeTemplate}
                  </button>
                )}
              </li>
            ))}
            {candidates.length === 0 && <li className="team-empty">{text.noCandidates}</li>}
          </ul>
        )}
      </section>
    </div>
  )
}
