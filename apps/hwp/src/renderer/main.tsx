import { createRoot } from 'react-dom/client'
import '@genoffice/ui/tokens.css'
import '@genoffice/ui/screentip.css'
import '@genoffice/ui/ai-panel-prefs.css'
import '@genoffice/ui/report-progress.css'
import '@genoffice/ui/attachment-wiki.css'
import { applyAiPanelPrefs, installScreenTips } from '@genoffice/ui'
import { App } from './App'
import './styles.css'
import type { UiTheme } from '../shared/ipc'

// hover tips for the panel's icon buttons (data-tip), like the other editors
installScreenTips()

/** follow the suite's light / dark / system theme (the shell broadcasts changes to every tab) */
function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void window.hwpApi
  ?.getTheme()
  .then(applyTheme)
  .catch(() => undefined)
window.hwpApi?.onThemeChanged(applyTheme)

void (async () => {
  // AI panel side and text size come before the first paint (the panel must not jump sides),
  // and decide whether the panel starts open
  await window.hwpApi
    ?.getAiPanelPrefs()
    .then(applyAiPanelPrefs)
    .catch(() => undefined)
  window.hwpApi?.onAiPanelPrefsChanged(applyAiPanelPrefs)
  createRoot(document.getElementById('root')!).render(<App />)
})()
