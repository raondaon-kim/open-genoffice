import { useEffect, useState } from 'react'
import type { LlmWikiStatusView, WorkWikiSettings } from '../../shared/home-api'
import type { TFunc } from './locale'

const STATUS_POLL_MS = 5000

/** how the bundled LLM Wiki is doing, with a button to open its window */
function LlmWikiRow({ t }: { t: TFunc }) {
  const [status, setStatus] = useState<LlmWikiStatusView | null>(null)
  useEffect(() => {
    let alive = true
    const poll = () => {
      void window.aiOffice.getLlmWikiStatus?.().then((v) => {
        if (alive && v) setStatus(v)
      })
    }
    poll()
    const timer = setInterval(poll, STATUS_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  if (!status) return null
  const text = !status.available
    ? t('setLlmWikiMissing')
    : status.state === 'running'
      ? t('setLlmWikiRunning')
      : status.state === 'starting'
        ? t('setLlmWikiStarting')
        : status.state === 'failed'
          ? t('setLlmWikiFailed', { reason: status.reason ?? '' })
          : t('setLlmWikiStopped')
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-stack">
          <div className="set-field-label">{t('setLlmWiki')}</div>
          <div className="set-field-desc">{text}</div>
        </div>
      </div>
      <button
        className="set-btn"
        disabled={status.state !== 'running'}
        onClick={() => void window.aiOffice.openLlmWiki?.()}
      >
        {t('setLlmWikiOpen')}
      </button>
    </div>
  )
}

/** Settings → AI media: switch the work wiki on/off and choose its folder */
export function WorkWikiSettingsBlock({ t }: { t: TFunc }) {
  const [settings, setSettings] = useState<WorkWikiSettings | null>(null)
  useEffect(() => {
    let alive = true
    void window.aiOffice.getWorkWikiSettings?.().then((v) => {
      if (alive && v) setSettings(v)
    })
    return () => {
      alive = false
    }
  }, [])
  if (!settings) return null
  const save = async (patch: Partial<WorkWikiSettings>) => {
    const next = await window.aiOffice.setWorkWikiSettings?.(patch)
    if (next) setSettings(next)
  }
  return (
    <section>
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-stack">
            <div className="set-field-label">{t('setWorkWiki')}</div>
            <div className="set-field-desc">{t('setWorkWikiDesc')}</div>
          </div>
        </div>
        <button
          className="set-switch"
          role="switch"
          aria-checked={settings.enabled}
          aria-label={t('setWorkWiki')}
          onClick={() => void save({ enabled: !settings.enabled })}
        />
      </div>
      {settings.enabled && (
        <div className="set-field">
          <div className="set-field-text">
            <div className="set-field-stack">
              <div className="set-field-label">{t('setWorkWikiFolder')}</div>
              <div className="set-field-desc">{settings.folder}</div>
            </div>
          </div>
          <button
            className="set-btn"
            onClick={async () => {
              const folder = await window.aiOffice.pickWorkWikiFolder?.()
              if (folder) await save({ folder })
            }}
          >
            {t('setWorkWikiChange')}
          </button>
        </div>
      )}
      {settings.enabled && <LlmWikiRow t={t} />}
      {settings.enabled && (
        <div className="set-field">
          <div className="set-field-text">
            <div className="set-field-stack">
              <div className="set-field-label">{t('setWorkWikiExclude')}</div>
              <div className="set-field-desc">{t('setWorkWikiExcludeDesc')}</div>
              {settings.exclude.map((folder) => (
                <div key={folder} className="set-field-desc">
                  {folder}{' '}
                  <button
                    className="set-btn"
                    aria-label={t('setWorkWikiExcludeRemove')}
                    onClick={() =>
                      void save({ exclude: settings.exclude.filter((f) => f !== folder) })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button
            className="set-btn"
            onClick={async () => {
              const folder = await window.aiOffice.pickWorkWikiFolder?.()
              if (folder && !settings.exclude.includes(folder)) {
                await save({ exclude: [...settings.exclude, folder] })
              }
            }}
          >
            {t('setWorkWikiExcludeAdd')}
          </button>
        </div>
      )}
    </section>
  )
}
