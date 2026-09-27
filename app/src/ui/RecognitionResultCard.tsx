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

const REJECTION_CAPTIONS: Record<WordCaptureRejection, string> = {
  unsupported_sign: 'Keine unterstützte Gebärde erkannt – nicht übernommen. Hände senken und erneut versuchen.',
  too_short: 'Gebärde zu kurz aufgenommen. Führe sie etwas langsamer und vollständig aus, dann Hände senken.',
  observation_gap: 'Die Kamera hat kurz gestockt. Bitte die Gebärde erneut versuchen.',
  landmark_quality: 'Hände oder Oberkörper waren nicht ausreichend sichtbar. Beleuchtung und Bildausschnitt prüfen.',
  confidence: 'Keine sichere Zuordnung – nicht übernommen. Hände senken und erneut versuchen.',
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
    accepted: 'Wort übernommen und der Ausgabe hinzugefügt.',
    low_confidence: captureRejection ? REJECTION_CAPTIONS[captureRejection] : 'Keine sichere Zuordnung – nicht übernommen.',
    recognizing: capturePhase === 'analyzing' ? 'Gebärde wird lokal ausgewertet.' : 'Gebärde wird aufgenommen – bitte vollständig ausführen.',
    release_required: 'Vor der nächsten Gebärde beide Hände aus dem Bild nehmen.',
  }
  const caption = status
    ? legacyMode ? CAPTIONS[status] : wordCaptions[status] ?? 'Noch kein neues Wort.'
    : 'Noch kein Ergebnis – die Erkennung wurde noch nicht gestartet.'
  const hasScore = hasSign || status === 'low_confidence'
  const percent = hasScore ? formatConfidence(confidence) : '0 %'
  const meterWidth = `${hasScore && Number.isFinite(confidence) ? Math.round(Math.min(1, Math.max(0, confidence)) * 100) : 0}%`
  const scoreLabel = legacyMode ? 'Match confidence' : 'Modell-Konfidenz'

  return (
    <section className="card result-card" aria-label="Erkennungsergebnis">
      <header className="card-head">
        <h2 className="card-title">Ergebnis</h2>
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
        {legacyMode ? 'Heuristischer Nachbarschafts-Score aus dem kNN-Abgleich, keine Wahrscheinlichkeit und keine gemessene Genauigkeit.'
          : 'Konfidenz der lokalen Worterkennung. Keine gemessene Webcam-Genauigkeit.'}
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
