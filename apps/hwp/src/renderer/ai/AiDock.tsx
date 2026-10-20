import type { ReactElement, ReactNode } from 'react'
import { effectiveAiPanelOpen, onAiRailClick, useSplitPaneRole } from '@genoffice/ui'
import { GensparkMark } from './GensparkMark'

/**
 * The AI panel's slot in the editor row, shared layout with the other editors: it comes
 * first (left by default; Settings › AI panel side moves it with CSS order) and collapses
 * to a 34px rail. The panel stays mounted while collapsed so the conversation survives.
 *
 * In a split the shell gives this view's pane a role: only the focus pane shows the panel,
 * a secondary pane keeps it folded to the rail, and a click on that rail asks the shell to
 * focus this pane and remembers the panel as open, so it appears once focus arrives.
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
  const { role, requestFocus } = useSplitPaneRole()
  const shown = effectiveAiPanelOpen(open, role)
  const label = lang === 'ko' ? 'AI 도우미 열기' : 'Open the AI assistant'
  return (
    <div className={`ai-dock${shown ? '' : ' collapsed'}`}>
      {!shown && (
        <button
          type="button"
          className="ai-rail"
          data-tip={label}
          aria-label={label}
          onClick={() =>
            onAiRailClick(
              role,
              open,
              (next) => {
                if (next) onOpen()
              },
              requestFocus,
            )
          }
        >
          <GensparkMark size={22} />
        </button>
      )}
      {children}
    </div>
  )
}
