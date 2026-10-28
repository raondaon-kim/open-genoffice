import type { Lang } from '@genoffice/i18n'
import type { ReportProgressView } from '@genoffice/report-writer'
import { reportLabels } from './strings-report'

export interface ReportProgressCardProps {
  view: ReportProgressView
  lang: Lang
  /** shown while the run is going on */
  onCancel?: () => void
}

/** progress of a write_report run in the Word and Hangul AI panels: one row per stage and chapter */
export function ReportProgressCard({ view, lang, onCancel }: ReportProgressCardProps) {
  const L = reportLabels(lang)
  const label = (step: ReportProgressView['steps'][number]): string => {
    switch (step.label) {
      case 'report.wikiWaiting':
        return L.wikiWaiting
      case 'report.reading':
        return L.reading
      case 'report.planning':
        return L.planning
      case 'report.summary':
        return L.summary
      case 'report.chapter': {
        const v = step.vars ?? {}
        return L.chapter({
          no: Number(v.no),
          of: Number(v.of),
          title: String(v.title ?? ''),
        })
      }
      default:
        return step.label
    }
  }
  const outcome =
    view.outcome === 'done'
      ? L.done
      : view.outcome === 'cancelled'
        ? L.cancelled
        : view.outcome === 'error'
          ? `${L.error}${view.error ? `: ${view.error}` : ''}`
          : null
  return (
    <div className="ai-report-card" role="status" aria-live="polite">
      <div className="ai-report-title">{L.title}</div>
      <ul className="ai-report-steps">
        {view.steps.map((step, i) => (
          <li key={i} className={`ai-report-step is-${step.state}`}>
            {label(step)}
          </li>
        ))}
      </ul>
      {outcome && <div className={`ai-report-outcome is-${view.outcome}`}>{outcome}</div>}
      {!view.finished && onCancel && (
        <button type="button" className="ai-report-cancel" onClick={onCancel}>
          {L.cancel}
        </button>
      )}
    </div>
  )
}
