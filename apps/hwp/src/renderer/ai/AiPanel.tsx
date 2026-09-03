import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { AgentLoop } from '@genoffice/agent-core'
import type { AgentTransport } from '@genoffice/agent-core'
import { openRouterRetrySuggestion } from '@genoffice/ai-provider'
import type { AiModelSummary, AiRoute } from '@genoffice/ai-provider'
import { AiComposer, Markdown, ModelPicker } from '@genoffice/ui'
import type { ModelPickerModel } from '@genoffice/ui'
import type {
  AiConversationIdentity,
  ProjectChatMessage,
  PublicAiProvider,
} from '../../shared/ipc'
import { createHwpSkill } from './hwp-skill'
import { createElectronTransport } from './transport'
import type { HwpAiDeps } from './tools'

const PANEL_WIDTH_KEY = 'hwp-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 420
const PANEL_WIDTH_MIN = 280

function clampPanelWidth(w: number): number {
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), Math.min(720, Math.round(window.innerWidth * 0.6)))
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  return Number.isFinite(saved) && saved > 0 ? clampPanelWidth(saved) : PANEL_WIDTH_DEFAULT
}

function isHwpCompatibleModel(model: AiModelSummary): boolean {
  return (
    model.available &&
    model.capabilities.inputModalities.includes('text') &&
    model.capabilities.outputModalities.includes('text') &&
    model.capabilities.supportsTools
  )
}

function toPickerModel(model: AiModelSummary, providers: readonly PublicAiProvider[]): ModelPickerModel {
  const providerLabel = providers.find((provider) => provider.id === model.providerId)?.label
  return {
    providerId: model.providerId,
    modelId: model.id,
    providerLabel: providerLabel ?? model.providerId,
    label: model.name,
    shortLabel: model.name,
    description: model.description,
    capabilityLabels: [
      model.capabilities.inputModalities.includes('image') ? 'Images' : 'Text only',
      model.capabilities.contextWindow
        ? `${Math.round(model.capabilities.contextWindow / 1000)}K context`
        : undefined,
    ].filter((label): label is string => Boolean(label)),
    searchTerms: [model.id, model.canonicalId],
  }
}

function routeEquals(left: AiRoute | null | undefined, right: AiRoute | null | undefined): boolean {
  return (
    left != null && right != null && left.providerId === right.providerId && left.modelId === right.modelId
  )
}

interface ToolActivity {
  name: string
  summary: string
  isError?: boolean
  output?: string
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  isError?: boolean
  retrySuggestion?: string
  tools?: ToolActivity[]
}

type Phase = 'thinking' | 'replying' | 'working'

