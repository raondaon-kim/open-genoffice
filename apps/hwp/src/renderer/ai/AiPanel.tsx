import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { AgentLoop } from '@genoffice/agent-core'
import type { AgentTransport } from '@genoffice/agent-core'
import type { AiSettings } from '@genoffice/ai-provider'
import {
  AiComposer,
  AiPanelSideButton,
  AiTypingIndicator,
  aiPanelWidthAtPointer,
  Markdown,
} from '@genoffice/ui'
import type { AiConversationIdentity, HwpAttachment, ProjectChatMessage } from '../../shared/ipc'
import attachIcon from '../assets/attach-icon.png'
import sendEnterOn from '../assets/send-enter-on.png'
import sendEnterOff from '../assets/send-enter-off.png'
import sendStop from '../assets/send-stop.png'
import { GensparkMark } from './GensparkMark'
import { ToolSteps } from './ToolSteps'
import { createHwpAssistantSkill } from './assistant-skill'
import { HWP_MAX_TURNS } from './hwp-skill'
import { persistedRunText, runEndText } from './run-notice'
import { shouldRebindChat } from './chat-identity'
import { createElectronTransport } from './transport'
import type { HwpAiContext, HwpAiDeps } from './context'
import type { SnapshotStack } from './snapshots'
import { undoAiEdit } from './tools/edit'
import { fetchExploreChips } from './tools/read'
import { HWP_TEMPLATES } from '../templates'
import type { HwpTemplate } from '../templates'

