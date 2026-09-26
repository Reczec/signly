import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { LandmarkFrame } from '../contracts/recognition'
import { createDataset, type CollectedSample } from '../recognition/dataset'
import { PREPROCESSING_VERSION, tryExtractFeatures } from '../recognition/features'
import {
  createHandLandmarker,
  ensureHandLandmarkerModel,
  type HandLandmarkDetection,
  type HandLandmarkDetector,
} from '../recognition/landmarker'
import { createLandmarkOverlay, type LandmarkOverlay } from '../recognition/overlay'
import './style.css'

const LABELS = ['A', 'B', 'C'] as const
const FRAMES_PER_HOLD = 5
const CAPTURE_INTERVAL_MS = 200
const TARGET_HOLDS_PER_LABEL = 12
const RECOMMENDED_HOLDS_PER_LABEL = 6
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { width: 640, height: 480, facingMode: 'user' },
}

type Label = (typeof LABELS)[number]

interface ActiveHold {
  label: Label
  holdId: string
  captured: number
}

interface FrameRequest {
  kind: 'video' | 'anim' | 'timeout'
  handle: number
}

type VideoWithCallbacks = {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

interface CollectorView {
  status: 'idle' | 'starting' | 'ready' | 'error'
  error: string | null
  reason: string | null
  hands: number
  hold: { label: string; captured: number } | null
  holds: Record<Label, number>
  sampleCount: number
}

const INITIAL_VIEW: CollectorView = {
  status: 'idle',
  error: null,
  reason: null,
  hands: 0,
  hold: null,
  holds: { A: 0, B: 0, C: 0 },
  sampleCount: 0,
}

function normalizeHandedness(categoryName: string | undefined): 'Left' | 'Right' {
  return categoryName === 'Left' ? 'Left' : 'Right'
}

function toFrame(video: HTMLVideoElement, detection: HandLandmarkDetection): LandmarkFrame {
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    hands: detection.landmarks.map((landmarks, index) => ({
      handedness: normalizeHandedness(
        detection.handedness?.[index]?.[0]?.categoryName ??
          detection.handednesses?.[index]?.[0]?.categoryName,
      ),
      landmarks: landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
    })),
  }
}

function cameraErrorText(cause: unknown): string {
  const name = (cause as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Kamerazugriff verweigert. Erlaube die Kamera für diese Seite und starte neu.'
  }
  if (name === 'NotFoundError') return 'Keine Kamera gefunden.'
  if (name === 'NotReadableError') return 'Kamera wird möglicherweise von einer anderen App genutzt.'
  if (name === 'OverconstrainedError') return 'Die Kamera unterstützt 640x480 nicht.'
  return cause instanceof Error ? cause.message : String(cause)
}

