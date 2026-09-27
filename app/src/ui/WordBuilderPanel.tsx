import type { WordBuilderState } from './wordBuilder'

export interface WordBuilderPanelProps {
  state: WordBuilderState
  onBackspace(): void
  onClear(): void
}

/**
 * Word builder: last accepted letter, accumulated word, backspace and clear.
 * The accumulated word is the polite live region for accepted output only.
 */
export function WordBuilderPanel({
  state,
  onBackspace,
  onClear,
}: WordBuilderPanelProps) {
  const letters = state.tokens.map(token => token.text)
  const hasContent = state.word.length > 0 || state.currentLetter !== null
  const acceptedAt = state.lastAcceptedAt
    ? new Date(state.lastAcceptedAt).toLocaleTimeString('en-GB')
    : null

  return (
    <section className="card word-card" aria-label="Your words">
      <header className="card-head">
        <h2 className="card-title">Your words</h2>
        <p className="card-kicker">{letters.length} {letters.length === 1 ? 'word' : 'words'}</p>
      </header>

      <div className="wb-current">
        <span className={`wb-current-tile${state.currentLetter ? '' : ' is-empty'}`}>
          {state.currentLetter ?? '–'}
        </span>
        <span className="wb-current-text">
          <strong>Last added</strong>
          <span>
            {acceptedAt ? `added at ${acceptedAt}` : 'Waiting for your first sign'}
          </span>
        </span>
      </div>

      <div className="wb-word" aria-live="polite" aria-atomic="true">
        {letters.length > 0 ? (
          letters.map((letter, index) => (
            <span className="wb-tile" key={`${letter}-${index}`}>
              {letter}
            </span>
          ))
        ) : (
          <span className="wb-empty">
            No words yet. Start your camera and show one sign at a time.
          </span>
        )}
      </div>

      <div className="wb-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onBackspace}
          disabled={state.word.length === 0}
          aria-label="Remove last word"
        >
          <span aria-hidden="true">⌫</span> Undo last
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClear}
          disabled={!hasContent}
          aria-label="Clear words"
        >
          Clear
        </button>
      </div>
      <p className="footnote">
        Accepted signs appear here. Use Undo last to remove a word, or Clear to start fresh.
      </p>
    </section>
  )
}
