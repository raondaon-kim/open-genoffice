import { useEffect, useState } from 'react'
import type {
  CodexLoginStartView,
  CodexRendererApi,
  CodexStatusView,
} from '../../../shared/codex-api'
import { codexCardView, type CodexCardAction } from './codex-card'

const ACTION_LABELS: Record<CodexCardAction, string> = {
  login: 'Sign in with ChatGPT',
  'login-device': 'Use a device code',
  'login-api-key': 'Use an API key',
  cancel: 'Cancel sign-in',
  logout: 'Sign out',
  retry: 'Check again',
}

/** Codex (ChatGPT sign-in) card at the top of AI settings; onChanged reloads providers and models. */
export function CodexCard({
  api,
  customPath,
  onChanged,
}: {
  api: CodexRendererApi
  customPath: string
  onChanged: () => void
}) {
  const [status, setStatus] = useState<CodexStatusView | null>(null)
  const [pending, setPending] = useState<CodexLoginStartView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [path, setPath] = useState(customPath)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void api.codexStatus().then(
      (next) => active && setStatus(next),
      (err: unknown) => active && setError(String(err)),
    )
    const off = api.onCodexStatusChanged((next) => {
      setPending(null)
      setStatus(next)
      onChanged()
    })
    return () => {
      active = false
      off()
    }
  }, [api, onChanged])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onAction = (action: CodexCardAction) =>
    void run(async () => {
      if (action === 'login') setPending(await api.codexLogin('chatgpt'))
      else if (action === 'login-device') setPending(await api.codexLogin('chatgptDeviceCode'))
      else if (action === 'login-api-key') setApiKeyOpen(true)
      else if (action === 'cancel' && pending) {
        await api.codexLoginCancel(pending.loginId)
        setPending(null)
        setStatus(await api.codexStatus())
      } else if (action === 'logout') {
        setStatus(await api.codexLogout())
        onChanged()
      } else if (action === 'retry') setStatus(await api.codexStatus())
    })

  const view = codexCardView(status, pending)

  return (
    <section
      className="ai-provider-card ai-provider-card--codex"
      aria-labelledby="ai-provider-codex"
      data-codex-card
    >
      <div className="ai-provider-card__head">
        <div>
          <h3 id="ai-provider-codex">Codex (ChatGPT)</h3>
          <p>Use your ChatGPT plan through the bundled Codex. No API key needed.</p>
        </div>
        <span
          className={`ai-provider-status ai-provider-status--${view.badge === 'connected' ? 'connected' : view.badge === 'error' ? 'unavailable' : 'not-configured'}`}
          data-codex-badge={view.badge}
        >
          <span aria-hidden="true" />
          {view.title}
        </span>
      </div>
      {view.detail && <p className="ai-provider-card__detail">{view.detail}</p>}
      {view.deviceCode && (
        <p className="ai-provider-card__detail" data-codex-device-code>
          Code <strong>{view.deviceCode.code}</strong> — enter it at {view.deviceCode.url}
        </p>
      )}
      <div className="ai-provider-key-row">
        {view.actions.map((action) => (
          <button
            key={action}
            type="button"
            className={`ai-settings-btn ${action === 'login' ? 'ai-settings-btn--primary' : 'ai-settings-btn--quiet'}`}
            disabled={busy}
            data-codex-action={action}
            onClick={() => onAction(action)}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
      {apiKeyOpen && (
        <div className="ai-provider-key-row">
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            aria-label="OpenAI API key for Codex"
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button
            type="button"
            className="ai-settings-btn ai-settings-btn--primary"
            disabled={busy || !apiKey.trim()}
            onClick={() =>
              void run(async () => {
                setStatus(await api.codexLoginWithApiKey(apiKey))
                setApiKey('')
                setApiKeyOpen(false)
                onChanged()
              })
            }
          >
            Sign in
          </button>
        </div>
      )}
      <details className="ai-provider-card__advanced">
        <summary>Use an installed Codex instead</summary>
        <div className="ai-provider-key-row">
          <input
            type="text"
            value={path}
            spellCheck={false}
            placeholder="Leave empty to use the bundled Codex"
            aria-label="Custom Codex executable path"
            onChange={(event) => setPath(event.target.value)}
          />
          <button
            type="button"
            className="ai-settings-btn ai-settings-btn--quiet"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.setCodexCliPath(path)
                setStatus(await api.codexStatus())
                onChanged()
              })
            }
          >
            Save
          </button>
        </div>
      </details>
      {view.binaryLine && <p className="ai-provider-card__detail">{view.binaryLine}</p>}
      {error && (
        <p className="ai-provider-card__detail" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
