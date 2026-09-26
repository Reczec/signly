import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RecognitionResult, RecognitionState } from '../contracts/recognition'
import { RecognitionResultCard } from './RecognitionResultCard'
import { RecognitionScreen } from './RecognitionScreen'
import { WordBuilderPanel } from './WordBuilderPanel'
import { describeRecognition } from './uiState'
import { applyRecognitionResult, createWordBuilder } from './wordBuilder'

const videoRef = { current: null } as { current: HTMLVideoElement | null }

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

describe('recognition screen UI states', () => {
  const states: RecognitionState[] = [
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

  it('renders a status label for every contract state', () => {
    for (const state of states) {
      const markup = renderToStaticMarkup(
        <RecognitionScreen
          videoRef={videoRef}
          view={describeRecognition(result(state))}
          running={state !== 'camera_off'}
          paused={state === 'paused'}
          mockMode={false}
          onStart={() => {}}
          onStop={() => {}}
          onPause={() => {}}
          onResume={() => {}}
        />,
      )
      expect(markup).toContain('Live-Erkennung')
      expect(markup).toContain('class="status-chip')
      expect(markup.length).toBeGreaterThan(200)
    }
  })

  it('shows the start call to action while idle', () => {
    const markup = renderToStaticMarkup(
      <RecognitionScreen
        videoRef={videoRef}
        view={describeRecognition(null)}
        running={false}
        paused={false}
        mockMode={false}
        onStart={() => {}}
        onStop={() => {}}
        onPause={() => {}}
        onResume={() => {}}
      />,
    )
    expect(markup).toContain('Kamera starten')
    expect(markup).toContain('Kamera aus')
  })

  it('shows pause and stop controls while a session runs', () => {
    const markup = renderToStaticMarkup(
      <RecognitionScreen
        videoRef={videoRef}
        view={describeRecognition(result('ready'))}
        running
        paused={false}
        mockMode={false}
        onStart={() => {}}
        onStop={() => {}}
        onPause={() => {}}
        onResume={() => {}}
      />,
    )
    expect(markup).toContain('Erkennung pausieren')
    expect(markup).toContain('Kamera stoppen')
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
    expect(markup).toContain('Match confidence')
    expect(markup).toContain('86 %')
    expect(markup).toContain('Akzeptiert')
    expect(markup).toContain('Übernommen')
    expect(markup).toContain('keine Wahrscheinlichkeit')
  })

  it('renders an empty result without inventing a letter', () => {
    const markup = renderToStaticMarkup(
      <RecognitionResultCard sign={null} confidence={0} status={null} />,
    )
    expect(markup).toContain('–')
    expect(markup).toContain('0 %')
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
        onBackspace={() => {}}
        onClear={() => {}}
      />,
    )
    expect(markup).toContain('Wortbaustein')
    expect(markup).toContain('Rücktaste')
    expect(markup).toContain('Leeren')
    expect(markup).toContain('2 Zeichen')
  })

  it('disables the controls while the transcript is empty', () => {
    const markup = renderToStaticMarkup(
      <WordBuilderPanel
        state={createWordBuilder()}
        onBackspace={() => {}}
        onClear={() => {}}
      />,
    )
    expect(markup).toContain('disabled')
    expect(markup).toContain('Noch kein Zeichen')
  })
})
