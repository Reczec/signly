import { describe, expect, it, vi } from 'vitest';
import type { RecognitionResult } from '../contracts/recognition';
import { createRecognitionEngine } from './index';

// The bootstrap must not access a video element or acquire camera resources.
const video = new Proxy({} as HTMLVideoElement, {
  get() {
    throw new Error('Bootstrap accessed the video element.');
  },
  set() {
    throw new Error('Bootstrap mutated the video element.');
  },
});

describe('honest bootstrap recognition engine', () => {
  it('emits loading and an actionable error, rejects, and never invents signs or landmarks', async () => {
    const engine = createRecognitionEngine();
    const events: RecognitionResult[] = [];
    const onLandmarks = vi.fn();

    expect(engine.getSupportedSigns()).toEqual([]);
    const started = engine.start(video, (event) => events.push(event), onLandmarks);
    expect(events.map((event) => event.state)).toEqual(['loading']);

    await expect(started).rejects.toThrow('validated kNN model');
    expect(events.map((event) => event.state)).toEqual(['loading', 'error']);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[0].sessionId).toBe(events[1].sessionId);
    expect(events[0].error).toBeNull();
    expect(events[1].error).toContain('no signs are enabled');
    expect(onLandmarks).not.toHaveBeenCalled();
    expect(engine.getSupportedSigns()).toEqual([]);
    expect(Object.isFrozen(engine.getSupportedSigns())).toBe(true);

    for (const event of events) {
      expect(event).toMatchObject({
        schemaVersion: 1,
        sign: null,
        confidence: 0,
        stable: false,
        accepted: false,
        handsDetected: 0,
        latencyMs: 0,
      });
      expect(event.timestamp).toBeGreaterThan(0);
    }
  });

  it('cancels asynchronous initialization and emits no stale error after stop', async () => {
    const engine = createRecognitionEngine();
    const events: RecognitionResult[] = [];
    const started = engine.start(video, (event) => events.push(event));

    engine.stop();
    engine.stop();
    await expect(started).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.map((event) => event.state)).toEqual(['loading', 'camera_off']);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.every((event) => event.error === null)).toBe(true);
  });

  it('replaces pending starts with a new session without stale events', async () => {
    const engine = createRecognitionEngine();
    const first: RecognitionResult[] = [];
    const second: RecognitionResult[] = [];
    const firstStart = engine.start(video, (event) => first.push(event));
    const firstCancelled = expect(firstStart).rejects.toMatchObject({ name: 'AbortError' });
    const secondStart = engine.start(video, (event) => second.push(event));

    await firstCancelled;
    await expect(secondStart).rejects.toThrow('Recognition is not available');
    expect(first.map((event) => event.state)).toEqual(['loading', 'camera_off']);
    expect(second.map((event) => event.state)).toEqual(['loading', 'error']);
    expect(first[0].sessionId).not.toBe(second[0].sessionId);
    expect(second[0].sequence).toBe(1);
  });

  it('supports repeated start/stop and returns to camera_off after a failed start', async () => {
    const engine = createRecognitionEngine();
    const events: RecognitionResult[] = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(engine.start(video, (event) => events.push(event))).rejects.toThrow();
      engine.stop();
    }

    expect(new Set(events.map((event) => event.sessionId)).size).toBe(3);
    expect(events.map((event) => event.state)).toEqual([
      'loading', 'error', 'camera_off',
      'loading', 'error', 'camera_off',
      'loading', 'error', 'camera_off',
    ]);
    expect(events.filter((event) => event.state === 'camera_off').every((event) => event.error === null)).toBe(true);
  });

  it('never claims a running or paused recognizer when pause/resume are called', async () => {
    const engine = createRecognitionEngine();
    const events: RecognitionResult[] = [];
    engine.pause();
    engine.resume();
    engine.stop();

    const started = engine.start(video, (event) => events.push(event));
    engine.pause();
    engine.resume();
    await expect(started).rejects.toThrow();
    engine.pause();
    engine.resume();
    expect(events.map((event) => event.state)).toEqual(['loading', 'error']);
  });
});
