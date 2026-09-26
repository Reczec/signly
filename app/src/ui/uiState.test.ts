import { describe, expect, it } from 'vitest'
import type { RecognitionResult, RecognitionState } from '../contracts/recognition'
import { describeRecognition, formatConfidence, labelForState, toneForState } from './uiState'

function makeResult(
  overrides: Partial<RecognitionResult> & { state: RecognitionState },
): RecognitionResult {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    sequence: 1,
    sign: null,
    confidence: 0,
    stable: false,
    accepted: false,
    timestamp: 1790416800000,
    handsDetected: 0,
    latencyMs: 0,
    error: null,
    ...overrides,
  }
}

describe('describeRecognition', () => {
  it('maps a missing result to the idle state', () => {
    const view = describeRecognition(null)
    expect(view.uiState).toBe('idle')
    expect(view.engineState).toBeNull()
    expect(view.label).toBe('Kamera aus')
    expect(view.guidance).toBeTruthy()
    expect(view.busy).toBe(false)
  })

  it('maps camera_off to idle', () => {
    expect(describeRecognition(makeResult({ state: 'camera_off' })).uiState).toBe(
      'idle',
    )
  })

  it('maps loading to a busy initializing state', () => {
    const view = describeRecognition(makeResult({ state: 'loading' }))
    expect(view.uiState).toBe('loading')
    expect(view.busy).toBe(true)
  })

  it('maps ready to the camera-ready state', () => {
    const view = describeRecognition(makeResult({ state: 'ready' }))
    expect(view.uiState).toBe('ready')
    expect(view.label).toBe('Kamera bereit')
    expect(view.busy).toBe(false)
  })

  it('maps no_hand to the no-hand-detected state', () => {
    expect(
      describeRecognition(makeResult({ state: 'no_hand' })).uiState,
    ).toBe('no_hand')
  })

  it('maps recognizing and release_required to hand detected', () => {
    const recognizing = describeRecognition(
      makeResult({ state: 'recognizing', sign: 'A', handsDetected: 1 }),
    )
    const release = describeRecognition(
      makeResult({ state: 'release_required', handsDetected: 1 }),
    )
    expect(recognizing.uiState).toBe('hand_detected')
    expect(recognizing.handsDetected).toBe(1)
    expect(recognizing.sign).toBe('A')
    expect(release.uiState).toBe('hand_detected')
    expect(release.guidance).toContain('Hand')
  })

  it('maps accepted and low_confidence to an available result', () => {
    const accepted = describeRecognition(
      makeResult({
        state: 'accepted',
        sign: 'A',
        confidence: 0.91,
        accepted: true,
      }),
    )
    const low = describeRecognition(
      makeResult({ state: 'low_confidence', sign: 'B', confidence: 0.42 }),
    )
    expect(accepted.uiState).toBe('result')
    expect(accepted.tone).toBe('success')
    expect(accepted.accepted).toBe(true)
    expect(low.uiState).toBe('result')
    expect(low.tone).toBe('warning')
    expect(low.accepted).toBe(false)
  })

  it('maps paused and error', () => {
    expect(describeRecognition(makeResult({ state: 'paused' })).uiState).toBe(
      'paused',
    )
    const error = describeRecognition(
      makeResult({ state: 'error', error: 'Kamerazugriff verweigert.' }),
    )
    expect(error.uiState).toBe('error')
    expect(error.tone).toBe('danger')
    expect(error.guidance).toBe('Kamerazugriff verweigert.')
  })

  it('never exposes error text for non-error states', () => {
    const ready = describeRecognition(
      makeResult({ state: 'ready', error: null }),
    )
    expect(ready.uiState).not.toBe('error')
    expect(ready.guidance).not.toContain('verweigert')
  })
})

describe('shared status wording', () => {
  const states: (RecognitionState | null)[] = [
    null,
    'camera_off',
    'loading',
    'ready',
    'no_hand',
    'recognizing',
    'release_required',
    'low_confidence',
    'accepted',
    'paused',
    'error',
  ]

  it('returns one German label per contract state', () => {
    for (const state of states) {
      const label = labelForState(state)
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toMatch(/Event|Ready|Loading|Error/i)
    }
    expect(labelForState(null)).toBe('Kein Ereignis')
    expect(labelForState('accepted')).toBe('Zeichen erkannt')
    expect(labelForState('low_confidence')).toBe('Zu unsicher')
  })

  it('keeps label and tone identical to describeRecognition', () => {
    for (const state of states) {
      if (state === null) continue
      const view = describeRecognition(makeResult({ state }))
      expect(labelForState(state)).toBe(view.label)
      expect(toneForState(state)).toBe(view.tone)
    }
    expect(toneForState(null)).toBe('neutral')
  })
})

describe('formatConfidence', () => {
  it('renders the heuristic score as a percentage', () => {
    expect(formatConfidence(0.857143)).toBe('86 %')
    expect(formatConfidence(0)).toBe('0 %')
    expect(formatConfidence(1)).toBe('100 %')
  })

  it('clamps out-of-range and non-finite input', () => {
    expect(formatConfidence(1.4)).toBe('100 %')
    expect(formatConfidence(-0.2)).toBe('0 %')
    expect(formatConfidence(Number.NaN)).toBe('0 %')
  })
})
