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
  // Word models remain offline; the default camera mode only shows landmarks.
  const [engine] = useState(() => createRecognitionEngine(legacyMode ? {} : { loadClassifier: async () => null }))
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
    if (isTerminalResult(next)) setActive(false)
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
    : legacyMode ? 'LEGACY · diagnostisches Buchstabenmodell' : 'Worterkennung · Offline-Evaluation'

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
          : 'Landmark-Diagnostik · Die Worterkennung wird offline geprüft und ist noch nicht live aktiviert.'}</p>}
        <Brand />
        <div className="site-header-badges">
          <PrototypeBadge>Isolierte ASL-Zeichen</PrototypeBadge>
          <PrototypeBadge>Hackathon-Prototyp</PrototypeBadge>
        </div>
      </header>

      <p className="lede">
        Kamera und Handpunkte laufen lokal im Browser, ohne Upload. Öffentliche
        Videodaten dienen dem separaten Offline-Prototyp für isolierte ASL-Wörter.
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
            Kein aktives Klassifikationsmodell. Die Wortpipeline wird erst nach
            erfolgreicher Offline-Evaluation mit der Live-Oberfläche verbunden.
          </p>
        )}
        <p className="footnote">
          Kein automatischer Wechsel zwischen Worterkennung und Legacy-Buchstaben.
          <a href="/?mode=legacy"> Legacy-Diagnostik öffnen</a>
        </p>
      </section>

      <footer className="site-footer">
        <p>
          <strong>Signly</strong> · Isolierte ASL-Zeichen, lokal im
          Browser.
        </p>
        <p>
          Noch keine gemessenen Genauigkeitswerte – Ergebnisse gehören ins
          Messprotokoll, nicht in die Oberfläche.
        </p>
        <p>
          <a href="/collector.html">Legacy-Collector (optional, keine Trainingsaufnahme nötig)</a>
        </p>
      </footer>
    </div>
  )
}
