import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { QuickLookPayload } from '../../shared/home-api'
import { QUICK_LOOK_LABELS } from './quick-look-strings'

export interface QuickLookItem {
  path: string
  name: string
  ext: string
}

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Home's Quick Look: a preview of one file of a list, over Home. Space/Esc close, ↑/↓ step
 * through the list, Enter opens. Only the reply for the file now shown is ever displayed.
 */
export function QuickLook({
  items,
  index,
  lang,
  onIndex,
  onOpen,
  onClose,
  renderBadge,
}: {
  items: QuickLookItem[]
  index: number
  lang: Lang
  onIndex: (index: number) => void
  onOpen: (path: string) => void
  onClose: () => void
  /** the file-type badge Home draws for its rows */
  renderBadge?: (ext: string) => ReactNode
}): ReactElement | null {
  const labels = QUICK_LOOK_LABELS[lang] ?? QUICK_LOOK_LABELS.en
  const item = items[index]
  const [payload, setPayload] = useState<QuickLookPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const seq = useRef(0)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!item) return
    const mine = ++seq.current
    setPayload(null)
    setFailed(false)
    window.aiOffice
      .quickLook(item.path)
      .then((p) => {
        if (seq.current === mine) setPayload(p)
      })
      .catch(() => {
        if (seq.current === mine) setFailed(true)
      })
  }, [item?.path])

  if (!item) return null

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === ' ' || event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(item.path)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      if (index < items.length - 1) onIndex(index + 1)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      if (index > 0) onIndex(index - 1)
    }
  }

  const ready = payload?.path === item.path ? payload : null
  let body: ReactNode
  if (failed) body = <p className="quick-look-note">{labels.unreadable}</p>
  else if (!ready) body = <p className="quick-look-note">{labels.loading}</p>
  else if (!ready.ok)
    body = (
      <p className="quick-look-note">
        {ready.error === 'missing'
          ? labels.missing
          : ready.error === 'too-large'
            ? labels.tooLarge
            : labels.unreadable}
      </p>
    )
  else if (!ready.image && !ready.text)
    body = <p className="quick-look-note">{labels.unsupported}</p>
  else
    body = (
      <>
        {ready.image && <img className="quick-look-image" src={ready.image} alt="" />}
        {ready.text && <pre className="quick-look-text">{ready.text}</pre>}
        {ready.truncated && <p className="quick-look-note">{labels.truncated}</p>}
      </>
    )

  const titleId = 'quick-look-title'
  return (
    <div className="quick-look-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="quick-look"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="quick-look-head">
          {renderBadge?.(item.ext)}
          <div className="quick-look-title">
            <span id={titleId} className="quick-look-name">
              {item.name}
            </span>
            {ready?.ok && (
              <span className="quick-look-meta">
                {formatSize(ready.sizeBytes)} · {new Date(ready.mtimeMs).toLocaleString(lang)}
              </span>
            )}
          </div>
          <button
            type="button"
            className="quick-look-nav"
            aria-label={labels.previous}
            disabled={index === 0}
            onClick={() => onIndex(index - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="quick-look-nav"
            aria-label={labels.next}
            disabled={index >= items.length - 1}
            onClick={() => onIndex(index + 1)}
          >
            ›
          </button>
          <button type="button" className="quick-look-open" onClick={() => onOpen(item.path)}>
            {labels.open}
          </button>
          <button
            type="button"
            className="quick-look-close"
            aria-label={labels.close}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="quick-look-body">{body}</div>
      </div>
    </div>
  )
}
