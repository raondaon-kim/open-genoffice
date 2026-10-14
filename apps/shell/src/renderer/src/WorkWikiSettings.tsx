import { useEffect, useState } from 'react'
import type { WorkWikiSettings } from '../../shared/home-api'
import type { TFunc } from './locale'

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
    </section>
  )
}
