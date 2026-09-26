import type { RecognitionState } from '../contracts/recognition'
import { formatConfidence, labelForState, toneForState } from './uiState'

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
  const caption = status
    ? CAPTIONS[status]
    : 'Noch kein Ergebnis – die Erkennung wurde noch nicht gestartet.'
  const percent = hasSign ? formatConfidence(confidence) : '0 %'
  const meterWidth = `${hasSign && Number.isFinite(confidence) ? Math.round(Math.min(1, Math.max(0, confidence)) * 100) : 0}%`

  return (
    <section className="card result-card" aria-label="Erkennungsergebnis">
      <header className="card-head">
        <h2 className="card-title">Ergebnis</h2>
        <p className={`status-chip status-chip--${toneForState(status)}`}>
          {labelForState(status)}
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
          <dt>Nr.</dt>
          <dd>{sequence ?? 0}</dd>
        </div>
        <div>
          <dt>Sitzung</dt>
          <dd className="meta-list__session">{sessionId ?? '–'}</dd>
        </div>
      </dl>
    </section>
  )
}
