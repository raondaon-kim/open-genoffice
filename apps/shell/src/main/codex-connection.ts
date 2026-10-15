import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { validCliPath } from '@genoffice/ai-provider'
import {
  configureBundledCodex,
  readCodexAccount,
  resolveCodexCliPath,
} from '@genoffice/ai-provider/codex-app-server'
import type { CodexAccountState } from '@genoffice/ai-provider/codex-app-server'
import { HOME_CHANNELS } from '../shared/home-api'
import { bundledCodexExe, CodexLogin } from './codex-login'

let login: CodexLogin | null = null

/** the Settings screen's view of Codex: whether it can be signed in, and who is */
async function codexStatus(cliPath?: string): Promise<CodexAccountState & { loginable: boolean }> {
  const state = await readCodexAccount(cliPath)
  return { ...state, loginable: state.state !== 'missing' }
}

/** the login child reads the same home as the app-server (a Hangul user folder included) */
function loginEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.platform === 'win32' && !env.HOME && env.USERPROFILE) env.HOME = env.USERPROFILE
  return env
}

/** the bundled Codex becomes the default executable; Settings can read the account and sign in */
export function registerCodexIpc(): void {
  const resources = app.isPackaged ? process.resourcesPath : undefined
  configureBundledCodex(bundledCodexExe(resources, join(app.getAppPath(), 'build')))
  login = new CodexLogin({
    exePath: () => resolveCodexCliPath(),
    spawn: (exe, args) =>
      spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: loginEnv() }),
    readAccount: () => readCodexAccount(),
  })
  ipcMain.handle(HOME_CHANNELS.getCodexStatus, (_e, cliPath: unknown) =>
    codexStatus(validCliPath(cliPath) ? cliPath.trim() : undefined),
  )
  ipcMain.handle(HOME_CHANNELS.startCodexLogin, async () => {
    await login!.start()
    return login!.status()
  })
  ipcMain.handle(HOME_CHANNELS.getCodexLogin, () => login!.status())
  ipcMain.handle(HOME_CHANNELS.cancelCodexLogin, () => login!.cancel())
}

/** the app is quitting: a pending sign-in must not leave a login child behind */
export function stopCodexLoginForQuit(): void {
  login?.cancel()
}
