import type { ReactElement, ReactNode } from 'react'
import { GensparkMark } from './GensparkMark'

/**
 * The AI panel's slot in the editor row, shared layout with the other editors: it comes
 * first (left by default; Settings › AI panel side moves it with CSS order) and collapses
 * to a 34px rail. The panel stays mounted while collapsed so the conversation survives.
 */
export function HwpAiDock({
  open,
  lang,
  onOpen,
  children,
}: {
  open: boolean
  lang: 'en' | 'ko'
  onOpen: () => void
  children: ReactNode
}): ReactElement {
  const label = lang === 'ko' ? 'AI 도우미 열기' : 'Open the AI assistant'
  return (
    <div className={`ai-dock${open ? '' : ' collapsed'}`}>
      {!open && (
        <button
          type="button"
          className="ai-rail"
          data-tip={label}
          aria-label={label}
          onClick={onOpen}
        >
          <GensparkMark size={22} />
        </button>
      )}
      {children}
    </div>
  )
}
