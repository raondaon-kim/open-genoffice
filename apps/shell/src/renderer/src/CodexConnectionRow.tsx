import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodexLoginView, CodexStatusView } from '../../shared/home-api'
import type { TFunc } from './locale'

const POLL_MS = 1500

/** Settings → AI model → Codex: who is signed in, and a browser sign-in when nobody is */
export function CodexConnectionRow({
  t,
  cliPath,
  onConnected,
}: {
  t: TFunc
  cliPath: string
  /** called once each time Codex becomes connected (the pane reloads its model list) */
  onConnected: () => void
}) {
  const [status, setStatus] = useState<CodexStatusView | null>(null)
  const [login, setLogin] = useState<CodexLoginView>({ state: 'idle' })
  // the parent passes a new function every render; keeping it in a ref keeps refresh stable
  const connectedRef = useRef(onConnected)
  connectedRef.current = onConnected
  const wasConnected = useRef(false)

  const refresh = useCallback(async () => {
    const [s, l] = await Promise.all([
      window.aiOffice.getCodexStatus?.(cliPath),
      window.aiOffice.getCodexLogin?.(),
    ])
    if (s) setStatus(s)
    if (l) setLogin(l)
    const connected = s?.state === 'connected'
    if (connected && !wasConnected.current) connectedRef.current()
    wasConnected.current = connected
  }, [cliPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // while a sign-in runs the answer can change at any moment
  useEffect(() => {
    if (login.state !== 'waiting') return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [login.state, refresh])

  if (!status) return null
  const text =
    status.state === 'connected'
      ? t('setCodexConnected', { account: status.account })
      : status.state === 'needs-login'
        ? t('setCodexNeedsLogin')
        : status.state === 'missing'
          ? t('setCodexMissing')
          : t('setCodexError', { reason: status.reason })

  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-stack">
          <div className="set-field-label">{text}</div>
          {login.state === 'waiting' && (
            <div className="set-field-desc">
              {t('setCodexLoginWaiting')}
              {login.url && (
                <>
                  {' '}
                  {t('setCodexLoginUrl')} <span className="set-code">{login.url}</span>
                </>
              )}
            </div>
          )}
          {login.state === 'failed' && (
            <div className="set-field-desc">
              {t('setCodexLoginFailed', { reason: login.reason ?? '' })}
            </div>
          )}
        </div>
      </div>
      <div>
        {status.state === 'needs-login' && status.loginable && login.state !== 'waiting' && (
          <button
            className="set-btn primary"
            onClick={() =>
              void window.aiOffice.startCodexLogin?.(cliPath || undefined).then((l) => {
                if (l) setLogin(l)
              })
            }
          >
            {t('setCodexLogin')}
          </button>
        )}
        {login.state === 'waiting' && (
          <button
            className="set-btn"
            onClick={() =>
              void window.aiOffice.cancelCodexLogin?.().then(() => setLogin({ state: 'idle' }))
            }
          >
            {t('setCodexLoginCancel')}
          </button>
        )}{' '}
        <button className="set-btn" onClick={() => void refresh()}>
          {t('setCodexCheck')}
        </button>
      </div>
    </div>
  )
}
