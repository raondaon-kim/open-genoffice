import { useCallback, useEffect, useRef, useState } from 'react'
import { createEditor } from '@rhwp/editor'
import type { RhwpEditor } from '@rhwp/editor'
import { HwpAiPanel } from './ai/AiPanel'
import type { HwpAiDeps } from './ai/tools'
import type { HwpApi } from '../shared/ipc'

declare global {
  interface Window {
    hwpApi: HwpApi
  }
}

type Phase = 'booting' | 'loading' | 'ready' | 'error'

const STUDIO_TIMEOUT_MS = 45_000

const UNTITLED_NAME = 'Untitled HWP'

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<RhwpEditor | null>(null)
  const filePathRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const [phase, setPhase] = useState<Phase>('booting')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [pages, setPages] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [aiOpen, setAiOpen] = useState(true)
  const [docName, setDocName] = useState(UNTITLED_NAME)
  /** saved/opened path used to (re)bootstrap the AI conversation identity */
  const [aiPath, setAiPath] = useState<string | null>(null)

  // One-shot boot: consume the queued intent (file path or blank), embed the
  // rhwp editor iframe, and either load the file or start on the studio's
  // blank document. The container div stays mounted for the whole tab lifetime;
  // the iframe is owned by the rhwp editor and must not be re-parented.
  useEffect(() => {
    let disposed = false
    void (async () => {
      const api = window.hwpApi
      if (!api) throw new Error('HWP module is unavailable in this build.')
      const intent = await api.consumePending()
      if (!intent) throw new Error('No document was provided to this tab.')
      setPhase('loading')
      const container = containerRef.current
      if (!container) throw new Error('Editor container is missing.')
      const editor = await withTimeout(
        createEditor(container),
        STUDIO_TIMEOUT_MS,
        'Cannot reach the embedded HWP editor studio — check the network connection and reopen the file.',
      )
      if (disposed) {
        editor.destroy()
        return
      }
      editorRef.current = editor
      if (intent.mode === 'open') {
        filePathRef.current = intent.path
        setDocName(basename(intent.path))
        setAiPath(intent.path)
        const bytes = await api.readFile(intent.path)
        const result = await editor.loadFile(new Uint8Array(bytes), basename(intent.path))
        if (disposed) return
        console.info(`[hwp] loaded ${basename(intent.path)}: ${result.pageCount} page(s)`)
        setPages(result.pageCount)
      } else {
        // blank new document — activating the hwpctrl plugin makes the studio
        // hand over a clean one-page HWP document (verified against the studio)
        filePathRef.current = null
        setDocName(UNTITLED_NAME)
        setAiPath(null)
        await editor.plugins.load('hwpctrl')
        const state = await editor.getDocumentState()
        if (disposed) return
        console.info('[hwp] new blank document ready')
        setPages(state.pageCount)
      }
      setStatus('')
      setPhase('ready')
    })().catch((err: unknown) => {
      console.error('[hwp] failed to start document tab:', err)
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    })
    return () => {
      disposed = true
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [])

  // Mirror the studio's dirty flag into the main process (drives close guards);
  // document-state-v1 may be absent on older studios — then assume clean.
  useEffect(() => {
    if (phase !== 'ready') return
    let last: boolean | null = null
    const timer = setInterval(() => {
      void editorRef.current
        ?.getDocumentState()
        .then((state) => {
          if (state.dirty !== last) {
            last = state.dirty
            setDirty(state.dirty)
            window.hwpApi?.setDirty(state.dirty)
          }
        })
        .catch(() => {})
    }, 2_000)
    return () => clearInterval(timer)
  }, [phase])

  const saveNow = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current
    if (!editor) return false
    if (savingRef.current) return false
    savingRef.current = true
    setStatus('Saving…')
    try {
      // Untitled document: ask the user for a destination first (Save As)
      let path = filePathRef.current
      if (!path) {
        const picked = await window.hwpApi.saveAs()
        if (!picked.ok || !picked.path) {
          if (!picked.canceled) setStatus(`Save failed: ${picked.error ?? 'unknown error'}`)
          else setStatus('')
          return false
        }
        path = picked.path
        filePathRef.current = path
        setDocName(basename(path))
      }
      // keep the source format: .hwp stays HWP, .hwpx stays HWPX
      const isHwpx = /\.hwpx$/i.test(path)
      const bytes = isHwpx ? await editor.exportHwpx() : await editor.exportHwp()
      const copy = new Uint8Array(bytes)
      const result = await window.hwpApi.save({ path, data: copy.buffer })
      if (!result.ok) {
        setStatus(`Save failed: ${result.error ?? 'unknown error'}`)
        return false
      }
      try {
        await editor.notifySaved(basename(path))
      } catch {
        // older studio without notify-saved-v1; the dirty poll re-syncs anyway
      }
      setDirty(false)
      window.hwpApi?.setDirty(false)
      if (aiPath !== path) setAiPath(path) // (re)bind AI chat to the saved file
      setStatus('Saved')
      return true
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      savingRef.current = false
    }
  }, [aiPath])

  // Menu Save / close guard arrive as main → renderer save requests
  useEffect(() => {
    if (phase !== 'ready') return
    return window.hwpApi.onSaveRequest(() => {
      void saveNow().then((ok) => window.hwpApi.sendSaveResult(ok))
    })
  }, [phase, saveNow])

  const aiDeps: HwpAiDeps = {
    editor: () => (phase === 'ready' ? editorRef.current : null),
    fileName: () => basename(filePathRef.current ?? 'document.hwp'),
  }

  return (
    <div className="hwp-app">
      <div className="hwp-statusbar">
        <span className="hwp-statusbar__title">{docName}</span>
        <span className="hwp-statusbar__meta">
          {pages !== null ? `${pages} page${pages === 1 ? '' : 's'}` : ''}
          {dirty ? ' · unsaved changes' : ''}
        </span>
        <span className="hwp-statusbar__status">{status}</span>
        <button
          type="button"
          className="hwp-statusbar__ai-toggle"
          aria-pressed={aiOpen}
          onClick={() => setAiOpen((open) => !open)}
        >
          AI
        </button>
      </div>
      <div className="hwp-body">
        <div className="hwp-editor-host">
          {phase === 'error' && <div className="hwp-message hwp-message--error">{error}</div>}
          {(phase === 'booting' || phase === 'loading') && (
            <div className="hwp-message">Loading document…</div>
          )}
          <div
            ref={containerRef}
            className="hwp-container"
            style={phase === 'error' ? { visibility: 'hidden' } : undefined}
          />
        </div>
        {aiOpen && phase !== 'error' && (
          <HwpAiPanel deps={aiDeps} filePath={aiPath} onCollapse={() => setAiOpen(false)} />
        )}
      </div>
    </div>
  )
}