export default function Collector() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [view, setView] = useState<CollectorView>(INITIAL_VIEW)
  const pipe = useRef({
    detector: null as HandLandmarkDetector | null,
    overlay: null as LandmarkOverlay | null,
    stream: null as MediaStream | null,
    frameRequest: null as FrameRequest | null,
    running: false,
    sessionId: '',
    holdSeq: 0,
    activeHold: null as ActiveHold | null,
    samples: [] as CollectedSample[],
    holds: { A: 0, B: 0, C: 0 } as Record<Label, number>,
    lastVideoTime: -1,
    lastInferenceAt: Number.NEGATIVE_INFINITY,
    reason: null as string | null,
    hands: 0,
  })

  function syncView() {
    const state = pipe.current
    setView((previous) => ({
      ...previous,
      reason: state.reason,
      hands: state.hands,
      hold: state.activeHold
        ? { label: state.activeHold.label, captured: state.activeHold.captured }
        : null,
      holds: { ...state.holds },
      sampleCount: state.samples.length,
    }))
  }

  function cancelFrame() {
    const state = pipe.current
    const request = state.frameRequest
    if (!request) return
    state.frameRequest = null
    const video = videoRef.current as (HTMLVideoElement & VideoWithCallbacks) | null
    if (request.kind === 'video' && video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(request.handle)
    } else if (request.kind === 'anim' && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(request.handle)
    } else if (request.kind === 'timeout') {
      clearTimeout(request.handle)
    }
  }

  function teardown() {
    const state = pipe.current
    state.running = false
    cancelFrame()
    if (state.overlay) {
      state.overlay.destroy()
      state.overlay = null
    }
    if (state.detector) {
      state.detector.close()
      state.detector = null
    }
    if (state.stream) {
      for (const track of state.stream.getTracks()) track.stop()
      const video = videoRef.current
      if (video && video.srcObject === state.stream) video.srcObject = null
      state.stream = null
    }
    state.activeHold = null
    state.hands = 0
    state.reason = null
  }

  function schedule() {
    const state = pipe.current
    if (!state.running || state.frameRequest) return
    const video = videoRef.current as (HTMLVideoElement & VideoWithCallbacks) | null
    if (!video) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      state.frameRequest = {
        kind: 'video',
        handle: video.requestVideoFrameCallback(() => onFrame()),
      }
      return
    }
    if (typeof requestAnimationFrame === 'function') {
      state.frameRequest = { kind: 'anim', handle: requestAnimationFrame(() => onFrame()) }
      return
    }
    state.frameRequest = {
      kind: 'timeout',
      handle: setTimeout(() => onFrame(), 100) as unknown as number,
    }
  }

  function onFrame() {
    const state = pipe.current
    state.frameRequest = null
    if (!state.running) return
    schedule()
    const video = videoRef.current
    const detector = state.detector
    if (!video || !detector || video.readyState < 2) return
    const stamp = performance.now()
    if (video.currentTime === state.lastVideoTime) return
    if (stamp - state.lastInferenceAt < CAPTURE_INTERVAL_MS) return
    state.lastVideoTime = video.currentTime
    state.lastInferenceAt = stamp

    let detection: HandLandmarkDetection
    try {
      detection = detector.detectForVideo(video, stamp)
    } catch (cause) {
      teardown()
      setView((previous) => ({
        ...previous,
        status: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
        hold: null,
      }))
      return
    }

    const frame = toFrame(video, detection)
    state.overlay?.draw(frame)
    state.hands = frame.hands.length

    let features: number[] | null = null
    if (frame.hands.length === 0) {
      state.reason = 'Keine Hand erkannt'
    } else if (frame.hands.length > 1) {
      state.reason = 'Zwei Hände erkannt – bitte nur eine Hand zeigen'
    } else {
      features = tryExtractFeatures(frame.hands[0].landmarks, frame.width, frame.height)
      state.reason = features ? null : 'Ungültige Handgeometrie'
    }

    const hold = state.activeHold
    if (hold && features) {
      state.samples.push({
        signerId: 'demo',
        sessionId: state.sessionId,
        holdId: hold.holdId,
        split: 'train',
        timestamp: Date.now(),
        label: hold.label,
        preprocessingVersion: PREPROCESSING_VERSION,
        features,
      })
      hold.captured += 1
      if (hold.captured >= FRAMES_PER_HOLD) {
        state.holds[hold.label] += 1
        state.activeHold = null
        state.reason = `${hold.label}: Hold gespeichert (${FRAMES_PER_HOLD} Frames)`
      }
    }
    syncView()
  }

  async function start() {
    const video = videoRef.current
    const state = pipe.current
    if (!video || state.running) return
    setView((previous) => ({ ...previous, status: 'starting', error: null, reason: null }))
    try {
      await ensureHandLandmarkerModel()
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      } catch (cause) {
        throw new Error(cameraErrorText(cause))
      }
      state.stream = stream
      video.srcObject = stream
      await video.play()
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error('Die Kamera liefert keine Videobilder.')
      }
      state.detector = await createHandLandmarker()
      state.overlay = video.parentElement ? createLandmarkOverlay(video) : null
      state.sessionId = `collector-${Date.now()}`
      state.holdSeq = 0
      state.lastVideoTime = -1
      state.lastInferenceAt = Number.NEGATIVE_INFINITY
      state.running = true
      setView((previous) => ({ ...previous, status: 'ready' }))
      schedule()
    } catch (cause) {
      teardown()
      setView((previous) => ({
        ...previous,
        status: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
        hold: null,
      }))
    }
  }

  function stop() {
    teardown()
    setView((previous) => ({
      ...previous,
      status: 'idle',
      error: null,
      reason: null,
      hands: 0,
      hold: null,
    }))
  }

  function beginHold(label: Label) {
    const state = pipe.current
    if (!state.running || state.activeHold) return
    state.holdSeq += 1
    state.activeHold = {
      label,
      holdId: `${state.sessionId}-hold-${state.holdSeq}`,
      captured: 0,
    }
    syncView()
  }

  function cancelHold() {
    pipe.current.activeHold = null
    syncView()
  }

  function exportSamples() {
    const dataset = createDataset()
    dataset.samples = pipe.current.samples
    const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'samples.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  useEffect(() => () => teardown(), [])

  return (
    <main className="collector">
      <header>
        <p className="eyebrow">Signly · Collector</p>
        <h1>Landmark Collector</h1>
        <p>
          5 Frames pro Hold mit ca. 5 Hz. Ein Klick auf den Buchstaben nimmt einen unabhängigen
          Hold auf; danach Export nach data/samples.json.
        </p>
        <p>
          <a href="/">Zurück zur App</a>
        </p>
      </header>

      <section className="panel" aria-label="Kamera">
        <video
          ref={videoRef}
          className="preview"
          muted
          playsInline
          aria-label="Kameravorschau"
        />
        <p>
          Status: <strong>{view.status}</strong> · Hände im Bild: {view.hands}
        </p>
        {view.reason && <p className="reason">{view.reason}</p>}
        {view.hold && (
          <p className="hold-progress">
            Aufnahme: {view.hold.label} · {view.hold.captured}/{FRAMES_PER_HOLD} Frames – Hand
            ruhig halten
          </p>
        )}
        <div className="actions">
          <button
            onClick={() => void start()}
            disabled={view.status === 'starting' || view.status === 'ready'}
          >
            Kamera starten
          </button>
          <button onClick={stop} disabled={view.status !== 'ready'}>
            Kamera stoppen
          </button>
        </div>
        {view.error && <p role="alert">{view.error}</p>}
      </section>

      <section className="panel" aria-label="Holds">
        <h2>Holds aufnehmen</h2>
        <div className="hold-grid">
          {LABELS.map((label) => (
            <div className="hold-row" key={label}>
              <button
                onClick={() => beginHold(label)}
                disabled={view.status !== 'ready' || view.hold !== null}
              >
                {label}
              </button>
              <span>
                {view.holds[label]}/{TARGET_HOLDS_PER_LABEL} Holds
              </span>
            </div>
          ))}
        </div>
        <div className="actions">
          <button onClick={cancelHold} disabled={view.hold === null}>
            Hold abbrechen
          </button>
          <button onClick={exportSamples} disabled={view.sampleCount === 0}>
            Export samples.json ({view.sampleCount})
          </button>
        </div>
        <p>
          {view.sampleCount} Samples gespeichert
          {LABELS.map((label) => ` · ${label}: ${view.holds[label]}`).join('')}
        </p>
        <p className="hint">
          Empfehlung: {RECOMMENDED_HOLDS_PER_LABEL} oder mehr Holds pro Buchstabe für verlässliche
          Live-Ergebnisse; das langfristige Ziel sind {TARGET_HOLDS_PER_LABEL} Holds in zwei
          Sessions. Trainieren ab 3 Holds pro Buchstabe ist möglich.
        </p>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Collector />
  </StrictMode>,
)
