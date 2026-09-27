import type { RecognitionResult, RecognitionState } from '../contracts/recognition'

/** UI-level states of the recognition screen, derived from the frozen contract. */
export type UiState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'no_hand'
  | 'hand_detected'
  | 'result'
  | 'paused'
  | 'error'

export type UiTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface UiStateView {
  uiState: UiState
  /** Raw contract state, null before the first engine event. */
  engineState: RecognitionState | null
  /** Short status text; always paired with an icon, never color alone. */
  label: string
  /** Optional human guidance shown next to the camera stage. */
  guidance: string | null
  tone: UiTone
  /** True while the engine is initializing. */
  busy: boolean
  handsDetected: number
  sign: string | null
  accepted: boolean
}

interface StateSpec {
  uiState: UiState
  label: string
  guidance: string | null
  tone: UiTone
  busy?: boolean
}

/** Exhaustive map: adding a contract state breaks the build until mapped. */
const STATE_SPECS: Record<RecognitionState, StateSpec> = {
  camera_off: {
    uiState: 'idle',
    label: 'Camera off',
    guidance: 'Start your camera when you are ready to sign.',
    tone: 'neutral',
  },
  loading: {
    uiState: 'loading',
    label: 'Getting ready',
    guidance: 'Starting the camera and hand tracking…',
    tone: 'info',
    busy: true,
  },
  ready: {
    uiState: 'ready',
    label: 'Camera ready',
    guidance: 'Keep one hand clearly visible in the centre of the frame.',
    tone: 'info',
  },
  no_hand: {
    uiState: 'no_hand',
    label: 'No hand detected',
    guidance: 'Bring one hand into view and hold it steady.',
    tone: 'warning',
  },
  recognizing: {
    uiState: 'hand_detected',
    label: 'Hand detected',
    guidance: 'Checking your sign — keep your hand steady.',
    tone: 'info',
  },
  release_required: {
    uiState: 'hand_detected',
    label: 'Hand detected',
    guidance: 'Sign added. Lower your hand for one second.',
    tone: 'warning',
  },
  low_confidence: {
    uiState: 'result',
    label: 'Not confident enough',
    guidance: 'This sign was uncertain and has not been added.',
    tone: 'warning',
  },
  accepted: {
    uiState: 'result',
    label: 'Sign recognized',
    guidance: 'Sign added. Lower your hand before continuing.',
    tone: 'success',
  },
  paused: {
    uiState: 'paused',
    label: 'Paused',
    guidance: 'Recognition is paused. Your camera preview stays visible.',
    tone: 'neutral',
  },
  error: {
    uiState: 'error',
    label: 'Error',
    guidance: 'Recognition could not start.',
    tone: 'danger',
  },
}

/** Maps the engine contract to displayable UI state. Pure and DOM-free. */
export function describeRecognition(result: RecognitionResult | null, legacyMode = true, capturePhase = 'idle'): UiStateView {
  const state = result ? result.state : 'camera_off'
  const wordSpecs: Partial<Record<RecognitionState, Partial<StateSpec>>> = {
    loading: { guidance: 'Loading the camera and local word model…' },
    ready: { label: 'Ready', guidance: 'Show one sign with your hands and upper body in view.' },
    no_hand: { label: 'Ready', guidance: 'Show your next sign. Keep your upper body in view.' },
    recognizing: capturePhase === 'analyzing'
      ? { label: 'Checking your sign', guidance: 'Checking the captured sign on your device.' }
      : { label: 'Capturing your sign', guidance: 'Complete one sign, then lower your hands. Each capture lasts up to 2.6 seconds.' },
    release_required: { label: 'Lower your hands', guidance: 'Move both hands out of view until you see “Ready”.' },
    accepted: { label: 'Word recognized', guidance: 'Word added. Lower your hands before your next sign.' },
    low_confidence: { guidance: 'No confident match. Lower your hands and try again.' },
  }
  const spec = { ...STATE_SPECS[state], ...(legacyMode ? {} : wordSpecs[state]) }
  const guidance =
    spec.uiState === 'error' && result?.error ? result.error : spec.guidance

  return {
    uiState: spec.uiState,
    engineState: result ? result.state : null,
    label: spec.label,
    guidance,
    tone: spec.tone,
    busy: spec.busy ?? false,
    handsDetected: result?.handsDetected ?? 0,
    sign: result?.sign ?? null,
    accepted: result?.accepted ?? false,
  }
}

/** Shared status wording, so screen chip and result card never diverge. */
export function labelForState(state: RecognitionState | null, legacyMode = true, capturePhase = 'idle'): string {
  if (!state) return 'Waiting for a sign'
  return describeRecognition({ state } as RecognitionResult, legacyMode, capturePhase).label
}

/** Shared status tone for the same contract state. */
export function toneForState(state: RecognitionState | null): UiTone {
  return state ? STATE_SPECS[state].tone : 'neutral'
}

/** Formats the heuristic match score for display, clamped to [0, 1]. */
export function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) return '0 %'
  const clamped = Math.min(1, Math.max(0, value))
  return `${Math.round(clamped * 100)} %`
}
