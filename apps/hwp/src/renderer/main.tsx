import { createRoot } from 'react-dom/client'
import '@genoffice/ui/tokens.css'
import { App } from './App'
import './styles.css'
import type { UiTheme } from '../shared/ipc'

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

createRoot(document.getElementById('root')!).render(<App />)
