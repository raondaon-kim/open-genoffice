import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { AgentLoop, toRestorableMessages } from '@genoffice/agent-core'
import type { AgentTransport } from '@genoffice/agent-core'
import { codexSignInNotice, openRouterRetrySuggestion } from '@genoffice/ai-provider'
import type { AiModelSummary, AiRoute } from '@genoffice/ai-provider'
import { AiComposer, Markdown, ModelPicker, ThinkingBox, thinkingLabels } from '@genoffice/ui'
import type { ModelPickerModel } from '@genoffice/ui'
import type { AiConversationIdentity, ProjectChatMessage, PublicAiProvider } from '../../shared/ipc'
import { createHwpSkill } from './hwp-skill'
import { createElectronTransport } from './transport'
import type { HwpAiContext, HwpAiDeps } from './context'
import type { SnapshotStack } from './snapshots'
import { undoAiEdit } from './tools/edit'
import { fetchExploreChips } from './tools/read'
import { HWP_TEMPLATES } from '../templates'
import type { HwpTemplate } from '../templates'

const PANEL_WIDTH_KEY = 'hwp-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 420
const PANEL_WIDTH_MIN = 280

/** clickable starter prompts for the empty state (fill the input, do not send) */
const STARTER_PROMPTS: Record<'en' | 'ko', string[]> = {
  en: [
    'Create a course syllabus template',
    'Write a weekly project report',
    'Summarize this document',
    'List the form fields (누름틀)',
  ],
  ko: [
    '강의 실라버스 양식 만들어줘',
    '프로젝트 주간 보고서 작성해줘',
    '이 문서를 요약해줘',
    '누름틀 필드 목록을 확인해줘',
  ],
}

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

function toPickerModel(
  model: AiModelSummary,
  providers: readonly PublicAiProvider[],
): ModelPickerModel {
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
    left != null &&
    right != null &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId
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
  /** what the thinking box shows for this turn */
  thinking?: string
}

type Phase = 'thinking' | 'replying' | 'working'

