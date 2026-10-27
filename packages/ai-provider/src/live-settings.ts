/**
 * Settings › AI is saved once for every editor. Editors that keep a copy of the settings (Word,
 * PowerPoint, Excel read it when a document opens and send it with each request) follow the saved
 * file through a payload-free signal: main tells every window that the settings changed, and each
 * editor reads them again over its own get-settings channel. No settings (keys) travel in the
 * signal, so a window without that channel learns nothing from it.
 */

/** main → renderer: the AI settings file was saved */
export const AI_SETTINGS_CHANGED = 'ai:settings-changed'

export interface SignalTarget {
  isDestroyed(): boolean
  send(channel: string): void
}

/** signal every live window; returns how many received it */
export function broadcastAiSettingsChanged(targets: Iterable<SignalTarget>): number {
  let sent = 0
  for (const target of targets) {
    if (target.isDestroyed()) continue
    try {
      target.send(AI_SETTINGS_CHANGED)
      sent += 1
    } catch {
      // a frame being torn down; the others still get the signal
    }
  }
  return sent
}

export interface LiveSettingsApi<S> {
  getAiSettings(): Promise<S>
  /** absent in a preload that predates the signal: the settings are then read once */
  onAiSettingsChanged?(listener: () => void): () => void
}

/** read the settings now and again after every save; returns a stop function */
export function followAiSettings<S>(
  api: LiveSettingsApi<S>,
  apply: (settings: S) => void,
): () => void {
  let stopped = false
  let latest = 0
  const read = (): void => {
    const ticket = ++latest
    api.getAiSettings().then(
      (settings) => {
        // only the newest read lands: an older one resolving late must not undo a switch
        if (!stopped && ticket === latest) apply(settings)
      },
      () => {},
    )
  }
  read()
  const off = api.onAiSettingsChanged?.(read)
  return () => {
    stopped = true
    off?.()
  }
}
