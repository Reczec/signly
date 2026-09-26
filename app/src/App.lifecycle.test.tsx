// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { RecognitionResult } from './contracts/recognition'
import App from './App'

const mock = vi.hoisted(() => ({ sink: null as ((r: RecognitionResult) => void) | null, starts: 0 }))
vi.mock('./recognition', () => ({ createRecognitionEngine: () => ({
  start: async (_video: unknown, sink: (r: RecognitionResult) => void) => { mock.sink = sink; mock.starts++ },
  stop() {}, pause() {}, resume() {}, getSupportedSigns: () => [],
}) }))
afterEach(() => { document.body.innerHTML = ''; mock.sink = null; mock.starts = 0 })
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