export function HwpAiPanel({
  deps,
  filePath,
  documentReady,
  onCollapse,
}: {
  deps: HwpAiDeps
  filePath: string | null
  /** the studio has the document loaded (AI tools can snapshot it) */
  documentReady: boolean
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
  const [lang, setLang] = useState<'en' | 'ko'>('en')
  const [templateBusy, setTemplateBusy] = useState<string | null>(null)
  const [undoDepth, setUndoDepth] = useState(() => deps.stack.depth)
  const [chips, setChips] = useState<string[]>([])
  const chatRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const stickToBottomRef = useRef(true)
  const conversationRef = useRef<AiConversationIdentity | null>(null)
  const routeRef = useRef<AiRoute | null>(null)
  const activeRunRouteRef = useRef<AiRoute | null>(null)
  const runToolsRef = useRef<ToolActivity[]>([])
  const depsRef = useRef(deps)
  depsRef.current = deps
  const stackRef = useRef<SnapshotStack>(deps.stack)
  const ctxRef = useRef<HwpAiContext | null>(null)
  if (!ctxRef.current) {
    ctxRef.current = {
      editor: () => depsRef.current.editor(),
      fileName: () => depsRef.current.fileName(),
      api: () => window.hwpApi,
      stack: stackRef.current,
      markAiDirty: () => depsRef.current.markAiDirty(),
    }
  }
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
      skill: createHwpSkill(ctxRef.current),
      events: {
        onThinking: (thinking) => {
          setPhase('thinking')
          patchLast({ thinking })
        },
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
          setUndoDepth(stackRef.current?.depth ?? 0)
        },
        onTurnEnd: () => {
          setPhase('thinking')
          patchLast({ streaming: false })
          setChat((prev) => [...prev, { role: 'assistant', text: '', streaming: true }])
        },
        onDone: ({ text, cancelled, turnLimit, reasoning, thinking }) => {
          const final = turnLimit
            ? [text, 'Turn limit reached.'].filter(Boolean).join('\n\n')
            : text || (cancelled ? 'Stopped.' : '')
          patchLast((last) => ({
            streaming: false,
            text: final || (last.tools?.length ? last.text : 'No reply.'),
          }))
          setBusy(false)
          if (final && !cancelled) {
            persistMessage('assistant', final, runToolsRef.current, activeRunRouteRef.current, {
              reasoning,
              thinking,
            })
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
            retrySuggestion: failedRoute
              ? openRouterRetrySuggestion(failedRoute, failedModel)
              : undefined,
          })
          setBusy(false)
        },
      },
    })
  }

  const patchLast = (
    patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>),
  ): void => {
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
    thought?: { reasoning?: string | undefined; thinking?: string | undefined },
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
        ...(role === 'assistant' && thought?.reasoning ? { reasoning: thought.reasoning } : {}),
        ...(role === 'assistant' && thought?.thinking ? { thinking: thought.thinking } : {}),
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
        const identity = await window.hwpApi.resolveProjectChat(
          filePath
            ? { filePath }
            : {
                filePath: null,
                tempChatId: `unsaved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              },
        )
        if (cancelled) return
        const [settings, catalog, storedRoute] = await Promise.all([
          window.hwpApi.getAiPublicSettings(),
          window.hwpApi.listAiModels(),
          window.hwpApi.getAiConversationRoute(identity),
        ])
        if (cancelled) return
        conversationRef.current = identity
        setProviders(settings.providers)
        const compatible = catalog.models.filter(isHwpCompatibleModel)
        setModels(compatible)
        // auto-select: keep the stored/default route when it is usable, otherwise
        // fall back to the first compatible model so the panel never blocks on
        // an unavailable selection
        let route = storedRoute
        if (
          !compatible.some((model) =>
            routeEquals(route, { providerId: model.providerId, modelId: model.id }),
          )
        ) {
          const fallback = compatible[0]
          if (fallback) {
            route = { providerId: fallback.providerId, modelId: fallback.id }
            try {
              route = await window.hwpApi.setAiConversationRoute(identity, route)
            } catch {
              // keep the local fallback for this session even if persistence fails
            }
            if (cancelled) return
          }
        }
        routeRef.current = route
        setSelectedRoute(route)
        const routeUsable = compatible.some((model) =>
          routeEquals(route, { providerId: model.providerId, modelId: model.id }),
        )
        setRouteValidated(routeUsable)
        // the default route is Codex: before sign-in, say where to sign in
        const codexNotice = codexSignInNotice(storedRoute, settings.providers)
        setModelNotice(
          compatible.length === 0
            ? (codexNotice ??
                'No AI model is available — add a provider key in Settings to use the assistant here.')
            : routeUsable
              ? null
              : (codexNotice ??
                `The selected model (${route.modelId}) is unavailable. Choose a compatible one from the picker.`),
        )
        const messages: ProjectChatMessage[] = await window.hwpApi.loadProjectChat({
          projectId: identity.projectId,
          chatId: identity.chatId,
        })
        if (cancelled) return
        console.info(
          `[hwp-ai] route ready: ${route.providerId}/${route.modelId}, ${compatible.length} compatible model(s), ${messages.length > 0 ? 'transcript restored' : 'new conversation'}`,
        )
        loopRef.current?.restore(toRestorableMessages(messages))
        setChat(
          messages.map((message) => ({
            role: message.role,
            text: message.text,
            tools: message.tools,
            ...(message.thinking ? { thinking: message.thinking } : {}),
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

  // empty state: what the engine thinks this document is for (rhwp explore) —
  // display only; clicking a chip drafts a prompt, nothing is sent
  useEffect(() => {
    if (!routeReady || !documentReady || chat.length > 0) {
      setChips([])
      return
    }
    let cancelled = false
    const ctx = ctxRef.current
    if (!ctx) return
    void fetchExploreChips(ctx).then((list) => {
      if (!cancelled) setChips(list)
    })
    return () => {
      cancelled = true
    }
  }, [routeReady, documentReady, chat.length, filePath])

  // UI language: Korean gets Korean starter prompts (document/work language)
  useEffect(() => {
    let cancelled = false
    void window.hwpApi
      .getLanguage()
      .then((l) => {
        if (!cancelled) setLang(l === 'ko' ? 'ko' : 'en')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

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

  const undoLast = async (): Promise<void> => {
    const ctx = ctxRef.current
    if (!ctx || busy) return
    try {
      const result = await undoAiEdit(ctx)
      setModelNotice(result.output)
    } catch (err) {
      setModelNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setUndoDepth(stackRef.current?.depth ?? 0)
    }
  }

  const createTemplate = async (template: HwpTemplate): Promise<void> => {
    if (templateBusy) return
    const api = window.hwpApi
    if (!api?.createDocument) {
      setModelNotice('양식 생성 기능을 사용할 수 없습니다.')
      return
    }
    setTemplateBusy(template.id)
    setModelNotice(null)
    try {
      const result = await api.createDocument(template.source, template.fileName)
      if (result.ok && result.path) {
        setModelNotice(
          lang === 'ko'
            ? `「${template.name}」 문서를 새 탭에 만들었습니다. {학교명} 같은 자리표시자를 채우고 ⌘S로 저장하세요.`
            : `Created "${template.name}" in a new tab. Replace placeholders like {school name} and press ⌘S to save.`,
        )
      } else {
        setModelNotice(`양식 생성 실패: ${result.error ?? 'unknown error'}`)
      }
    } catch (err) {
      setModelNotice(`양식 생성 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTemplateBusy(null)
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
            .map((entry) => ({
              role: entry.role,
              text: entry.text,
              tools: entry.tools,
              thinking: entry.thinking,
            })),
        )
        void window.hwpApi
          .loadProjectChat({ projectId: identity.projectId, chatId: identity.chatId })
          .then((messages) => loopRef.current?.restore(toRestorableMessages(messages)))
          .catch(() => undefined)
      })
      .catch((err: unknown) => setModelNotice(err instanceof Error ? err.message : String(err)))
  }

  const pickerModels = models.map((model) => toPickerModel(model, providers))
  const pickerSelection = selectedRoute
    ? (pickerModels.find(
        (model) =>
          model.providerId === selectedRoute.providerId && model.modelId === selectedRoute.modelId,
      ) ?? null)
    : null

  return (
    <aside ref={asideRef} className="hwp-ai" style={{ width: panelWidth }}>
      <div
        className="hwp-ai__resize"
        onPointerDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
      />
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
        {undoDepth > 0 && (
          <button
            type="button"
            className="hwp-ai__undo"
            disabled={busy}
            title={lang === 'ko' ? '마지막 AI 편집 되돌리기' : 'Undo the last AI edit'}
            onClick={() => void undoLast()}
          >
            {lang === 'ko' ? `↶ AI 편집 되돌리기 (${undoDepth})` : `↶ Undo AI edit (${undoDepth})`}
          </button>
        )}
        <button
          type="button"
          className="hwp-ai__collapse"
          aria-label="Collapse AI panel"
          onClick={onCollapse}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M6 3l5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {modelNotice && (
        <p className="hwp-ai__notice" role="status">
          {modelNotice}
        </p>
      )}

      <div ref={chatRef} className="hwp-ai__chat" onScroll={onChatScroll}>
        {!routeReady && <div className="hwp-ai__empty">Loading AI…</div>}
        {routeReady && chat.length === 0 && (
          <div className="hwp-ai__empty">
            <p>
              {lang === 'ko'
                ? '문서에 대해 물어보세요 — 요약, 누름틀 작성, 표 정리, 서식 변경을 도와드립니다.'
                : 'Ask about this document — summarize it, fill its form fields, or format it.'}
            </p>
            {chips.length > 0 && (
              <div
                className="hwp-ai__starter-list"
                aria-label={lang === 'ko' ? '이 문서로 할 수 있는 일' : 'What this document offers'}
              >
                {chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="hwp-ai__starter hwp-ai__starter--chip"
                    onClick={() => {
                      setPrompt(chip)
                      composerRef.current?.focus()
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
            {models.length > 0 && (
              <div className="hwp-ai__starter-list">
                {STARTER_PROMPTS[lang].map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    className="hwp-ai__starter"
                    onClick={() => {
                      setPrompt(starter)
                      composerRef.current?.focus()
                    }}
                  >
                    {starter}
                  </button>
                ))}
              </div>
            )}
            {models.length > 0 && HWP_TEMPLATES.length > 0 && (
              <div className="hwp-ai__templates">
                <div className="hwp-ai__templates-title">
                  {lang === 'ko' ? '문서 양식으로 바로 만들기' : 'Start from a school form'}
                </div>
                {HWP_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="hwp-ai__template"
                    disabled={templateBusy !== null}
                    onClick={() => void createTemplate(template)}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {chat.map((entry, index) => (
          <div key={index} className={`hwp-ai__msg hwp-ai__msg--${entry.role}`}>
            {entry.role === 'assistant' &&
              entry.streaming &&
              !entry.text &&
              !entry.thinking &&
              entry.tools?.length === 0 && (
                <div className="hwp-ai__phase">
                  {phase === 'working'
                    ? 'Working…'
                    : phase === 'replying'
                      ? 'Writing…'
                      : 'Thinking…'}
                </div>
              )}
            {entry.role === 'assistant' && entry.thinking && (
              <ThinkingBox
                text={entry.thinking}
                live={Boolean(entry.streaming && !entry.text)}
                labels={thinkingLabels(lang)}
              />
            )}
            {entry.tools?.map((tool, toolIndex) => (
              <details
                key={toolIndex}
                className={`hwp-ai__tool${tool.isError ? ' hwp-ai__tool--error' : ''}`}
              >
                <summary>
                  <span className="hwp-ai__tool-name">{tool.name}</span>
                  <span className="hwp-ai__tool-summary">{tool.summary}</span>
                </summary>
                {tool.output && <pre>{tool.output}</pre>}
              </details>
            ))}
            {entry.text &&
              (entry.role === 'assistant' ? (
                <div className="hwp-ai__markdown">
                  <Markdown text={entry.text} />
                </div>
              ) : (
                <p>{entry.text}</p>
              ))}
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
        textareaRef={composerRef}
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
