import type { RecognitionResult } from '../contracts/recognition'

/** Display state of the word builder. Text only ever lives in React state. */
export interface WordBuilderState {
  tokens: readonly { text: string; timestamp: number }[]
  /** Accumulated accepted letters, e.g. H,E,L,P -> HELP. */
  word: string
  /** Last accepted letter, shown separately from the accumulated word. */
  currentLetter: string | null
  lastAcceptedAt: number | null
  sessionId: string | null
  /** Deduplication keys `${sessionId}:${sequence}` of accepted events. */
  processed: ReadonlySet<string>
}

export function createWordBuilder(): WordBuilderState {
  return {
    tokens: [],
    word: '',
    currentLetter: null,
    lastAcceptedAt: null,
    sessionId: null,
    processed: new Set<string>(),
  }
}

function eventKey(result: RecognitionResult): string {
  return `${result.sessionId}:${result.sequence}`
}

/**
 * Folds one engine event into the word builder.
 * Only accepted events with a fresh (sessionId, sequence) append a letter;
 * low confidence, recognizing, paused and error events never change the word.
 * Clearing the word keeps the processed IDs so a delayed replay cannot restore it.
 */
export function applyRecognitionResult(
  state: WordBuilderState,
  result: RecognitionResult,
): WordBuilderState {
  const sessionChanged = state.sessionId !== result.sessionId
  const processed = sessionChanged ? new Set<string>() : state.processed

  if (!result.accepted || result.state !== 'accepted' || !result.sign?.trim()) {
    if (!sessionChanged) return state
    return { ...state, sessionId: result.sessionId, processed }
  }

  const key = eventKey(result)
  if (processed.has(key)) {
    if (!sessionChanged) return state
    return { ...state, sessionId: result.sessionId, processed }
  }

  const next = new Set(processed)
  next.add(key)
  const tokens = [...state.tokens, { text: result.sign.trim(), timestamp: result.timestamp }]
  return {
    tokens,
    word: tokens.map(token => token.text).join(' '),
    currentLetter: result.sign.trim(),
    lastAcceptedAt: result.timestamp,
    sessionId: result.sessionId,
    processed: next,
  }
}

/** Removes the last accumulated letter; empty word stays empty. */
export function backspaceWord(state: WordBuilderState): WordBuilderState {
  if (state.word.length === 0) return state
  const tokens = state.tokens.slice(0, -1)
  return { ...state, tokens, word: tokens.map(token => token.text).join(' '),
    currentLetter: tokens.at(-1)?.text ?? null, lastAcceptedAt: tokens.at(-1)?.timestamp ?? null }
}

/** Empties the visible transcript but retains processed event IDs. */
export function clearWord(state: WordBuilderState): WordBuilderState {
  if (state.word === '' && state.currentLetter === null) return state
  return { ...state, tokens: [], word: '', currentLetter: null, lastAcceptedAt: null }
}
