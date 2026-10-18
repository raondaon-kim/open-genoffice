/// <reference types="vite/client" />

import type { DesktopApi } from '../shared/ipc'
import type { ProjectApi } from '@genoffice/project-store'
import type { SplitPaneBridge } from '@genoffice/electron-utils/split-pane-bridge'

declare global {
  interface Window {
    desktop: DesktopApi
    projectApi: ProjectApi
    /** absent when the preload predates the split-pane bridge (or outside the shell) */
    aiOfficeSplit?: SplitPaneBridge
  }
}

export {}
