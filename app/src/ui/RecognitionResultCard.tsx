import type { RecognitionState } from '../contracts/recognition'
import type { WordCaptureRejection } from '../recognition/wordCapture'
import { formatConfidence, labelForState, toneForState } from './uiState'

export interface RecognitionResultCardProps {
  legacyMode?: boolean
  capturePhase?: string
  captureRejection?: WordCaptureRejection | null
  /** Predicted letter, null when the engine has no candidate. */
  sign: string | null
  /** Heuristic match score in [0, 1] from the recognition contract. */
  confidence: number
  /** Contract recognition state, null before the first engine event. */
  status: RecognitionState | null
  accepted?: boolean
  handsDetected?: number
  latencyMs?: number
  sessionId?: string | null
  sequence?: number | null
}

const CAPTIONS: Partial<Record<RecognitionState, string>> = {
  accepted: 'Sign accepted and added to your output.',
  low_confidence: 'Tentative sign — too uncertain to add.',
  recognizing: 'Tentative sign — hold steady to confirm.',
  no_hand: 'No sign while your hands are out of view.',
  release_required: 'Hold complete. Please lower your hand.',
  paused: 'Recognition paused. No new sign.',
  ready: 'Camera ready. Waiting for your first sign.',
  loading: 'Model loading. Your results will appear here.',
  camera_off: 'Camera off. Your results will appear here.',
  error: 'Recognition unavailable. Please try again.',
}

const REJECTION_CAPTIONS: Record<WordCaptureRejection, string> = {
  unsupported_sign: 'No supported sign recognized. Lower your hands and try again.',
  too_short: 'Capture was too short. Complete the sign a little more slowly, then lower your hands.',
  observation_gap: 'The camera briefly stalled. Please try your sign again.',
  landmark_quality: 'Your hands or upper body were not clear enough. Check the lighting and framing.',
  confidence: 'No confident match. Lower your hands and try again.',
}

/**
 * Reusable result presentation. Receives exactly the three contract values
 * (predicted letter, confidence, recognition status) and renders them with
 * an honest score label.
 */
export function RecognitionResultCard({
  sign,
  confidence,
  status,
  accepted = false,
  handsDetected,
  latencyMs,
  sessionId,
  sequence,
  legacyMode = false,
  capturePhase = 'idle',
  captureRejection = null,
}: RecognitionResultCardProps) {
  const hasSign = sign !== null && sign !== ''
  const wordCaptions: Partial<Record<RecognitionState, string>> = {
    accepted: 'Word recognized and added to your output.',
    low_confidence: captureRejection ? REJECTION_CAPTIONS[captureRejection] : 'No confident match. Nothing has been added.',
    recognizing: capturePhase === 'analyzing' ? 'Checking your sign on this device.' : 'Capturing your sign. Complete the full movement.',
    release_required: 'Move both hands out of view before your next sign.',
  }
  const caption = status
    ? legacyMode ? CAPTIONS[status] : wordCaptions[status] ?? 'Your next word will appear here.'
    : 'A little movement. A new word. Start your camera to begin.'
  const hasScore = hasSign || status === 'low_confidence'
  const percent = hasScore ? formatConfidence(confidence) : '0 %'
  const meterWidth = `${hasScore && Number.isFinite(confidence) ? Math.round(Math.min(1, Math.max(0, confidence)) * 100) : 0}%`
  const scoreLabel = legacyMode ? 'Match confidence' : 'Model confidence'

  return (
    <section className="card result-card" aria-label="Recognition result">
      <header className="card-head">
        <h2 className="card-title">Result</h2>
        <p className={`status-chip status-chip--${toneForState(status)}`}>
          {labelForState(status, legacyMode, capturePhase)}
        </p>
      </header>

      <p className={`result-letter${hasSign ? '' : ' is-empty'}`}>
        {hasSign ? sign : '–'}
      </p>
      <p className="result-caption">{caption}</p>

      <div className="meter">
        <p className="meter-label">
          <span>{scoreLabel}</span>
          <span className="meter-value">{percent}</span>
        </p>
        <div
          className="meter-track"
          role="img"
          aria-label={`${scoreLabel} ${percent}`}
        >
          <div className="meter-fill" style={{ width: meterWidth }} />
        </div>
      </div>
      <p className="footnote">
        {legacyMode ? 'Heuristic kNN match score. This is not a probability or measured accuracy.'
          : 'Model confidence, not measured webcam accuracy.'}
      </p>

      {accepted ? (
        <p className="accepted-flag">
          <span aria-hidden="true">✓</span> Added
        </p>
      ) : null}

      <details className="diagnostics"><summary>Session details</summary>
      <dl className="meta-list">
        <div>
          <dt>Hands</dt>
          <dd>{handsDetected ?? 0}</dd>
        </div>
        <div>
          <dt>Processing</dt>
          <dd>{latencyMs ?? 0} ms</dd>
        </div>
        <div>
          <dt>Event</dt>
          <dd>{sequence ?? 0}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd className="meta-list__session">{sessionId ?? '–'}</dd>
        </div>
      </dl>
      </details>
    </section>
  )
}
