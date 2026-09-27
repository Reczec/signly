import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecognitionResult } from './contracts/recognition'
import { DEMO_SIGNS, createDemoScenario } from './mocks/demoScenario'
import { createRecognitionEngine } from './recognition'
import { loadKnnClassifier } from './recognition/classifier'
import type { WordCaptureRejection } from './recognition/wordCapture'
import { Brand, PrototypeBadge } from './ui/Brand'
import { dispatchLandmarkFrame } from './ui/landmarkLayer'
import { RecognitionResultCard } from './ui/RecognitionResultCard'
import { RecognitionScreen } from './ui/RecognitionScreen'
import { WordBuilderPanel } from './ui/WordBuilderPanel'
import { describeRecognition } from './ui/uiState'
import { isTerminalResult } from './ui/sessionLifecycle'
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
  const legacyMode = useMemo(() => new URLSearchParams(window.location.search).get('mode') === 'legacy', [])
  const [capturePhase, setCapturePhase] = useState('idle')
  const [captureRejection, setCaptureRejection] = useState<WordCaptureRejection | null>(null)
  const [engine] = useState(() => createRecognitionEngine(legacyMode
    ? { loadWordModel: async () => null, loadClassifier: () => loadKnnClassifier() }
    : { onCapturePhase: setCapturePhase, onCaptureRejection: setCaptureRejection }))
  const mockMode = useMemo(
    () => new URLSearchParams(window.location.search).get(MOCK_FLAG) === '1',
    [],
  )
  const [demo] = useState(() => (mockMode ? createDemoScenario() : null))
  const [result, setResult] = useState<RecognitionResult | null>(null)
  const [lastDecision, setLastDecision] = useState<RecognitionResult | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const [wordState, setWordState] = useState(createWordBuilder)
  /** Synchronous guard so a double click cannot start two sessions. */
  const startGuard = useRef(false)
  const startAttempt = useRef(0)

  const handleResult = useCallback((next: RecognitionResult) => {
    setActive(!isTerminalResult(next))
    setResult(next)
    if (next.state !== 'low_confidence' && next.state !== 'release_required') setCaptureRejection(null)
    if (next.state === 'accepted' || next.state === 'low_confidence') setLastDecision(next)
    else if (next.state !== 'release_required') setLastDecision(null)
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
    const attempt = ++startAttempt.current
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
      if (attempt === startAttempt.current) startGuard.current = false
    }
  }

  function stop() {
    startAttempt.current++
    startGuard.current = false
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

  const view = describeRecognition(result, legacyMode || mockMode, capturePhase)
  const paused = view.uiState === 'paused'
  const supportedSigns = mockMode ? DEMO_SIGNS : engine.getSupportedSigns()
  const displayResult = result?.state === 'release_required' && lastDecision ? lastDecision : result
  const vocabularyLabel = mockMode
    ? 'Mock-Vokabular – nicht validiert'
    : legacyMode ? 'LEGACY · diagnostisches Buchstabenmodell' : 'Unterstützte Wörter'

  return (
    <div className="app-shell">
      {mockMode ? (
        <p className="mock-banner" role="status">
          MOCK DATA · UI DEVELOPMENT – keine echte Erkennung, keine Kamera
        </p>
      ) : null}

      <header className="site-header">
        {!mockMode && <p className="notice">{legacyMode
          ? 'LEGACY / DIAGNOSTIK · Statischer A/B/C-Klassifikator, keine Worterkennung.'
          : 'Isolierte ASL-Gebärden lokal im Browser, keine Cloud-Inferenz.'}</p>}
        <Brand />
        <div className="site-header-badges">
          <PrototypeBadge>{legacyMode ? 'Buchstaben-Diagnostik' : 'Isolierte ASL-Gebärden'}</PrototypeBadge>
          <PrototypeBadge>Hackathon-Prototyp</PrototypeBadge>
        </div>
      </header>

      <p className="lede">
        Kamera, Handpunkte, Oberkörperpunkte und Wortmodell laufen lokal im
        Browser, ohne Upload. Bitte einzelne Gebärden klar abgrenzen und nach
        jeder Erkennung die Hände kurz aus dem Bild nehmen.
      </p>

      <main className="demo-grid">
        <RecognitionScreen
          videoRef={video}
          view={view}
          running={active}
          paused={paused}
          mockMode={mockMode}
          legacyMode={legacyMode}
          onStart={() => void start()}
          onStop={stop}
          onPause={pause}
          onResume={resume}
        />

        <div className="side-col">
          <RecognitionResultCard
            legacyMode={legacyMode || mockMode}
            capturePhase={capturePhase}
            captureRejection={captureRejection}
            sign={displayResult?.sign ?? null}
            confidence={displayResult?.confidence ?? 0}
            status={displayResult?.state ?? null}
            accepted={displayResult?.accepted ?? false}
            handsDetected={displayResult?.handsDetected ?? 0}
            latencyMs={displayResult?.latencyMs ?? 0}
            sessionId={displayResult?.sessionId ?? null}
            sequence={displayResult?.sequence ?? null}
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

      <section className="card strip-card" aria-label={legacyMode ? 'Unterstützte Zeichen' : 'Unterstützte Wörter'}>
        <header className="card-head">
          <h2 className="card-title">{vocabularyLabel}</h2>
          <p className="card-kicker">{supportedSigns.length} {legacyMode || mockMode ? 'Zeichen' : 'Wörter'}</p>
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
            Starte die Kamera, um die verfügbaren Wörter des lokalen Modells zu laden.
          </p>
        )}
        <p className="footnote">
          Kein automatischer Wechsel zwischen Worterkennung und Legacy-Buchstaben.
          <a href="/?mode=legacy"> Legacy-Diagnostik öffnen</a>
        </p>
      </section>

      <footer className="site-footer">
        <p>
          <strong>Signly</strong> · Isolierte ASL-Gebärden, lokal im
          Browser.
        </p>
        <p>
          Forschungsprototyp. Die Genauigkeit mit deiner Webcam wurde noch nicht gemessen.
        </p>
        <p>
          <a href="/collector.html">Legacy-Collector (optional, keine Trainingsaufnahme nötig)</a>
        </p>
      </footer>
    </div>
  )
}
