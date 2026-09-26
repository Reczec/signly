import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecognitionResult } from '../contracts/recognition'
import { DEMO_SIGNS, createDemoScenario } from './demoScenario'

afterEach(() => {
  vi.useRealTimers()
})

function collect() {
  const events: RecognitionResult[] = []
  return { events, sink: (event: RecognitionResult) => events.push(event) }
}

describe('isolated demo scenario (mock data)', () => {
  it('uses explicit, non-validated mock vocabulary', () => {
    expect(DEMO_SIGNS).toEqual(['A', 'B', 'C'])
  })

  it('covers every UI state deterministically without touching a camera', () => {
    vi.useFakeTimers()
    const { events, sink } = collect()
    const demo = createDemoScenario()

    demo.start(sink)
    for (let step = 0; step < 40; step++) vi.advanceTimersByTime(2000)

    const states = events.map((event) => event.state)
    for (const required of [
      'loading',
      'ready',
      'no_hand',
      'recognizing',
      'low_confidence',
      'accepted',
      'release_required',
      'paused',
      'error',
    ]) {
      expect(states).toContain(required)
    }
    expect(new Set(events.map((event) => event.sessionId)).size).toBe(1)
    expect(states[0]).toBe('loading')
    expect(states.at(-1)).toBe('paused')

    demo.resume()
    vi.advanceTimersByTime(3000)
    expect(events.at(-1)?.state).toBe('ready')
    demo.stop()
  })

  it('replays one accepted event id so the UI can prove deduplication', () => {
    vi.useFakeTimers()
    const { events, sink } = collect()
    const demo = createDemoScenario()
    demo.start(sink)
    for (let step = 0; step < 40; step++) vi.advanceTimersByTime(2000)

    const accepted = events.filter((event) => event.accepted)
    expect(accepted.length).toBeGreaterThan(1)
    const keys = accepted.map((event) => `${event.sessionId}:${event.sequence}`)
    expect(keys.length).not.toBe(new Set(keys).size)
    demo.stop()
  })

  it('stops on demand and emits camera_off exactly once', () => {
    vi.useFakeTimers()
    const { events, sink } = collect()
    const demo = createDemoScenario()
    demo.start(sink)
    vi.advanceTimersByTime(500)
    demo.stop()
    demo.stop()
    vi.advanceTimersByTime(5000)

    expect(events.at(-1)?.state).toBe('camera_off')
    expect(events.filter((event) => event.state === 'camera_off').length).toBe(1)
    expect(events.every((event) => event.error === null)).toBe(true)
  })

  it('pauses and resumes the scripted sequence', () => {
    vi.useFakeTimers()
    const { events, sink } = collect()
    const demo = createDemoScenario()
    demo.start(sink)
    vi.advanceTimersByTime(300)
    demo.pause()
    expect(events.at(-1)?.state).toBe('paused')

    const countWhilePaused = events.length
    vi.advanceTimersByTime(5000)
    expect(events.length).toBe(countWhilePaused)

    demo.resume()
    vi.advanceTimersByTime(1200)
    expect(events.length).toBeGreaterThan(countWhilePaused)
    expect(events.at(-1)?.state).not.toBe('paused')
    demo.stop()
  })
})
