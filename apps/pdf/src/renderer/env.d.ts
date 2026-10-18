/// <reference types="vite/client" />

import type { SplitPaneBridge } from '@genoffice/electron-utils/split-pane-bridge'
import type { PdfApi } from '../shared/ipc'

declare global {
  interface Window {
    pdfApi: PdfApi
    /** present inside the shell; a standalone run has no split panes */
    aiOfficeSplit?: SplitPaneBridge
  }
}

export {}
