import { useState } from 'react'
import type { ReactElement } from 'react'

export interface ToolStep {
  name: string
  summary: string
  isError?: boolean
  output?: string
}

/** Step-row status icons (timeline glyphs, same as the other editors) */
function StepIcon({ status }: { status: 'done' | 'error' }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      {status === 'error' ? (
        <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
      ) : (
        <path d="m8.5 12.4 2.4 2.4 4.6-5" />
      )}
    </svg>
  )
}

/**
 * Tool activity of one reply, in the other editors' collapsible "Worked · N steps" group.
 * It opens while the reply is still being produced and folds when it ends; a manual toggle
 * wins. A step with output expands to show it.
 */
export function ToolSteps({
  tools,
  running,
  lang,
}: {
  tools: ToolStep[]
  running: boolean
  lang: 'en' | 'ko'
}): ReactElement {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? running
  const label = running
    ? lang === 'ko'
      ? '작업 중'
      : 'Working'
    : lang === 'ko'
      ? `작업 완료 · ${tools.length}단계`
      : `Worked · ${tools.length} step${tools.length === 1 ? '' : 's'}`

  const toggle = (index: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <div className="ai-work-group">
      <button
        type="button"
        className={`ai-work-group-summary${running ? ' running' : ''}`}
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
      >
        {running && !open && <span className="ai-tool-chip-spinner" aria-hidden />}
        <span className="ai-work-group-label">{label}</span>
        <span className={`ai-tool-chip-caret${open ? ' open' : ''}`} aria-hidden>
          ›
        </span>
      </button>
      <div className={`ai-work-group-body${open ? ' open' : ''}`}>
        <div className="ai-work-group-body-inner">
          {tools.map((tool, index) => {
            const hasOutput = !!tool.output
            const isOpen = expanded.has(index)
            const status = tool.isError ? 'error' : 'done'
            return (
              <div key={index} className="ai-step-row">
                <span className={`ai-step-icon ${status}`} aria-hidden>
                  <StepIcon status={status} />
                </span>
                <div className="ai-step-content">
                  {hasOutput ? (
                    <button
                      type="button"
                      className="ai-step-title clickable"
                      title={tool.name}
                      aria-expanded={isOpen}
                      onClick={() => toggle(index)}
                    >
                      {tool.summary}
                    </button>
                  ) : (
                    <span className="ai-step-title" title={tool.name}>
                      {tool.summary}
                    </span>
                  )}
                  {hasOutput && isOpen && (
                    <div className="ai-step-detail">
                      <div className="ai-tool-output">
                        <div className="ai-tool-output-pre">{tool.output}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
