import type { RefObject } from 'react'
import { StatusIcon } from './icons'
import { RecognitionStatus } from './RecognitionStatus'
import { attachLandmarkLayer } from './landmarkLayer'
import type { UiState, UiStateView } from './uiState'

export interface RecognitionScreenProps {
  videoRef: RefObject<HTMLVideoElement | null>
  view: UiStateView
  /** True from a start() until the matching stop(). */
  running: boolean
  paused: boolean
  mockMode: boolean
  onStart(): void
  onStop(): void
  onPause(): void
  onResume(): void
}

const BADGE_TONE: Partial<Record<UiState, string>> = {
  ready: 'status-chip--info',
  hand_detected: 'status-chip--success',
  result: 'status-chip--success',
  paused: 'status-chip--neutral',
}

const BADGE_LABEL: Partial<Record<UiState, string>> = {
  ready: 'Kamera bereit',
  hand_detected: 'Hand erkannt',
  result: 'Zeichen erkannt',
  paused: 'Pausiert',
}

/**
 * Polished recognition screen around the untouched camera/recognition area.
 * It only renders a video element, an overlay layer for Laptop A's landmarks
 * and the state UI; camera, MediaPipe and model loading stay in the engine.
 */
export function RecognitionScreen({
  videoRef,
  view,
  running,
  paused,
  mockMode,
  onStart,
  onStop,
  onPause,
  onResume,
}: RecognitionScreenProps) {
  const videoLive = running && !mockMode && view.uiState !== 'loading'
  const showOverlay: UiState[] = ['idle', 'loading', 'no_hand', 'paused', 'error']
  const overlayVisible = showOverlay.includes(view.uiState)
  const badgeVisible = !overlayVisible && BADGE_LABEL[view.uiState] !== undefined

  return (
    <section className="card screen" aria-label="Live-Erkennung">
      <header className="screen-head">
        <div className="screen-head-text">
          <h2 className="card-title">Live-Erkennung</h2>
          <p className="card-sub">
            Kamera, Handpunkte und Buchstabenerkennung laufen lokal im Browser.
          </p>
        </div>
        <RecognitionStatus view={view} />
      </header>

      <div className="stage">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Kameravorschau"
          className={videoLive ? 'is-live' : undefined}
        />
        {/* Mirrored overlay layer reserved for Laptop A's landmark renderer. */}
        <div className="landmark-layer" ref={attachLandmarkLayer} aria-hidden="true" />

        {overlayVisible ? (
          <div className="stage-overlay">
            <span className={`stage-overlay-icon stage-overlay-icon--${view.tone}`}>
              <StatusIcon uiState={view.uiState} />
            </span>
            <p className="stage-overlay-title">
              {view.uiState === 'error' ? 'Erkennung ausgefallen' : view.label}
            </p>
            <p className="stage-overlay-text">{view.guidance}</p>
            {view.uiState === 'error' ? (
              <button type="button" className="btn btn-primary" onClick={onStart}>
                Erneut versuchen
              </button>
            ) : null}
          </div>
        ) : null}

        {badgeVisible ? (
          <p
            className={`stage-badge ${BADGE_TONE[view.uiState] ?? 'status-chip--neutral'}`}
          >
            <span className="status-chip__icon">
              <StatusIcon uiState={view.uiState} />
            </span>
            {BADGE_LABEL[view.uiState]}
            {view.uiState === 'hand_detected' ? ' – ruhig halten' : ''}
          </p>
        ) : null}
      </div>

      {view.guidance && !overlayVisible ? (
        <p className="screen-guidance">{view.guidance}</p>
      ) : null}

      <div className="actions">
        {running ? (
          <>
            {paused ? (
              <button type="button" className="btn btn-primary" onClick={onResume}>
                Erkennung fortsetzen
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onPause}
                disabled={view.uiState === 'loading'}
              >
                Erkennung pausieren
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onStop}>
              Kamera stoppen
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onStart}>
            {view.uiState === 'error' ? 'Erneut versuchen' : 'Kamera starten'}
          </button>
        )}
      </div>

      <p className="screen-hint">
        Empfehlung: eine Hand zeigen, ruhig halten, nach dem übernommenen Zeichen
        für eine Sekunde die Hand senken.
      </p>
    </section>
  )
}
