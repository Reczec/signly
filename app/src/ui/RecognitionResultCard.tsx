import type { RecognitionState } from '../contracts/recognition'
import { formatConfidence } from './uiState'

export interface RecognitionResultCardProps {
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
  accepted: 'Zeichen übernommen und dem Wort hinzugefügt.',
  low_confidence: 'Vorläufiges Zeichen – zu unsicher, wird nicht übernommen.',
  recognizing: 'Vorläufiges Zeichen – wird erst nach der Haltephase übernommen.',
  no_hand: 'Kein Zeichen, solange keine Hand sichtbar ist.',
  release_required: 'Haltephase beendet – bitte die Hand senken.',
  paused: 'Erkennung pausiert, kein neues Zeichen.',
  ready: 'Kamera bereit, es liegt noch kein Zeichen vor.',
  loading: 'Modell wird geladen, es liegt noch kein Zeichen vor.',
  camera_off: 'Kamera aus, es liegt kein Zeichen vor.',
  error: 'Erkennung ausgefallen, es liegt kein Zeichen vor.',
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
}: RecognitionResultCardProps) {
  const hasSign = sign !== null && sign !== ''
  const caption = status ? CAPTIONS[status] : 'Noch kein Ergebnis vom Engine.'
  const percent = hasSign ? formatConfidence(confidence) : '0 %'
  const meterWidth = hasSign ? formatConfidence(confidence) : '0 %'

  return (
    <section className="card result-card" aria-label="Erkennungsergebnis">
      <header className="card-head">
        <h2 className="card-title">Ergebnis</h2>
        <p className={`status-chip status-chip--${toneForStatus(status)}`}>
          {statusLabel(status)}
        </p>
      </header>

      <p className={`result-letter${hasSign ? '' : ' is-empty'}`}>
        {hasSign ? sign : '–'}
      </p>
      <p className="result-caption">{caption}</p>

      <div className="meter">
        <p className="meter-label">
          <span>Match confidence</span>
          <span className="meter-value">{percent}</span>
        </p>
        <div
          className="meter-track"
          role="img"
          aria-label={`Match confidence ${percent}`}
        >
          <div className="meter-fill" style={{ width: meterWidth }} />
        </div>
      </div>
      <p className="footnote">
        Heuristischer Nachbarschafts-Score aus dem kNN-Abgleich, keine
        Wahrscheinlichkeit und keine gemessene Genauigkeit.
      </p>

      {accepted ? (
        <p className="accepted-flag">
          <span aria-hidden="true">✓</span> Übernommen
        </p>
      ) : null}

      <dl className="meta-list">
        <div>
          <dt>Hände</dt>
          <dd>{handsDetected ?? 0}</dd>
        </div>
        <div>
          <dt>Latenz</dt>
          <dd>{latencyMs ?? 0} ms</dd>
        </div>
        <div>
          <dt>Seq</dt>
          <dd>{sequence ?? 0}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd className="meta-list__session">{sessionId ?? '–'}</dd>
        </div>
      </dl>
    </section>
  )
}

function toneForStatus(status: RecognitionState | null): string {
  switch (status) {
    case 'accepted':
      return 'success'
    case 'low_confidence':
    case 'no_hand':
    case 'release_required':
      return 'warning'
    case 'error':
      return 'danger'
    case 'loading':
    case 'recognizing':
      return 'info'
    default:
      return 'neutral'
  }
}

function statusLabel(status: RecognitionState | null): string {
  switch (status) {
    case null:
      return 'Kein Event'
    case 'camera_off':
      return 'Kamera aus'
    case 'loading':
      return 'Lädt'
    case 'ready':
      return 'Bereit'
    case 'no_hand':
      return 'Keine Hand'
    case 'recognizing':
      return 'Auswertung'
    case 'low_confidence':
      return 'Zu unsicher'
    case 'accepted':
      return 'Akzeptiert'
    case 'release_required':
      return 'Hand senken'
    case 'paused':
      return 'Pausiert'
    case 'error':
      return 'Fehler'
  }
}
