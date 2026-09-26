import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecognitionResult } from './contracts/recognition'
import { DEMO_SIGNS, createDemoScenario } from './mocks/demoScenario'
import { createRecognitionEngine } from './recognition'
import { Brand, PrototypeBadge } from './ui/Brand'
import { dispatchLandmarkFrame } from './ui/landmarkLayer'
import { RecognitionResultCard } from './ui/RecognitionResultCard'
import { RecognitionScreen } from './ui/RecognitionScreen'
import { WordBuilderPanel } from './ui/WordBuilderPanel'
import { describeRecognition } from './ui/uiState'
import {
  applyRecognitionResult,
  backspaceWord,
  clearWord,
  createWordBuilder,
} from './ui/wordBuilder'
import './App.css'

const MOCK_FLAG = 'mock'

export default function App() {
  const video = useRef<HTMLVideoElement>(null)
  const [engine] = useState(createRecognitionEngine)
  const mockMode = useMemo(
    () => new URLSearchParams(window.location.search).get(MOCK_FLAG) === '1',
    [],
  )
  const [demo] = useState(() => (mockMode ? createDemoScenario() : null))
  const [result, setResult] = useState<RecognitionResult | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const [wordState, setWordState] = useState(createWordBuilder)
  /** Synchronous guard so a double click cannot start two sessions. */
  const startGuard = useRef(false)

  const handleResult = useCallback((next: RecognitionResult) => {
    setResult(next)
    setWordState((previous) => applyRecognitionResult(previous, next))
  }, [])

  useEffect(
    () => () => {
      engine.stop()
      demo?.stop()
    },
    [engine, demo],
  )

  async function start() {
    if (startGuard.current) return
    startGuard.current = true
    setStartError(null)
    setActive(true)
    try {
      if (demo) {
        demo.start(handleResult)
        return
      }
      if (!video.current) {
        setActive(false)
        return
      }
      await engine.start(video.current, handleResult, dispatchLandmarkFrame)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setActive(false)
      setStartError(
        error instanceof Error ? error.message : 'Start fehlgeschlagen.',
      )
    } finally {
      startGuard.current = false
    }
  }

  function stop() {
    setActive(false)
    if (demo) demo.stop()
    else engine.stop()
  }

  function pause() {
    if (demo) demo.pause()
    else engine.pause()
  }

  function resume() {
    if (demo) demo.resume()
    else engine.resume()
  }

  const view = describeRecognition(result)
  const paused = view.uiState === 'paused'
  const supportedSigns = mockMode ? DEMO_SIGNS : engine.getSupportedSigns()
  const vocabularyLabel = mockMode
    ? 'Mock-Vokabular – nicht validiert'
    : 'Validiertes Vokabular aus dem Modell'

  return (
    <div className="app-shell">
      {mockMode ? (
        <p className="mock-banner" role="status">
          MOCK DATA · UI DEVELOPMENT – keine echte Erkennung, keine Kamera
        </p>
      ) : null}

      <header className="site-header">
        <Brand />
        <div className="site-header-badges">
          <PrototypeBadge>ASL-Fingerspelling</PrototypeBadge>
          <PrototypeBadge>Hackathon-Prototyp</PrototypeBadge>
        </div>
      </header>

      <p className="lede">
        Zeige Buchstaben der amerikanischen Fingersprache vor die Kamera. Kamera,
        Handpunkte und Erkennung laufen vollständig lokal im Browser – ohne
        Backend, ohne Upload.
      </p>

      <main className="demo-grid">
        <RecognitionScreen
          videoRef={video}
          view={view}
          running={active}
          paused={paused}
          mockMode={mockMode}
          onStart={() => void start()}
          onStop={stop}
          onPause={pause}
          onResume={resume}
        />

        <div className="side-col">
          <RecognitionResultCard
            sign={result?.sign ?? null}
            confidence={result?.confidence ?? 0}
            status={result?.state ?? null}
            accepted={result?.accepted ?? false}
            handsDetected={result?.handsDetected ?? 0}
            latencyMs={result?.latencyMs ?? 0}
            sessionId={result?.sessionId ?? null}
            sequence={result?.sequence ?? null}
          />
          <WordBuilderPanel
            state={wordState}
            onBackspace={() => setWordState(backspaceWord)}
            onClear={() => setWordState(clearWord)}
          />
        </div>
      </main>

      {startError && (result?.state !== 'error' || !result.error) ? (
        <p className="alert" role="alert">
          {startError}
        </p>
      ) : null}

      <section className="card strip-card" aria-label="Unterstützte Buchstaben">
        <header className="card-head">
          <h2 className="card-title">{vocabularyLabel}</h2>
          <p className="card-kicker">{supportedSigns.length} Buchstaben</p>
        </header>
        {supportedSigns.length > 0 ? (
          <ul className="sign-strip">
            {supportedSigns.map((sign) => (
              <li
                key={sign}
                className={`sign-chip${view.sign === sign ? ' is-active' : ''}`}
              >
                {sign}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Das Modell wurde noch nicht geladen und validiert. Sobald Laptop A die
            Erkennung integriert, erscheinen hier die geprüften Buchstaben –
            beginnend mit A, B, C.
          </p>
        )}
        <p className="footnote">
          Anerkannt werden nur einzelne Buchstaben. Bewegungszeichen (J, Z) und
          Wortzeichen sind Teil der späteren Version.
        </p>
      </section>

      <footer className="site-footer">
        <p>
          <strong>Signly</strong> · ASL-Fingerspelling-Prototyp, lokal im
          Browser.
        </p>
        <p>
          Noch keine gemessenen Genauigkeitswerte – Ergebnisse gehören ins
          Messprotokoll, nicht in die Oberfläche.
        </p>
        <p>
          <a href="/collector.html">Zum Collector-Startpunkt</a>
        </p>
      </footer>
    </div>
  )
}
