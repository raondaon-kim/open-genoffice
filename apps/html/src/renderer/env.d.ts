/// <reference types="vite/client" />

import type { ProjectApi } from '@genoffice/project-store'
import type { SplitPaneBridge } from '@genoffice/electron-utils/split-pane-bridge'
import type { HtmlApi } from '../shared/ipc'

declare global {
  interface Window {
    htmlApi: HtmlApi
    projectApi?: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'>
    /** present inside the shell; a standalone run has no split panes */
    aiOfficeSplit?: SplitPaneBridge
  }
}

export {}
