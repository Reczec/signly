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
    ? new Date(state.lastAcceptedAt).toLocaleTimeString()
    : null

  return (
    <section className="card word-card" aria-label="Wortbaustein">
      <header className="card-head">
        <h2 className="card-title">Wortbaustein</h2>
        <p className="card-kicker">{letters.length} Tokens</p>
      </header>

      <div className="wb-current">
        <span className={`wb-current-tile${state.currentLetter ? '' : ' is-empty'}`}>
          {state.currentLetter ?? '–'}
        </span>
        <span className="wb-current-text">
          <strong>Letztes akzeptiertes Token</strong>
          <span>
            {acceptedAt ? `angenommen um ${acceptedAt}` : 'noch nichts angenommen'}
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
            Noch kein Zeichen. Starte die Kamera und halte ein Zeichen ruhig.
          </span>
        )}
      </div>

      <div className="wb-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onBackspace}
          disabled={state.word.length === 0}
          aria-label="Letztes Token entfernen"
        >
          <span aria-hidden="true">⌫</span> Rücktaste
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClear}
          disabled={!hasContent}
          aria-label="Wort leeren"
        >
          Leeren
        </button>
      </div>
      <p className="footnote">
        Übernommen werden nur akzeptierte Ereignisse. Erneutes Erkennen desselben
        Ereignisses zählt nicht doppelt.
      </p>
    </section>
  )
}
