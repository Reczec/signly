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
    label: 'Kamera aus',
    guidance: 'Starte die Kamera, um die Live-Erkennung zu beginnen.',
    tone: 'neutral',
  },
  loading: {
    uiState: 'loading',
    label: 'Wird geladen',
    guidance: 'Kamera und Hand-Landmarker werden initialisiert …',
    tone: 'info',
    busy: true,
  },
  ready: {
    uiState: 'ready',
    label: 'Kamera bereit',
    guidance: 'Halte eine Hand frei sichtbar in die Bildmitte.',
    tone: 'info',
  },
  no_hand: {
    uiState: 'no_hand',
    label: 'Keine Hand erkannt',
    guidance: 'Keine Hand sichtbar. Zeig eine Hand ruhig in die Kamera.',
    tone: 'warning',
  },
  recognizing: {
    uiState: 'hand_detected',
    label: 'Hand erkannt',
    guidance: 'Wird ausgewertet – Hand ruhig halten.',
    tone: 'info',
  },
  release_required: {
    uiState: 'hand_detected',
    label: 'Hand erkannt',
    guidance: 'Zeichen übernommen. Jetzt die Hand für eine Sekunde senken.',
    tone: 'warning',
  },
  low_confidence: {
    uiState: 'result',
    label: 'Zu unsicher',
    guidance: 'Das Zeichen war zu unsicher und wurde nicht übernommen.',
    tone: 'warning',
  },
  accepted: {
    uiState: 'result',
    label: 'Zeichen erkannt',
    guidance: 'Zeichen übernommen. Danach die Hand senken.',
    tone: 'success',
  },
  paused: {
    uiState: 'paused',
    label: 'Pausiert',
    guidance: 'Die Erkennung ist pausiert – die Vorschau bleibt sichtbar.',
    tone: 'neutral',
  },
  error: {
    uiState: 'error',
    label: 'Fehler',
    guidance: 'Die Erkennung konnte nicht gestartet werden.',
    tone: 'danger',
  },
}

/** Maps the engine contract to displayable UI state. Pure and DOM-free. */
export function describeRecognition(result: RecognitionResult | null, legacyMode = true, capturePhase = 'idle'): UiStateView {
  const state = result ? result.state : 'camera_off'
  const wordSpecs: Partial<Record<RecognitionState, Partial<StateSpec>>> = {
    loading: { guidance: 'Kamera und lokale Worterkennung werden geladen …' },
    ready: { label: 'Bereit', guidance: 'Zeige eine einzelne Gebärde. Hände und Oberkörper sollten sichtbar sein.' },
    no_hand: { label: 'Bereit', guidance: 'Zeige die nächste Gebärde mit sichtbarem Oberkörper.' },
    recognizing: capturePhase === 'analyzing'
      ? { label: 'Wird ausgewertet', guidance: 'Die aufgenommene Gebärde wird lokal ausgewertet.' }
      : { label: 'Gebärde wird aufgenommen', guidance: 'Führe eine Gebärde vollständig aus, dann Hände senken. Aufnahme bis zu 1,8 Sekunden.' },
    release_required: { label: 'Hände senken', guidance: 'Nimm beide Hände kurz aus dem Bild, bis „Bereit“ erscheint.' },
    accepted: { label: 'Wort erkannt', guidance: 'Wort übernommen. Hände senken, bevor du die nächste Gebärde zeigst.' },
    low_confidence: { guidance: 'Keine sichere Zuordnung. Hände senken und erneut versuchen.' },
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
  if (!state) return 'Kein Ereignis'
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
