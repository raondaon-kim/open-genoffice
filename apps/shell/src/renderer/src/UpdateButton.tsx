import { useEffect, useState } from 'react'
import type { UpdateUiState } from '../../shared/update-api'
import { useI18n } from './locale'

/**
 * The tab bar's update button. The daily background check never opens the update window; it
 * announces a newer version here instead, and the user updates when they choose: the click
 * opens the window and starts the download (or offers Restart & Install once it is ready).
 * Lives in the tab bar because editor views cover the rest of the shell window.
 */
export function UpdateButton() {
  const { t } = useI18n()
  const [state, setState] = useState<UpdateUiState | null>(null)

  useEffect(() => {
    let live = true
    void window.aiOffice
      .getUpdateState?.()
      .then((s) => {
        if (live && s) setState((current) => current ?? s)
      })
      .catch(() => {})
    const off = window.aiOffice.onUpdateStateChanged?.((s) => setState(s))
    return () => {
      live = false
      off?.()
    }
  }, [])

  if (!state) return null
  const label =
    state.phase === 'downloading'
      ? t('setUpdateDownloading', { percent: Math.round(state.percent) })
      : state.phase === 'downloaded'
        ? t('setUpdateRestart')
        : t('setUpdateTo', { version: state.version })
  return (
    <button
      type="button"
      className={`tab-update-btn${state.phase === 'downloaded' ? ' ready' : ''}`}
      title={t('setUpdateAvailableLabel')}
      onClick={() => void window.aiOffice.openUpdateDialog?.()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{label}</span>
    </button>
  )
}
