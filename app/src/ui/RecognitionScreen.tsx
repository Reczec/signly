import type { RefObject } from 'react'
import type { RecognitionState } from '../contracts/recognition'
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
  legacyMode?: boolean
  onStart(): void
  onStop(): void
  onPause(): void
  onResume(): void
}

/** States rendered as a corner badge instead of a full stage overlay. */
const BADGE_STATES: readonly UiState[] = ['ready', 'hand_detected', 'result']

/** Full overlays hide the preview; these states keep the camera picture. */
const SOFT_OVERLAYS: readonly UiState[] = ['loading', 'no_hand', 'paused']

/** Extra badge text so recognizing, accepted and low confidence read differently. */
const BADGE_SUFFIX: Partial<Record<RecognitionState, string>> = {
  recognizing: ' — hold steady',
  release_required: ' — lower your hand',
  low_confidence: ' — not added',
}

/**
 * Polished recognition screen around the untouched camera/recognition area.
 * It only renders a video element, an overlay layer for the local landmarks
 * and the state UI; camera, MediaPipe and model loading stay in the engine.
 */
export function RecognitionScreen({
  videoRef,
  view,
  running,
  paused,
  mockMode,
  legacyMode = false,
  onStart,
  onStop,
  onPause,
  onResume,
}: RecognitionScreenProps) {
  const videoLive = running && !mockMode
  const overlayVisible =
    view.uiState === 'idle' ||
    view.uiState === 'loading' ||
    view.uiState === 'no_hand' ||
    view.uiState === 'paused' ||
    view.uiState === 'error'
  const softOverlay = SOFT_OVERLAYS.includes(view.uiState)
  const badgeVisible = !overlayVisible && BADGE_STATES.includes(view.uiState)

  return (
    <section
      className="card screen"
      aria-label="Live recognition"
      aria-busy={view.busy || undefined}
      data-ui-state={view.uiState}
    >
      <header className="screen-head">
        <div className="screen-head-text">
          <h2 className="card-title">Live recognition</h2>
          <p className="card-sub">
            Your camera stays on your device.
          </p>
        </div>
        <RecognitionStatus view={view} />
      </header>

      <div className="stage">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          className={videoLive ? 'is-live' : undefined}
        />
        {/* Mirrored overlay layer reserved for the local landmark renderer. */}
        <div className="landmark-layer" ref={attachLandmarkLayer} aria-hidden="true" />

        {mockMode ? (
          <p className="stage-placeholder">Mock mode · no real camera feed</p>
        ) : null}

        {overlayVisible ? (
          <div
            className={`stage-overlay${softOverlay ? ' stage-overlay--soft' : ''}`}
          >
            <span className={`stage-overlay-icon stage-overlay-icon--${view.tone}`}>
              <StatusIcon uiState={view.uiState} />
            </span>
            <p className="stage-overlay-title">
              {view.uiState === 'error' ? 'Recognition unavailable' : view.label}
            </p>
            <p className="stage-overlay-text">{view.guidance}</p>
          </div>
        ) : null}

        {badgeVisible ? (
          <p className={`stage-badge status-chip--${view.tone}`}>
            <span className="status-chip__icon">
              <StatusIcon uiState={view.uiState} />
            </span>
            <span>
              {view.label}
              {legacyMode && view.engineState ? BADGE_SUFFIX[view.engineState] ?? '' : ''}
            </span>
          </p>
        ) : null}

        {view.busy ? (
          <span className="stage-progress" aria-hidden="true">
            <span className="stage-progress-bar" />
          </span>
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
                Resume recognition
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onPause}
                disabled={view.busy}
              >
                Pause recognition
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onStop}>
              Stop camera
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onStart}>
            {view.uiState === 'error' ? 'Try again' : 'Start camera'}
          </button>
        )}
      </div>

      <p className="screen-hint">
        {legacyMode ? 'Show one hand, hold steady, then lower it for one second.'
          : 'Keep your hands and upper body well lit. Complete one sign, lower both hands, and wait for “Ready”.'}
      </p>
    </section>
  )
}
