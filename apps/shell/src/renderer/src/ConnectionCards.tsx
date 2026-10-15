import type { ConnectionMode } from '@genoffice/ai-provider/browser'
import type { StringKey, TFunc } from './locale'

const CARDS: Array<{ mode: ConnectionMode; title: StringKey; desc: StringKey }> = [
  { mode: 'litellm', title: 'setAiModeLitellm', desc: 'setAiModeLitellmDesc' },
  { mode: 'codex', title: 'setAiModeCodex', desc: 'setAiModeCodexDesc' },
  { mode: 'byok', title: 'setAiModeByok', desc: 'setAiModeByokDesc' },
]

/** the three ways to connect, in the order the product recommends them */
export function ConnectionCards({
  mode,
  onPick,
  t,
}: {
  mode: ConnectionMode
  onPick: (mode: ConnectionMode) => void
  t: TFunc
}) {
  return (
    <div className="set-ai-modes" role="radiogroup" aria-label={t('setAiMode')}>
      {CARDS.map((c) => (
        <button
          key={c.mode}
          type="button"
          role="radio"
          aria-checked={mode === c.mode}
          className={`set-ai-mode${mode === c.mode ? ' selected' : ''}`}
          onClick={() => onPick(c.mode)}
        >
          <span className="set-ai-mode-title">{t(c.title)}</span>
          <span className="set-ai-mode-desc">{t(c.desc)}</span>
        </button>
      ))}
    </div>
  )
}
