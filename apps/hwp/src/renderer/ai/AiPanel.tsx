import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { AgentLoop } from '@genoffice/agent-core'
import type { AgentTransport } from '@genoffice/agent-core'
import type { AiSettings } from '@genoffice/ai-provider'
import { AiComposer, Markdown } from '@genoffice/ui'
import type { AiConversationIdentity, ProjectChatMessage } from '../../shared/ipc'
import { createHwpSkill, HWP_MAX_TURNS } from './hwp-skill'
import { persistedRunText, runEndText } from './run-notice'
import { shouldRebindChat } from './chat-identity'
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
  tools?: ToolActivity[]
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
  const [routeReady, setRouteReady] = useState(false)
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const [lang, setLang] = useState<'en' | 'ko'>('en')
  // the loop is built once; its callbacks read the current language through a ref
  const langRef = useRef(lang)
  langRef.current = lang
  const mutationsRef = useRef(0)
  const [templateBusy, setTemplateBusy] = useState<string | null>(null)
  const [undoDepth, setUndoDepth] = useState(() => deps.stack.depth)
  const [chips, setChips] = useState<string[]>([])
  const chatRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const stickToBottomRef = useRef(true)
  const conversationRef = useRef<AiConversationIdentity | null>(null)
  const settingsRef = useRef<AiSettings | null>(null)
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
  const transportRef = useRef<AgentTransport | null>(null)
  if (!transportRef.current) {
    // settings are refreshed right before every run (send), so the ref is set when a turn starts
    transportRef.current = createElectronTransport(
      () => settingsRef.current!,
      () => langRef.current,
    )
  }
  const loopRef = useRef<AgentLoop | null>(null)
  if (!loopRef.current) {
    loopRef.current = new AgentLoop({
      transport: transportRef.current,
      skill: createHwpSkill(ctxRef.current),
      maxTurns: HWP_MAX_TURNS,
      events: {
        onText: (text) => {
          setPhase('replying')
          patchLast({ text })
        },
        onToolExecuted: ({ call, execution }) => {
          setPhase('working')
          if (execution.mutated) mutationsRef.current++
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
        onDone: ({ text, cancelled, turnLimit }) => {
          const final = runEndText(
            { text, cancelled, turnLimit, mutations: mutationsRef.current },
            langRef.current,
          )
          patchLast({ streaming: false, text: final })
          setBusy(false)
          // a run is saved when the model wrote something or tools ran (keeps the tool record)
          const saved = persistedRunText(
            { text, cancelled, turnLimit, mutations: mutationsRef.current },
            final,
            runToolsRef.current.length,
          )
          if (saved) persistMessage('assistant', saved, runToolsRef.current)
        },
        onError: (error) => {
          patchLast({ streaming: false, text: error, isError: true })
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
      })
      .catch(() => undefined)
  }

  // Route + transcript bootstrap per file
  useEffect(() => {
    let cancelled = false
    const unsaved = conversationRef.current
    if (filePath && unsaved && shouldRebindChat(unsaved, filePath)) {
      // first save of an untitled tab: the conversation (and the loop's memory) stays
      void (async () => {
        try {
          const identity = await window.hwpApi.rebindProjectChat({
            projectId: unsaved.projectId,
            tempChatId: unsaved.chatId,
            newFilePath: filePath,
          })
          if (cancelled) return
          conversationRef.current = identity
        } catch {
          // keep talking under the unsaved id; history still shows in this tab
        }
      })()
      return () => {
        cancelled = true
      }
    }
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
        conversationRef.current = identity
        settingsRef.current = await window.hwpApi.getAiSettings()
        if (cancelled) return
        const messages: ProjectChatMessage[] = await window.hwpApi.loadProjectChat({
          projectId: identity.projectId,
          chatId: identity.chatId,
        })
        if (cancelled) return
        console.info(
          `[hwp-ai] ready: ${messages.length > 0 ? 'transcript restored' : 'new conversation'}`,
        )
        loopRef.current?.restore(messages.map((m) => ({ role: m.role, text: m.text })))
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
    if (!instruction || !loop || !conversationRef.current || loop.busy) return
    setModelNotice(null)
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
    mutationsRef.current = 0
    persistMessage('user', instruction)
    void (async () => {
      try {
        // the model is chosen in Settings › AI: read the current choice for every run
        settingsRef.current = await window.hwpApi.getAiSettings()
        loop.run(instruction)
      } catch (err: unknown) {
        patchLast({
          streaming: false,
          text: err instanceof Error ? err.message : String(err),
          isError: true,
        })
        setBusy(false)
      }
    })()
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

  return (
    <aside ref={asideRef} className="hwp-ai" style={{ width: panelWidth }}>
      <div
        className="hwp-ai__resize"
        onPointerDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
      />
      <header className="hwp-ai__head">
        <span className="hwp-ai__title">{lang === 'ko' ? 'AI 도우미' : 'AI assistant'}</span>
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
            {HWP_TEMPLATES.length > 0 && (
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
              !entry.tools?.length && (
                <div className="hwp-ai__phase">
                  {phase === 'working'
                    ? 'Working…'
                    : phase === 'replying'
                      ? 'Writing…'
                      : 'Thinking…'}
                </div>
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
