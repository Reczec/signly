import type { RecognitionResult, RecognitionState } from '../contracts/recognition'

/**
 * ISOLATED MOCK DATA FOR UI DEVELOPMENT.
 *
 * REMOVE BEFORE THE LIVE DEMO / INTEGRATION:
 *   1. delete this file (app/src/mocks/)
 *   2. delete the `MOCK_FLAG` + `demo` wiring in app/src/App.tsx
 *   3. delete the mock banner and DEMO_SIGNS block in app/src/App.tsx
 *
 * This is NOT recognition logic: it never touches a camera, MediaPipe or a
 * model. It only replays a fixed list of contract-shaped events so the UI
 * states can be reviewed on a weak laptop. It is active only when the page is
 * opened with `?mock=1`; the live engine stays the default.
 */

/** Explicit mock vocabulary – never validated, never a live model claim. */
export const DEMO_SIGNS: readonly string[] = Object.freeze(['A', 'B', 'C'])

const MOCK_SESSION_PREFIX = 'mock-session'

interface DemoStep {
  /** Delay in ms relative to the previous step. */
  delayMs: number
  state: RecognitionState
  sign?: string | null
  confidence?: number
  handsDetected?: number
  accepted?: boolean
  error?: string | null
  /** Replays the previous event id on purpose to exercise deduplication. */
  replay?: boolean
}

/** Deterministic sequence covering every UI state the screen must render. */
export const DEMO_STEPS: readonly DemoStep[] = Object.freeze([
  { delayMs: 0, state: 'loading' },
  { delayMs: 900, state: 'ready' },
  { delayMs: 800, state: 'no_hand' },
  { delayMs: 900, state: 'recognizing', sign: 'B', confidence: 0.61, handsDetected: 1 },
  { delayMs: 900, state: 'low_confidence', sign: 'B', confidence: 0.54, handsDetected: 1 },
  { delayMs: 700, state: 'no_hand' },
  { delayMs: 900, state: 'recognizing', sign: 'A', confidence: 0.79, handsDetected: 1 },
  { delayMs: 1100, state: 'accepted', sign: 'A', confidence: 0.91, handsDetected: 1, accepted: true },
  { delayMs: 400, state: 'accepted', sign: 'A', confidence: 0.91, handsDetected: 1, accepted: true, replay: true },
  { delayMs: 800, state: 'release_required', handsDetected: 1 },
  { delayMs: 1300, state: 'no_hand' },
  { delayMs: 1000, state: 'recognizing', sign: 'A', confidence: 0.84, handsDetected: 1 },
  { delayMs: 1100, state: 'accepted', sign: 'A', confidence: 0.93, handsDetected: 1, accepted: true },
  { delayMs: 800, state: 'release_required', handsDetected: 1 },
  { delayMs: 1300, state: 'no_hand' },
  { delayMs: 1000, state: 'recognizing', sign: 'C', confidence: 0.72, handsDetected: 1 },
  { delayMs: 1100, state: 'low_confidence', sign: 'C', confidence: 0.49, handsDetected: 1 },
  { delayMs: 900, state: 'ready' },
  { delayMs: 1500, state: 'error', error: 'Mock-Ereignis: Kamerazugriff wurde vom Browser abgelehnt.' },
  { delayMs: 1600, state: 'loading' },
  { delayMs: 1000, state: 'ready' },
  { delayMs: 1500, state: 'paused' },
  { delayMs: 1600, state: 'ready' },
])

export interface DemoScenario {
  start(onResult: (result: RecognitionResult) => void): void
  pause(): void
  resume(): void
  stop(): void
}

let sessions = 0

export function createDemoScenario(): DemoScenario {
  let timer: ReturnType<typeof setTimeout> | null = null
  let onResult: ((result: RecognitionResult) => void) | null = null
  let sessionId = ''
  let sequence = 0
  let index = 0
  let active = false
  let suspended = false

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function emit(step: DemoStep) {
    if (!onResult) return
    if (!step.replay) sequence += 1
    onResult({
      schemaVersion: 1,
      sessionId,
      sequence,
      sign: step.sign ?? null,
      confidence: step.confidence ?? 0,
      stable: step.accepted ?? false,
      accepted: step.accepted ?? false,
      timestamp: Date.now(),
      state: step.state,
      handsDetected: step.handsDetected ?? 0,
      latencyMs: 38,
      error: step.error ?? null,
    })
  }

  function emitIdle(state: RecognitionState, error: string | null = null) {
    if (!onResult) return
    sequence += 1
    onResult({
      schemaVersion: 1,
      sessionId,
      sequence,
      sign: null,
      confidence: 0,
      stable: false,
      accepted: false,
      timestamp: Date.now(),
      state,
      handsDetected: 0,
      latencyMs: 0,
      error,
    })
  }

  function scheduleNext() {
    if (!active || suspended) return
    const next = DEMO_STEPS[index + 1]
    if (!next) return
    timer = setTimeout(() => {
      timer = null
      index += 1
      emit(DEMO_STEPS[index])
      if (DEMO_STEPS[index].state === 'paused') {
        suspended = true
        return
      }
      scheduleNext()
    }, next.delayMs)
  }

  return {
    start(resultSink) {
      clearTimer()
      onResult = resultSink
      sessionId = `${MOCK_SESSION_PREFIX}-${++sessions}`
      sequence = 0
      index = 0
      active = true
      suspended = false
      emit(DEMO_STEPS[0])
      scheduleNext()
    },
    pause() {
      if (!active || suspended) return
      clearTimer()
      suspended = true
      emitIdle('paused')
    },
    resume() {
      if (!active || !suspended) return
      suspended = false
      if (!DEMO_STEPS[index + 1]) {
        emitIdle('ready')
        return
      }
      scheduleNext()
    },
    stop() {
      clearTimer()
      const wasActive = active
      active = false
      suspended = false
      if (wasActive) emitIdle('camera_off')
    },
  }
}
