// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { RecognitionResult } from './contracts/recognition'
import App from './App'
import type { RecognitionEngineOptions } from './recognition'

const mock = vi.hoisted(() => ({ sink: null as ((r: RecognitionResult) => void) | null, starts: 0, signs: [] as string[], options: {} as RecognitionEngineOptions }))
vi.mock('./recognition', () => ({ createRecognitionEngine: (options: RecognitionEngineOptions) => {
  mock.options = options
  return {
  start: async (_video: unknown, sink: (r: RecognitionResult) => void) => { mock.sink = sink; mock.starts++ },
  stop() {}, pause() {}, resume() {}, getSupportedSigns: () => mock.signs,
} } }))
afterEach(() => { document.body.innerHTML = ''; mock.sink = null; mock.starts = 0; mock.signs = [] })
it('keeps the specific rejection visible during release and clears it for the next attempt', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
  const event = { schemaVersion: 1 as const, sessionId: 's', sequence: 1, sign: null,
    confidence: 0, stable: false, accepted: false, timestamp: 1, handsDetected: 0, latencyMs: 0, error: null }
  await act(async () => {
    mock.options.onCaptureRejection?.('too_short')
    mock.sink!({ ...event, state: 'low_confidence' })
  })
  expect(host.textContent).toContain('Gebärde zu kurz aufgenommen')
  await act(async () => mock.sink!({ ...event, sequence: 2, state: 'release_required' }))
  expect(host.textContent).toContain('Gebärde zu kurz aufgenommen')
  await act(async () => mock.sink!({ ...event, sequence: 3, state: 'recognizing' }))
  expect(host.textContent).not.toContain('Gebärde zu kurz aufgenommen')
  await act(async () => {
    mock.options.onCaptureRejection?.('confidence')
    mock.sink!({ ...event, sequence: 4, state: 'low_confidence' })
  })
  expect(host.textContent).toContain('Keine sichere Zuordnung')
  expect(host.textContent).not.toContain('Gebärde zu kurz aufgenommen')
  await act(async () => root.unmount())
})

it('offers retry when an already-running engine fails', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find(button => button.textContent === label)
    expect(button).toBeDefined()
    await act(async () => button!.click())
  }
  await click('Kamera starten')
  await act(async () => mock.sink!({ schemaVersion: 1, sessionId: 's', sequence: 2, sign: null,
    confidence: 0, stable: false, accepted: false, timestamp: 1, state: 'error', handsDetected: 0,
    latencyMs: 0, error: 'Camera lost' }))
  expect(host.textContent).not.toContain('Erkennung pausieren')
  await click('Erneut versuchen')
  expect(mock.starts).toBe(2)
  await act(async () => root.unmount())
})

it('renders expanded vocabulary and stays active after the old session closes during restart', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mock.signs = ['thank you', ...Array.from({ length: 49 }, (_, i) => `sample ${i}`)]
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  expect(host.querySelectorAll('.sign-chip')).toHaveLength(50)
  expect(host.querySelector('.sign-chip')?.textContent).toBe('thank you')
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
  const event = { schemaVersion:1 as const, sessionId:'new', sequence:1, sign:null, confidence:0,
    stable:false, accepted:false, timestamp:1, handsDetected:0, latencyMs:0, error:null }
  await act(async () => {
    mock.sink!({ ...event, sessionId:'old', state:'camera_off' })
    mock.sink!({ ...event, state:'loading' })
    mock.sink!({ ...event, state:'ready' })
  })
  expect(host.textContent).toContain('Kamera stoppen')
  expect(host.textContent).not.toContain('Kamera starten')
  await act(async () => root.unmount())
})