// the key predates the shared layout: a width the user already chose is kept
const PANEL_WIDTH_KEY = 'hwp-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 360
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
  // the view can be transiently tiny before the shell lays it out: the ceiling never drops below the minimum
  const max = Math.max(PANEL_WIDTH_MIN, Math.min(720, Math.round(window.innerWidth * 0.6)))
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), max)
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  // static bounds only: clamping against a transiently small window would shrink the preference
  return Number.isFinite(saved) && saved > 0
    ? Math.min(Math.max(saved, PANEL_WIDTH_MIN), 720)
    : PANEL_WIDTH_DEFAULT
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
  // preferred = the user's chosen width (the only value saved); panelWidth = what fits the window now
  const preferredWidthRef = useRef(loadPanelWidth())
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(preferredWidthRef.current))
  const [resizing, setResizing] = useState(false)
  const [routeReady, setRouteReady] = useState(false)
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const [lang, setLang] = useState<'en' | 'ko'>('en')
  // the loop is built once; its callbacks read the current language through a ref
  const langRef = useRef(lang)
  langRef.current = lang
  const mutationsRef = useRef(0)
  const [templateBusy, setTemplateBusy] = useState<string | null>(null)
  // files attached to the next requests (an RFP, a source report); read with read_attachment
  const [attachments, setAttachments] = useState<HwpAttachment[]>([])
  const attachmentsRef = useRef<HwpAttachment[]>([])
  attachmentsRef.current = attachments
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
      skill: createHwpAssistantSkill(
        ctxRef.current,
        () => attachmentsRef.current,
        () => window.hwpApi,
        () => window.workWiki,
      ),
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
    // the empty state (starters, form templates) is read from the top
    if (chat.length === 0) return
    if (stickToBottomRef.current) chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [chat, busy])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  // the dock (owned by the app) takes its width from the panel
  useEffect(() => {
    const dock = asideRef.current?.closest('.ai-dock') as HTMLElement | null
    dock?.style.setProperty('--ai-panel-width', `${panelWidth}px`)
  }, [panelWidth])

  // re-derive the shown width when the window changes (max is 60% of it); growing back restores the preference
  useEffect(() => {
    const onResize = (): void => setPanelWidth(clampPanelWidth(preferredWidthRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanupRef.current?.(), [])

  /** drag the panel's inner edge; the pointer is captured so the drag survives crossing the editor iframe */
  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const resizer = event.currentTarget
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent): void => {
      const width = clampPanelWidth(aiPanelWidthAtPointer(ev.clientX))
      preferredWidthRef.current = width
      setPanelWidth(width)
    }
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      resizeCleanupRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      resizer.removeEventListener('lostpointercapture', cleanup)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(preferredWidthRef.current)))
    }
    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    resizer.addEventListener('lostpointercapture', cleanup)
    resizer.setPointerCapture(event.pointerId)
  }

  /** New chat: stop the run and start over; the saved transcript of this file is kept */
  const newChat = (): void => {
    loopRef.current?.cancel()
    loopRef.current?.reset()
    setBusy(false)
    setModelNotice(null)
    setChat([])
  }

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

  const ko = lang === 'ko'
  const startFromPrompt = (text: string): void => {
    setPrompt(text)
    composerRef.current?.focus()
  }

  return (
    <aside
      ref={asideRef}
      className={`copilot${resizing ? ' ai-panel-resizing' : ''}`}
      style={{ width: '100%' }}
    >
      <div
        className="ai-panel-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label={ko ? 'AI 패널 너비 조절' : 'Resize the AI panel'}
      />
      <header className="ai-panel-header">
        <span className="ai-panel-title">
          <GensparkMark size={22} />
          Genspark
        </span>
        <div className="ai-panel-header-actions">
          <AiPanelSideButton
            lang={lang}
            onMove={(side) => window.hwpApi.setAiPanelPrefs({ side })}
          />
          {chat.length > 0 && (
            <button
              type="button"
              className="ai-header-btn ai-panel-new-chat"
              onClick={newChat}
              data-tip={ko ? '새 대화' : 'New chat'}
              aria-label={ko ? '새 대화' : 'New chat'}
            >
              <IconNewChat />
            </button>
          )}
          <button
            type="button"
            className="ai-header-btn ai-panel-collapse"
            onClick={onCollapse}
            data-tip={ko ? 'AI 패널 접기' : 'Collapse the AI panel'}
            aria-label={ko ? 'AI 패널 접기' : 'Collapse the AI panel'}
          >
            <IconCollapse />
          </button>
        </div>
      </header>

      {modelNotice && (
        <p className="hwp-ai__notice" role="status">
          {modelNotice}
        </p>
      )}

      <div ref={chatRef} className="ai-chat" onScroll={onChatScroll}>
        {!routeReady && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-body">{ko ? 'AI 준비 중…' : 'Loading AI…'}</div>
          </div>
        )}
        {routeReady && chat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-title">
              {ko ? '무엇을 도와드릴까요?' : 'How can I help?'}
            </div>
            <div className="ai-chat-empty-body">
              {ko
                ? '문서에 대해 물어보세요 — 요약, 누름틀 작성, 표 정리, 서식 변경을 도와드립니다.'
                : 'Ask about this document — summarize it, fill its form fields, or format it.'}
            </div>
            {chips.length > 0 && (
              <div
                className="ai-starter-list"
                aria-label={ko ? '이 문서로 할 수 있는 일' : 'What this document offers'}
              >
                {chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="ai-starter hwp-ai__starter--chip"
                    onClick={() => startFromPrompt(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
            <div className="ai-starter-list">
              {STARTER_PROMPTS[lang].map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="ai-starter"
                  onClick={() => startFromPrompt(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
            {HWP_TEMPLATES.length > 0 && (
              <div className="hwp-ai__templates">
                <div className="hwp-ai__templates-title">
                  {ko ? '문서 양식으로 바로 만들기' : 'Start from a school form'}
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
        {chat.map((entry, index) => {
          if (entry.role === 'user') {
            return (
              <div key={index} className="ai-msg ai-msg-user">
                <span dir="auto">{entry.text}</span>
              </div>
            )
          }
          const hasTools = (entry.tools?.length ?? 0) > 0
          if (!entry.text && !entry.streaming && !hasTools) return null
          return (
            <div
              key={index}
              className={`ai-msg ai-msg-assistant${entry.isError ? ' ai-msg-error' : ''}${entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              {!entry.text && entry.streaming ? (
                <span className="ai-typing-row">
                  <AiTypingIndicator
                    label={
                      phase === 'working' || hasTools
                        ? ko
                          ? '작업 중'
                          : 'Working'
                        : ko
                          ? '생각 중'
                          : 'Thinking'
                    }
                  />
                </span>
              ) : (
                entry.text && (
                  <div dir="auto">
                    <Markdown text={entry.text} />
                  </div>
                )
              )}
              {hasTools && (
                <ToolSteps tools={entry.tools!} running={!!entry.streaming} lang={lang} />
              )}
            </div>
          )
        })}
      </div>

      {undoDepth > 0 && (
        <div className="hwp-ai__undo-row">
          <button
            type="button"
            className="hwp-ai__undo"
            disabled={busy}
            title={ko ? '마지막 AI 편집 되돌리기' : 'Undo the last AI edit'}
            onClick={() => void undoLast()}
          >
            {ko ? `↶ AI 편집 되돌리기 (${undoDepth})` : `↶ Undo AI edit (${undoDepth})`}
          </button>
        </div>
      )}

      <div className="ai-composer">
        <AiComposer
          header={
            attachments.length > 0 ? (
              <div className="hwp-ai__attachments">
                {attachments.map((a) => (
                  <span key={a.path} className="hwp-ai__attachment" title={a.path}>
                    {a.name}
                    <button
                      type="button"
                      aria-label={ko ? '첨부 제거' : 'Remove attachment'}
                      disabled={busy}
                      onClick={() =>
                        setAttachments((prev) => prev.filter((x) => x.path !== a.path))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : undefined
          }
          footerStart={
            <button
              type="button"
              className="ai-attach-btn"
              disabled={busy}
              title={
                ko
                  ? '파일 첨부 (제안요청서, 참고 문서: hwp·pdf·docx …)'
                  : 'Attach files (an RFP, reference documents: hwp, pdf, docx …)'
              }
              onClick={() =>
                void window.hwpApi
                  .pickAttachments()
                  .then((picked) =>
                    setAttachments((prev) => [
                      ...prev,
                      ...picked.filter((p) => !prev.some((x) => x.path === p.path)),
                    ]),
                  )
                  .catch(() => undefined)
              }
            >
              <img src={attachIcon} alt="" aria-hidden />
            </button>
          }
          value={prompt}
          busy={busy}
          placeholder={ko ? '이 문서에 대해 물어보세요…' : 'Ask about this document…'}
          ariaLabel={ko ? 'AI 도우미에게 메시지 보내기' : 'Message the assistant'}
          textareaRef={composerRef}
          hintIdle={ko ? 'Enter로 보내기' : 'Enter to send'}
          hintBusy={ko ? '작성 중…' : 'Generating…'}
          sendLabel={ko ? '보내기' : 'Send'}
          stopLabel={ko ? '멈추기' : 'Stop'}
          iconOnly
          sendIconEnabled={<img src={sendEnterOn} alt="" aria-hidden />}
          sendIconDisabled={<img src={sendEnterOff} alt="" aria-hidden />}
          stopIcon={<img src={sendStop} alt="" aria-hidden />}
          onChange={setPrompt}
          onSend={() => send(prompt)}
          onStop={() => loopRef.current?.cancel()}
        />
      </div>
    </aside>
  )
}

function IconNewChat(): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path
        d="M13.5 7.2v-3A1.7 1.7 0 0 0 11.8 2.5H4.2a1.7 1.7 0 0 0-1.7 1.7v6.1a1.7 1.7 0 0 0 1.7 1.7h1.1v2l2.6-2h1.3"
        strokeLinejoin="round"
      />
      <path d="M12.2 9.4v4M10.2 11.4h4" />
    </svg>
  )
}

function IconCollapse(): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M5.5 2.5v11" />
      <path d="M12.5 8H8.1M9.8 5.9 7.7 8l2.1 2.1" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
