import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RecognitionResult, RecognitionState } from '../contracts/recognition'
import { RecognitionResultCard } from './RecognitionResultCard'
import { RecognitionScreen } from './RecognitionScreen'
import type { RecognitionScreenProps } from './RecognitionScreen'
import { WordBuilderPanel } from './WordBuilderPanel'
import { describeRecognition, labelForState } from './uiState'
import { applyRecognitionResult, createWordBuilder } from './wordBuilder'

const videoRef = { current: null } as { current: HTMLVideoElement | null }
const noop = () => {}

function result(state: RecognitionState): RecognitionResult {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    sequence: 3,
    sign: 'A',
    confidence: 0.857143,
    stable: false,
    accepted: state === 'accepted',
    timestamp: 1790416800000,
    handsDetected: 1,
    latencyMs: 42,
    error: state === 'error' ? 'Kamerazugriff verweigert.' : null,
    state,
  }
}

function renderScreen(overrides: Partial<RecognitionScreenProps> = {}) {
  const view =
    overrides.view ??
    describeRecognition(overrides.running ? result('ready') : null)
  return renderToStaticMarkup(
    <RecognitionScreen
      legacyMode={overrides.legacyMode ?? true}
      videoRef={videoRef}
      view={view}
      running={overrides.running ?? false}
      paused={overrides.paused ?? false}
      mockMode={overrides.mockMode ?? false}
      onStart={overrides.onStart ?? noop}
      onStop={overrides.onStop ?? noop}
      onPause={overrides.onPause ?? noop}
      onResume={overrides.onResume ?? noop}
    />,
  )
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

const ALL_STATES: RecognitionState[] = [
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

describe('recognition screen UI states', () => {
  it('renders a status chip and a machine-readable state for every contract state', () => {
    for (const state of ALL_STATES) {
      const markup = renderScreen({
        view: describeRecognition(result(state)),
        running: state !== 'camera_off',
        paused: state === 'paused',
      })
      expect(markup).toContain('Live-Erkennung')
      expect(markup).toContain('class="status-chip')
      expect(markup).toContain(`data-ui-state="`)
      expect(markup).toContain(labelForState(state))
      expect(markup.length).toBeGreaterThan(200)
    }
  })

  it('shows exactly one start action while idle', () => {
    const markup = renderScreen()
    expect(count(markup, 'Kamera starten')).toBe(1)
    expect(markup).toContain('Kamera aus')
  })

  it('shows exactly one retry action on error and no second one in the overlay', () => {
    const markup = renderScreen({
      view: describeRecognition(result('error')),
      running: false,
    })
    expect(markup).toContain('Erkennung ausgefallen')
    expect(count(markup, 'Erneut versuchen')).toBe(1)
    expect(markup).toContain('Kamerazugriff verweigert.')
  })

  it('never offers start while a session is running', () => {
    const markup = renderScreen({
      view: describeRecognition(result('error')),
      running: true,
    })
    expect(count(markup, 'Erneut versuchen')).toBe(0)
    expect(count(markup, 'Kamera starten')).toBe(0)
    expect(markup).toContain('Erkennung pausieren')
    expect(markup).toContain('Kamera stoppen')
  })

  it('disables pause while loading', () => {
    const markup = renderScreen({
      view: describeRecognition(result('loading')),
      running: true,
    })
    expect(markup).toContain('Erkennung pausieren')
    expect(markup).toContain('disabled')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('stage-progress')
    expect(markup).toContain('stage-overlay--soft')
  })

  it('enables pause for a ready session', () => {
    const markup = renderScreen({
      view: describeRecognition(result('ready')),
      running: true,
    })
    expect(markup).toContain('Erkennung pausieren')
    expect(markup).not.toContain('disabled')
  })

  it('swaps pause for resume while paused and keeps stop available', () => {
    const markup = renderScreen({
      view: describeRecognition(result('paused')),
      running: true,
      paused: true,
    })
    expect(markup).toContain('Erkennung fortsetzen')
    expect(markup).toContain('Kamera stoppen')
    expect(markup).not.toContain('Erkennung pausieren')
    expect(count(markup, 'Erkennung fortsetzen')).toBe(1)
  })

  it('keeps the preview visible for loading, no-hand and paused overlays only', () => {
    const loading = renderScreen({
      view: describeRecognition(result('loading')),
      running: true,
    })
    const noHand = renderScreen({
      view: describeRecognition(result('no_hand')),
      running: true,
    })
    const paused = renderScreen({
      view: describeRecognition(result('paused')),
      running: true,
      paused: true,
    })
    const idle = renderScreen()
    const error = renderScreen({
      view: describeRecognition(result('error')),
      running: false,
    })

    expect(loading).toContain('stage-overlay--soft')
    expect(noHand).toContain('stage-overlay--soft')
    expect(paused).toContain('stage-overlay--soft')
    expect(idle).not.toContain('stage-overlay--soft')
    expect(error).not.toContain('stage-overlay--soft')
  })

  it('labels the stage badge per contract state', () => {
    const ready = renderScreen({
      view: describeRecognition(result('ready')),
      running: true,
    })
    const recognizing = renderScreen({
      view: describeRecognition(result('recognizing')),
      running: true,
    })
    const low = renderScreen({
      view: describeRecognition(result('low_confidence')),
      running: true,
    })
    const accepted = renderScreen({
      view: describeRecognition(result('accepted')),
      running: true,
    })

    expect(ready).toContain('stage-badge')
    expect(ready).toContain('Kamera bereit')
    expect(recognizing).toContain('Hand erkannt – ruhig halten')
    expect(low).toContain('Zu unsicher')
    expect(low).toContain('– nicht übernommen')
    expect(accepted).toContain('Zeichen erkannt')
    expect(accepted).not.toContain('– ruhig halten')
  })

  it('shows the mock placeholder only in mock mode', () => {
    const live = renderScreen({
      view: describeRecognition(result('ready')),
      running: true,
    })
    const mock = renderScreen({
      view: describeRecognition(result('ready')),
      running: true,
      mockMode: true,
    })
    expect(live).not.toContain('Mock-Modus')
    expect(mock).toContain('Mock-Modus · kein echtes Kamerabild')
    expect(mock).not.toContain('is-live')
  })
})

describe('recognition result component', () => {
  it('renders the predicted letter, match confidence and status', () => {
    const markup = renderToStaticMarkup(
      <RecognitionResultCard
        sign="A"
        confidence={0.857143}
        status="accepted"
        accepted
        handsDetected={1}
        latencyMs={42}
        sessionId="session-1"
        sequence={42}
      />,
    )
    expect(markup).toContain('>A<')
    expect(markup).toContain('Modell-Konfidenz')
    expect(markup).toContain('86 %')
    expect(markup).toContain('Übernommen')
    expect(markup).toContain('Keine gemessene Webcam-Genauigkeit')
    expect(markup).toContain('Sitzung')
    expect(markup).not.toContain('Seq')
  })

  it('uses the same status wording as the recognition screen', () => {
    for (const state of ALL_STATES) {
      const markup = renderToStaticMarkup(
        <RecognitionResultCard
          sign={null}
          confidence={0}
          status={state}
        />,
      )
      expect(markup).toContain(labelForState(state, false))
    }
  })

  it('renders an empty result without inventing a letter', () => {
    const markup = renderToStaticMarkup(
      <RecognitionResultCard sign={null} confidence={0} status={null} />,
    )
    expect(markup).toContain('–')
    expect(markup).toContain('0 %')
    expect(markup).toContain('Kein Ereignis')
    expect(markup).not.toContain('>A<')
  })
})

describe('word builder component', () => {
  it('shows accumulated letters and the controls', () => {
    let state = createWordBuilder()
    state = applyRecognitionResult(state, { ...result('accepted'), sequence: 1, sign: 'H' })
    state = applyRecognitionResult(state, { ...result('accepted'), sequence: 2, sign: 'E' })

    const markup = renderToStaticMarkup(
      <WordBuilderPanel
        state={state}
        onBackspace={noop}
        onClear={noop}
      />,
    )
    expect(markup).toContain('Wortbaustein')
    expect(markup).toContain('Rücktaste')
    expect(markup).toContain('Leeren')
    expect(markup).toContain('2 Tokens')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-label="Wort leeren"')
    expect(markup).toContain('aria-label="Letztes Token entfernen"')
  })

  it('disables the controls while the transcript is empty', () => {
    const markup = renderToStaticMarkup(
      <WordBuilderPanel
        state={createWordBuilder()}
        onBackspace={noop}
        onClear={noop}
      />,
    )
    expect(count(markup, 'disabled')).toBe(2)
    expect(markup).toContain('Noch kein Wort')
  })
})
