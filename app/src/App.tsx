import { useEffect, useRef, useState } from 'react'
import type { RecognitionResult } from './contracts/recognition'
import { createRecognitionEngine } from './recognition'
import './App.css'

// Minimal shared bootstrap. Laptop B owns this file after the baseline commit.
export default function App() {
  const video = useRef<HTMLVideoElement>(null)
  const [engine] = useState(createRecognitionEngine)
  const [result, setResult] = useState<RecognitionResult | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => () => engine.stop(), [engine])

  async function start() {
    if (!video.current) return
    setStartError(null)
    try {
      await engine.start(video.current, setResult)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setStartError(error instanceof Error ? error.message : 'Start fehlgeschlagen.')
    }
  }

  const error = result?.error ?? startError

  return (
    <main className="app-shell">
      <header>
        <p className="eyebrow">ASL Fingerspelling · Prototyp</p>
        <h1>Signly</h1>
        <p>Gemeinsames Grundgerüst für Kamera, Erkennung und Oberfläche.</p>
      </header>
      <p className="notice">Bootstrap: Kamera und Buchstabenerkennung sind noch nicht implementiert.</p>
      <section className="camera-panel" aria-label="Kamera und Status">
        <video ref={video} muted playsInline aria-label="Kameravorschau" />
        <p>Status: <strong>{result?.state ?? 'camera_off'}</strong></p>
        <p>Validierte Buchstaben: {engine.getSupportedSigns().join(' ') || 'noch keine'}</p>
        <div className="actions">
          <button onClick={() => void start()} disabled={result?.state === 'loading'}>Engine-Start prüfen</button>
          <button onClick={() => engine.stop()} disabled={!result || result.state === 'camera_off'}>Stop</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
      <p><a href="/collector.html">Zum Collector-Startpunkt</a></p>
    </main>
  )
}
