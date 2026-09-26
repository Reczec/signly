import { StatusIcon } from './icons'
import type { UiStateView } from './uiState'

/**
 * Compact status chip for the recognition screen.
 * Always renders icon + text so the state is never communicated by color alone.
 */
export function RecognitionStatus({ view }: { view: UiStateView }) {
  return (
    <p className={`status-chip status-chip--${view.tone}`} data-ui-state={view.uiState}>
      <span className="status-chip__icon">
        <StatusIcon uiState={view.uiState} />
      </span>
      <span>{view.label}</span>
      {view.handsDetected > 0 ? (
        <span className="status-chip__meta">
          {view.handsDetected} {view.handsDetected === 1 ? 'Hand' : 'Hände'}
        </span>
      ) : null}
    </p>
  )
}
