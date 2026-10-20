import { useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { isWikiMaterial } from '@genoffice/work-wiki/material'
import type {
  WikiMaterialApi,
  WikiMaterialResult,
  WikiMaterialSkip,
} from '@genoffice/work-wiki/material'
import { ATTACHMENT_WIKI_LABELS } from './strings-attachment-wiki'

type State = 'idle' | 'adding' | 'added' | 'duplicate' | 'failed'

/** one status request serves every chip for a few seconds (many chips, one IPC call) */
const STATUS_TTL_MS = 5000
let statusCache: { api: WikiMaterialApi; at: number; enabled: Promise<boolean> } | null = null

function wikiEnabled(api: WikiMaterialApi): Promise<boolean> {
  const now = Date.now()
  if (statusCache && statusCache.api === api && now - statusCache.at < STATUS_TTL_MS)
    return statusCache.enabled
  const enabled = api.status().then(
    (s) => s?.enabled === true,
    () => false,
  )
  statusCache = { api, at: now, enabled }
  return enabled
}

/** forget the cached wiki status (tests) */
export function resetAttachmentWikiStatus(): void {
  statusCache = null
}

/**
 * "Add to work material" on an AI-chat attachment card: copies the file into the work wiki
 * (LLM Wiki learns it for later work). Hidden when the wiki is off or the format is not taken.
 * `onResult` gets the outcome and, on failure, the localized line for the editor's notice.
 */
export function AttachmentWikiButton({
  path,
  name,
  lang,
  api,
  onResult,
}: {
  path: string
  name: string
  lang: Lang
  api?: WikiMaterialApi | undefined
  onResult?: ((result: WikiMaterialResult, failure?: string) => void) | undefined
}) {
  const accepted = isWikiMaterial(name)
  const [enabled, setEnabled] = useState(false)
  const [state, setState] = useState<State>('idle')
  const [reason, setReason] = useState<WikiMaterialSkip>('unreadable')
  const busy = useRef(false)

  useEffect(() => {
    if (!api || !accepted) return
    let alive = true
    void wikiEnabled(api).then((on) => {
      if (alive) setEnabled(on)
    })
    return () => {
      alive = false
    }
  }, [api, accepted])

  if (!api || !accepted || !enabled) return null
  const labels = ATTACHMENT_WIKI_LABELS[lang] ?? ATTACHMENT_WIKI_LABELS.en

  const add = async () => {
    if (busy.current || state === 'added' || state === 'duplicate') return
    busy.current = true
    setState('adding')
    let result: WikiMaterialResult
    try {
      result = (await api.addMaterial([path]))[0] ?? {
        path,
        status: 'skipped',
        reason: 'unreadable',
      }
    } catch {
      result = { path, status: 'skipped', reason: 'unreadable' }
    }
    busy.current = false
    if (result.status === 'skipped') {
      const why = result.reason ?? 'unreadable'
      setReason(why)
      setState('failed')
      onResult?.(result, `${labels.failed}: ${labels.reasons[why]}`)
    } else {
      setState(result.status)
      onResult?.(result, undefined)
    }
  }

  const tip =
    state === 'failed'
      ? `${labels.failed}: ${labels.reasons[reason]}`
      : labels[state === 'idle' ? 'add' : state]
  return (
    <button
      type="button"
      className="ai-attachment-wiki-btn"
      data-state={state}
      data-tip={tip}
      aria-label={tip}
      aria-busy={state === 'adding' || undefined}
      disabled={state === 'adding'}
      onClick={() => void add()}
    >
      {state === 'added' || state === 'duplicate' ? (
        <IconCheck />
      ) : state === 'failed' ? (
        <IconWarn />
      ) : (
        <IconBookPlus />
      )}
    </button>
  )
}

const svg = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function IconBookPlus() {
  return (
    <svg {...svg}>
      <path d="M2.5 3.5h3.8A1.7 1.7 0 0 1 8 5.2v7.3a1.3 1.3 0 0 0-1.3-1.3H2.5z" />
      <path d="M8 5.2a1.7 1.7 0 0 1 1.7-1.7h.8M13.5 7.5v3.7H9.3A1.3 1.3 0 0 0 8 12.5" />
      <path d="M12.5 1.8v3.9M10.55 3.75h3.9" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg {...svg}>
      <path d="m3.5 8.5 3 3 6-6.5" />
    </svg>
  )
}

function IconWarn() {
  return (
    <svg {...svg}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.6M8 10.9v.1" />
    </svg>
  )
}
