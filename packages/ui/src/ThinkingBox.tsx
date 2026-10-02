import React, { useEffect, useRef, useState } from 'react'
import './ThinkingBox.css'

export interface ThinkingLabels {
  /** title while the model is thinking */
  readonly thinking: string
  /** toggle while collapsed */
  readonly show: string
  /** toggle while expanded */
  readonly hide: string
}

const ENGLISH: ThinkingLabels = {
  thinking: 'Thinking…',
  show: 'Show thinking ▸',
  hide: 'Hide thinking ▾',
}

const LABELS: Record<string, ThinkingLabels> = {
  en: ENGLISH,
  ko: { thinking: '생각 중…', show: '생각 과정 보기 ▸', hide: '생각 과정 접기 ▾' },
  ja: { thinking: '考え中…', show: '思考プロセスを表示 ▸', hide: '思考プロセスを閉じる ▾' },
  zh: { thinking: '思考中…', show: '查看思考过程 ▸', hide: '收起思考过程 ▾' },
  'zh-TW': { thinking: '思考中…', show: '查看思考過程 ▸', hide: '收合思考過程 ▾' },
}

/** labels for a UI language code; languages without a translation read in English */
export function thinkingLabels(lang: string | undefined): ThinkingLabels {
  return (lang ? LABELS[lang] : undefined) ?? ENGLISH
}

export interface ThinkingBoxProps {
  readonly text: string
  /** the model is still thinking (no answer text yet): show the text as it streams in */
  readonly live: boolean
  readonly labels: ThinkingLabels
}

/**
 * The "thinking" box above an assistant answer. Live: a small muted box (about six lines,
 * following the newest text). Afterwards: one collapsed line that opens the full text.
 * The text is shown as plain text — it can contain document content, so nothing in it is interpreted.
 */
export function ThinkingBox({ text, live, labels }: ThinkingBoxProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (live && body) body.scrollTop = body.scrollHeight
  }, [text, live])

  if (!text.trim()) return null

  if (live) {
    return (
      <div className="thinking-box thinking-box--live">
        <div className="thinking-box__title">{labels.thinking}</div>
        <pre ref={bodyRef} className="thinking-box__body">
          {text}
        </pre>
      </div>
    )
  }

  return (
    <div className="thinking-box">
      <button
        type="button"
        className="thinking-box__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? labels.hide : labels.show}
      </button>
      {open && <pre className="thinking-box__body thinking-box__body--full">{text}</pre>}
    </div>
  )
}