export function HwpAiPanel({
  deps,
  filePath,
  onCollapse,
}: {
  deps: HwpAiDeps
  filePath: string | null
  onCollapse: () => void
}): ReactElement {
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('thinking')
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth)
  const [resizing, setResizing] = useState(false)
  const [providers, setProviders] = useState<PublicAiProvider[]>([])
  const [models, setModels] = useState<AiModelSummary[]>([])
  const [selectedRoute, setSelectedRoute] = useState<AiRoute | null>(null)
  const [routeReady, setRouteReady] = useState(false)
  const [routeValidated, setRouteValidated] = useState(false)
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const stickToBottomRef = useRef(true)
  const conversationRef = useRef<AiConversationIdentity | null>(null)
  const routeRef = useRef<AiRoute | null>(null)
  const activeRunRouteRef = useRef<AiRoute | null>(null)
  const runToolsRef = useRef<ToolActivity[]>([])
  const depsRef = useRef(deps)
  depsRef.current = deps
  const modelsRef = useRef<AiModelSummary[]>([])
  modelsRef.current = models

  const transportRef = useRef<AgentTransport | null>(null)
  if (!transportRef.current) {
    transportRef.current = createElectronTransport(() => conversationRef.current ?? undefined)
  }
  const loopRef = useRef<AgentLoop | null>(null)
  if (!loopRef.current) {
    loopRef.current = new AgentLoop({
      transport: transportRef.current,
      skill: createHwpSkill({
        editor: () => depsRef.current.editor(),
        fileName: () => depsRef.current.fileName(),
      }),
      events: {
        onText: (text) => {
          setPhase('replying')
          patchLast({ text })
        },
        onToolExecuted: ({ call, execution }) => {
          setPhase('working')
          runToolsRef.current.push({
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            output: execution.output?.slice(0, 10_000),
          })
          patchLast((last) => ({
            tools: [
              ...(last.tools ?? []),
              {
                name: call.name,
                summary: execution.summary,
                isError: execution.isError,
                output: execution.output?.slice(0, 2000),
              },
            ],
          }))
        },
        onTurnEnd: () => {
          setPhase('thinking')
          patchLast({ streaming: false })
          setChat((prev) => [...prev, { role: 'assistant', text: '', streaming: true }])
        },
        onDone: ({ text, cancelled, turnLimit }) => {
          const final = turnLimit ? [text, 'Turn limit reached.'].filter(Boolean).join('\n\n') : text || (cancelled ? 'Stopped.' : '')
          patchLast((last) => ({
            streaming: false,
            text: final || (last.tools?.length ? last.text : 'No reply.'),
          }))
          setBusy(false)
          if (final && !cancelled) {
            persistMessage('assistant', final, runToolsRef.current, activeRunRouteRef.current)
          }
        },
        onError: (error) => {
          const failedRoute = activeRunRouteRef.current
          const failedModel = failedRoute
            ? modelsRef.current.find(
                (model) =>
                  model.providerId === failedRoute.providerId && model.id === failedRoute.modelId,
              )
            : undefined
          patchLast({
            streaming: false,
            text: error,
            isError: true,
            retrySuggestion: failedRoute ? openRouterRetrySuggestion(failedRoute, failedModel) : undefined,
          })
          setBusy(false)
        },
      },
    })
  }

  const patchLast = (patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>)): void => {
    setChat((prev) => {
      const next = [...prev]
      const last = next.at(-1)
      if (last?.role === 'assistant') {
        next[next.length - 1] = {
          ...last,
          ...(typeof patch === 'function' ? patch(last) : patch),
        }
      }
      return next
    })
  }

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    route?: AiRoute | null,
  ): void => {
    const identity = conversationRef.current
    if (!identity || !text) return
    void window.hwpApi
      .appendProjectChat({
        projectId: identity.projectId,
        chatId: identity.chatId,
        role,
        text,
        ...(role === 'assistant' && tools && tools.length > 0 ? { tools } : {}),
        ...(role === 'assistant' && route
          ? { ai: { requested: { providerId: route.providerId, modelId: route.modelId } } }
          : {}),
      })
      .catch(() => undefined)
  }

  // Route + transcript bootstrap per file
  useEffect(() => {
    let cancelled = false
    setRouteReady(false)
    setChat([])
    loopRef.current?.reset()
    void (async () => {
      try {
        if (!filePath) {
          setRouteReady(true)
          setRouteValidated(false)
          return
        }
        const identity = await window.hwpApi.resolveProjectChat({ filePath })
        if (cancelled) return
        const [settings, catalog, route] = await Promise.all([
          window.hwpApi.getAiPublicSettings(),
          window.hwpApi.listAiModels(),
          window.hwpApi.getAiConversationRoute(identity),
        ])
        if (cancelled) return
        conversationRef.current = identity
        routeRef.current = route
        setSelectedRoute(route)
        setRouteValidated(true)
        setProviders(settings.providers)
        const compatible = catalog.models.filter(isHwpCompatibleModel)
        setModels(compatible)
        if (
          !compatible.some((model) =>
            routeEquals(route, { providerId: model.providerId, modelId: model.id }),
          )
        ) {
          setModelNotice(
            `The selected model (${route.modelId}) is unavailable. Choose a compatible replacement before sending.`,
          )
        }
        const messages: ProjectChatMessage[] = await window.hwpApi.loadProjectChat({
          projectId: identity.projectId,
          chatId: identity.chatId,
        })
        if (cancelled) return
        console.info(
          `[hwp-ai] route ready: ${route.providerId}/${route.modelId}, ${compatible.length} compatible model(s), ${messages.length > 0 ? 'transcript restored' : 'new conversation'}`,
        )
        loopRef.current?.restore(messages.map((message) => ({ role: message.role, text: message.text })))
        setChat(
          messages.map((message) => ({
            role: message.role,
            text: message.text,
            tools: message.tools,
          })),
        )
        setRouteReady(true)
      } catch (error) {
        if (cancelled) return
        setRouteReady(true)
        setRouteValidated(false)
        setModelNotice(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filePath])

  useEffect(() => {
    if (stickToBottomRef.current) chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [chat, busy])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setResizing(true)
  }

  useEffect(() => {
    if (!resizing) return
    const onMove = (event: PointerEvent): void => {
      const rect = asideRef.current?.getBoundingClientRect()
      if (!rect) return
      setPanelWidth(clampPanelWidth(rect.right - event.clientX))
    }
    const onUp = (): void => setResizing(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [resizing])

  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth))
  }, [panelWidth])

  const send = (text: string): void => {
    const instruction = text.trim()
    const loop = loopRef.current
    const route = routeRef.current
    const routeAvailable =
      routeValidated &&
      models.some(
        (model) =>
          model.providerId === route?.providerId &&
          model.id === route?.modelId &&
          isHwpCompatibleModel(model),
      )
    if (!routeAvailable) {
      setModelNotice('Choose an available compatible model before sending.')
      return
    }
    if (!instruction || !loop || !route || !conversationRef.current || loop.busy) return
    stickToBottomRef.current = true
    setChat((prev) => [
      ...prev,
      { role: 'user', text: instruction },
      { role: 'assistant', text: '', streaming: true },
    ])
    setPrompt('')
    setBusy(true)
    setPhase('thinking')
    runToolsRef.current = []
    activeRunRouteRef.current = route
    persistMessage('user', instruction)
    try {
      loop.run(instruction)
    } catch (err: unknown) {
      patchLast({
        streaming: false,
        text: err instanceof Error ? err.message : String(err),
        isError: true,
      })
      setBusy(false)
    }
  }

  const selectModel = (picked: ModelPickerModel): void => {
    const identity = conversationRef.current
    const incoming = models.find(
      (model) => model.providerId === picked.providerId && model.id === picked.modelId,
    )
    if (!identity || !incoming || busy) return
    const route: AiRoute = { providerId: incoming.providerId, modelId: incoming.id }
    if (routeEquals(routeRef.current, route)) return
    setModelNotice(null)
    void window.hwpApi
      .setAiConversationRoute(identity, route)
      .then(() => {
        routeRef.current = route
        setSelectedRoute(route)
        setRouteValidated(true)
        // continue the conversation on the new model from the persisted transcript
        loopRef.current?.reset()
        setChat((prev) =>
          prev
            .filter((entry) => !entry.isError)
            .map((entry) => ({ role: entry.role, text: entry.text, tools: entry.tools })),
        )
        void window.hwpApi
          .loadProjectChat({ projectId: identity.projectId, chatId: identity.chatId })
          .then((messages) =>
            loopRef.current?.restore(
              messages.map((message) => ({ role: message.role, text: message.text })),
            ),
          )
          .catch(() => undefined)
      })
      .catch((err: unknown) =>
        setModelNotice(err instanceof Error ? err.message : String(err)),
      )
  }

  const pickerModels = models.map((model) => toPickerModel(model, providers))
  const pickerSelection = selectedRoute
    ? pickerModels.find(
        (model) => model.providerId === selectedRoute.providerId && model.modelId === selectedRoute.modelId,
      ) ?? null
    : null

  return (
    <aside ref={asideRef} className="hwp-ai" style={{ width: panelWidth }}>
      <div className="hwp-ai__resize" onPointerDown={onResizeStart} role="separator" aria-orientation="vertical" />
      <header className="hwp-ai__head">
        <ModelPicker
          models={pickerModels}
          selection={pickerSelection}
          busy={busy}
          placement="bottom"
          matchTriggerWidth
          onSelectionChange={selectModel}
          ariaLabel="Model for this document"
          placeholder="Choose a model"
          searchPlaceholder="Search models"
          emptyLabel="No compatible models"
        />
        <button type="button" className="hwp-ai__collapse" aria-label="Collapse AI panel" onClick={onCollapse}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {modelNotice && (
        <p className="hwp-ai__notice" role="status">{modelNotice}</p>
      )}

      <div ref={chatRef} className="hwp-ai__chat" onScroll={onChatScroll}>
        {!routeReady && <div className="hwp-ai__empty">Loading AI…</div>}
        {routeReady && chat.length === 0 && (
          <div className="hwp-ai__empty">
            Ask about this document — summarize it, fill its form fields, or update table cells.
          </div>
        )}
        {chat.map((entry, index) => (
          <div key={index} className={`hwp-ai__msg hwp-ai__msg--${entry.role}`}>
            {entry.role === 'assistant' && entry.streaming && !entry.text && entry.tools?.length === 0 && (
              <div className="hwp-ai__phase">
                {phase === 'working' ? 'Working…' : phase === 'replying' ? 'Writing…' : 'Thinking…'}
              </div>
            )}
            {entry.tools?.map((tool, toolIndex) => (
              <details key={toolIndex} className={`hwp-ai__tool${tool.isError ? ' hwp-ai__tool--error' : ''}`}>
                <summary>
                  <span className="hwp-ai__tool-name">{tool.name}</span>
                  <span className="hwp-ai__tool-summary">{tool.summary}</span>
                </summary>
                {tool.output && <pre>{tool.output}</pre>}
              </details>
            ))}
            {entry.text && (
              entry.role === 'assistant' ? (
                <div className="hwp-ai__markdown">
                  <Markdown text={entry.text} />
                </div>
              ) : (
                <p>{entry.text}</p>
              )
            )}
            {entry.isError && entry.retrySuggestion && (
              <p className="hwp-ai__retry">{entry.retrySuggestion}</p>
            )}
          </div>
        ))}
      </div>

      <AiComposer
        value={prompt}
        busy={busy}
        placeholder="Ask about this document…"
        ariaLabel="Message the assistant"
        hintIdle="Enter to send"
        hintBusy="Generating…"
        sendLabel="Send"
        stopLabel="Stop"
        onChange={setPrompt}
        onSend={() => send(prompt)}
        onStop={() => loopRef.current?.cancel()}
      />
    </aside>
  )
}
