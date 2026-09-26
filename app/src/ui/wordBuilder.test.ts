import { describe, expect, it } from 'vitest'
import type { RecognitionResult } from '../contracts/recognition'
import {
  applyRecognitionResult,
  backspaceWord,
  clearWord,
  createWordBuilder,
} from './wordBuilder'

function makeResult(
  overrides: Partial<RecognitionResult> & {
    state: RecognitionResult['state']
  },
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
    latencyMs: 40,
    error: null,
    ...overrides,
  }
}

function accepted(sign: string, sequence: number, timestamp = 1000) {
  return makeResult({
    state: 'accepted',
    sign,
    sequence,
    confidence: 0.9,
    accepted: true,
    stable: true,
    timestamp,
  })
}

describe('word builder', () => {
  it('starts empty', () => {
    const state = createWordBuilder()
    expect(state.word).toBe('')
    expect(state.currentLetter).toBeNull()
    expect(state.lastAcceptedAt).toBeNull()
    expect(state.processed.size).toBe(0)
  })

  it('appends accepted tokens with a separator', () => {
    let state = createWordBuilder()
    state = applyRecognitionResult(
      state,
      makeResult({ state: 'ready', sequence: 1 }),
    )
    state = applyRecognitionResult(
      state,
      makeResult({ state: 'no_hand', sequence: 2 }),
    )
    state = applyRecognitionResult(
      state,
      makeResult({ state: 'recognizing', sign: 'H', sequence: 3 }),
    )
    state = applyRecognitionResult(
      state,
      makeResult({ state: 'low_confidence', sign: 'E', sequence: 4 }),
    )
    expect(state.word).toBe('')

    state = applyRecognitionResult(state, accepted('H', 5))
    state = applyRecognitionResult(state, accepted('E', 6, 2000))
    expect(state.word).toBe('H E')
    expect(state.currentLetter).toBe('E')
    expect(state.lastAcceptedAt).toBe(2000)
  })

  it('ignores a replayed accepted event with the same session and sequence', () => {
    let state = createWordBuilder()
    state = applyRecognitionResult(state, accepted('A', 7))
    state = applyRecognitionResult(state, accepted('A', 7))
    expect(state.word).toBe('A')
    expect(state.processed.size).toBe(1)
  })

  it('appends the same letter again after a release with a new sequence', () => {
    let state = createWordBuilder()
    state = applyRecognitionResult(state, accepted('A', 7))
    state = applyRecognitionResult(
      state,
      makeResult({ state: 'release_required', sequence: 8 }),
    )
    state = applyRecognitionResult(
      state,
      makeResult({ state: 'no_hand', sequence: 9 }),
    )
    state = applyRecognitionResult(state, accepted('A', 10))
    expect(state.word).toBe('A A')
    expect(state.currentLetter).toBe('A')
  })

  it('does not append while paused or in error', () => {
    let state = createWordBuilder()
    state = applyRecognitionResult(state, accepted('A', 1))
    state = applyRecognitionResult(
      state,
      makeResult({ state: 'paused', sequence: 2 }),
    )
    state = applyRecognitionResult(
      state,
      makeResult({ state: 'error', sequence: 3, error: 'boom' }),
    )
    expect(state.word).toBe('A')
  })

  it('backspaces the last letter and handles an empty word', () => {
    let state = createWordBuilder()
    expect(backspaceWord(state).word).toBe('')
    state = applyRecognitionResult(state, accepted('H', 1))
    state = applyRecognitionResult(state, accepted('E', 2))
    state = backspaceWord(state)
    expect(state.word).toBe('H')
    expect(state.currentLetter).toBe('H')
    state = backspaceWord(state)
    expect(state.word).toBe('')
    expect(state.currentLetter).toBeNull()
  })

  it('clears the visible word but keeps processed IDs so a replay cannot restore it', () => {
    let state = createWordBuilder()
    state = applyRecognitionResult(state, accepted('A', 7))
    state = clearWord(state)
    expect(state.word).toBe('')
    expect(state.currentLetter).toBeNull()
    expect(state.processed.size).toBe(1)

    state = applyRecognitionResult(state, accepted('A', 7))
    expect(state.word).toBe('')
  })

  it('resets processed IDs when the session changes but keeps the word', () => {
    const first = applyRecognitionResult(createWordBuilder(), accepted('A', 1))
    expect(first.processed.has('session-1:1')).toBe(true)

    const switched = applyRecognitionResult(
      first,
      makeResult({ state: 'camera_off', sessionId: 'session-2', sequence: 1 }),
    )
    expect(switched.sessionId).toBe('session-2')
    expect(switched.processed.size).toBe(0)
    expect(switched.word).toBe('A')

    const nextSession = applyRecognitionResult(switched, {
      ...accepted('A', 1),
      sessionId: 'session-2',
    })
    expect(nextSession.word).toBe('A A')
    expect(nextSession.processed.has('session-2:1')).toBe(true)
  })
})
