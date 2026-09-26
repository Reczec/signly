import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LandmarkFrame, RecognitionResult } from '../contracts/recognition';
import { createRecognitionEngine, type RecognitionEngineOptions } from './index';
import {
  MODEL_DOWNLOAD_URL,
  MODEL_REPOSITORY_PATH,
  type HandLandmarkDetection,
} from './landmarker';

const HAND: { x: number; y: number; z: number }[] = Array.from({ length: 21 }, (_, index) => ({
  x: index / 21,
  y: 0.25 + index / 84,
  z: -index / 100,
}));

function detection(hands: number): HandLandmarkDetection {
  return {
    landmarks: Array.from({ length: hands }, () => HAND),
    handedness: Array.from({ length: hands }, () => [{ categoryName: 'Right' }]),
  };
}

function createFakeVideo() {
  let callbacks: { handle: number; run: () => void }[] = [];
  let nextHandle = 1;
  const raw = {
    srcObject: null as MediaStream | null,
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    currentTime: 0,
    parentElement: null as HTMLElement | null,
    play: vi.fn(async () => {}),
    requestVideoFrameCallback(run: () => void) {
      const handle = nextHandle++;
      callbacks.push({ handle, run });
      return handle;
    },
    cancelVideoFrameCallback(handle: number) {
      callbacks = callbacks.filter((entry) => entry.handle !== handle);
    },
  };
  return {
    raw,
    element: raw as unknown as HTMLVideoElement,
    flush() {
      const pending = callbacks;
      callbacks = [];
      for (const entry of pending) entry.run();
    },
    pendingCount: () => callbacks.length,
  };
}

function createHarness(overrides: RecognitionEngineOptions = {}) {
  const track = {
    stopped: false,
    onended: null as (() => void) | null,
    stop: () => {
      track.stopped = true;
    },
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream);
  const checkModel = vi.fn(async () => {});
  const detector = {
    detectForVideo: vi.fn((_video: HTMLVideoElement, _timestampMs: number) => detection(1)),
    close: vi.fn(),
  };
  const loadLandmarker = vi.fn(async () => detector);
  const clock = { value: 0 };
  const video = createFakeVideo();
  const engine = createRecognitionEngine({
    checkModel,
    loadLandmarker,
    getUserMedia,
    now: () => clock.value,
    ...overrides,
  });

  return {
    engine,
    video,
    stream,
    track,
    clock,
    getUserMedia,
    checkModel,
    loadLandmarker,
    detector,
    setDetection(hands: number) {
      detector.detectForVideo = vi.fn(
        (_video: HTMLVideoElement, _timestampMs: number) => detection(hands),
      );
    },
    advance(ms: number) {
      clock.value += ms;
      video.raw.currentTime += ms / 1000;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webcam hand landmark engine', () => {
  it('acquires the camera, loads local assets and reports ready', async () => {
    const h = createHarness();
    const events: RecognitionResult[] = [];

    const started = h.engine.start(h.video.element, (event) => events.push(event));
    expect(events.map((event) => event.state)).toEqual(['loading']);
    await started;

    expect(events.map((event) => event.state)).toEqual(['loading', 'ready']);
    expect(h.checkModel.mock.invocationCallOrder[0]).toBeLessThan(
      h.getUserMedia.mock.invocationCallOrder[0],
    );
    expect(h.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    expect(h.video.raw.srcObject).toBe(h.stream);
    expect(h.video.raw.play).toHaveBeenCalledTimes(1);
    expect(h.loadLandmarker).toHaveBeenCalledTimes(1);
    expect(h.track.stopped).toBe(false);
    expect(h.video.pendingCount()).toBe(1);
    expect(h.engine.getSupportedSigns()).toEqual([]);
    expect(Object.isFrozen(h.engine.getSupportedSigns())).toBe(true);
    for (const event of events) {
      expect(event).toMatchObject({
        schemaVersion: 1,
        sign: null,
        confidence: 0,
        stable: false,
        accepted: false,
        handsDetected: 0,
        latencyMs: 0,
        error: null,
      });
      expect(event.timestamp).toBeGreaterThan(0);
    }
  });

  it('exposes 21 landmarks of a single detected hand through the contract', async () => {
    const h = createHarness();
    const events: RecognitionResult[] = [];
    const frames: LandmarkFrame[] = [];
    await h.engine.start(
      h.video.element,
      (event) => events.push(event),
      (frame) => frames.push(frame),
    );

    h.advance(120);
    h.video.flush();

    expect(h.detector.detectForVideo).toHaveBeenCalledTimes(1);
    expect(h.detector.detectForVideo).toHaveBeenCalledWith(h.video.element, 120);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      width: 640,
      height: 480,
      hands: [{ handedness: 'Right', landmarks: HAND }],
    });
    const last = events.at(-1)!;
    expect(last).toMatchObject({
      state: 'recognizing',
      handsDetected: 1,
      sign: null,
      confidence: 0,
      stable: false,
      accepted: false,
      error: null,
      sequence: 3,
      sessionId: events[0].sessionId,
    });
    expect(last.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports no hand and publishes an empty landmark frame', async () => {
    const h = createHarness();
    const events: RecognitionResult[] = [];
    const frames: LandmarkFrame[] = [];
    await h.engine.start(
      h.video.element,
      (event) => events.push(event),
      (frame) => frames.push(frame),
    );

    h.setDetection(0);
    h.advance(120);
    h.video.flush();

    expect(frames.at(-1)).toEqual({ width: 640, height: 480, hands: [] });
    expect(events.at(-1)).toMatchObject({ state: 'no_hand', handsDetected: 0, sign: null });
  });

  it('caps inference at ten per second and skips duplicate video frames', async () => {
    const h = createHarness();
    await h.engine.start(h.video.element, () => {});

    h.video.raw.currentTime = 0.03;
    h.video.flush();
    expect(h.detector.detectForVideo).toHaveBeenCalledTimes(1);

    h.video.raw.currentTime = 0.06;
    h.video.flush();
    expect(h.detector.detectForVideo).toHaveBeenCalledTimes(1);

    h.clock.value += 100;
    h.video.flush();
    expect(h.detector.detectForVideo).toHaveBeenCalledTimes(2);

    h.video.flush();
    expect(h.detector.detectForVideo).toHaveBeenCalledTimes(2);
  });

  it('fails with an actionable message before touching the camera when the model is missing', async () => {
    const getUserMedia = vi.fn(async () => {
      throw new Error('camera must not be requested');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    const engine = createRecognitionEngine({ getUserMedia });
    const video = createFakeVideo();
    const events: RecognitionResult[] = [];

    await expect(engine.start(video.element, (event) => events.push(event))).rejects.toThrow(
      MODEL_REPOSITORY_PATH,
    );

    expect(events.map((event) => event.state)).toEqual(['loading', 'error']);
    expect(events[1].error).toContain(MODEL_REPOSITORY_PATH);
    expect(events[1].error).toContain(MODEL_DOWNLOAD_URL);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(video.raw.srcObject).toBeNull();

    engine.stop();
    expect(events.map((event) => event.state)).toEqual(['loading', 'error', 'camera_off']);
  });

  it('releases the camera when the landmarker cannot be created', async () => {
    const h = createHarness({
      loadLandmarker: vi.fn(async () => {
        throw new Error('Hand Landmarker could not be initialized');
      }),
    });
    const events: RecognitionResult[] = [];

    await expect(h.engine.start(h.video.element, (event) => events.push(event))).rejects.toThrow(
      'Hand Landmarker could not be initialized',
    );

    expect(events.map((event) => event.state)).toEqual(['loading', 'error']);
    expect(h.track.stopped).toBe(true);
    expect(h.video.raw.srcObject).toBeNull();
    expect(h.video.pendingCount()).toBe(0);

    h.engine.stop();
    expect(events.map((event) => event.state)).toEqual(['loading', 'error', 'camera_off']);
  });

  it('maps a denied camera permission to an actionable error', async () => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const h = createHarness({ getUserMedia });
    const events: RecognitionResult[] = [];

    await expect(h.engine.start(h.video.element, (event) => events.push(event))).rejects.toThrow(
      /Camera permission denied/,
    );

    expect(events.map((event) => event.state)).toEqual(['loading', 'error']);
    expect(events[1].error).toContain('Camera permission denied');
    expect(h.loadLandmarker).not.toHaveBeenCalled();
  });

  it('cancels initialization on stop without a stale error', async () => {
    let releaseModelCheck!: () => void;
    const h = createHarness({
      checkModel: () =>
        new Promise<void>((resolve) => {
          releaseModelCheck = resolve;
        }),
    });
    const events: RecognitionResult[] = [];

    const started = h.engine.start(h.video.element, (event) => events.push(event));
    expect(events.map((event) => event.state)).toEqual(['loading']);
    h.engine.stop();
    h.engine.stop();
    releaseModelCheck();

    await expect(started).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.map((event) => event.state)).toEqual(['loading', 'camera_off']);
    expect(events.every((event) => event.error === null)).toBe(true);
    expect(h.getUserMedia).not.toHaveBeenCalled();
  });

  it('replaces a pending start without stale events from the first session', async () => {
    const modelChecks: (() => void)[] = [];
    const h = createHarness({
      checkModel: () =>
        new Promise<void>((resolve) => {
          modelChecks.push(resolve);
        }),
    });
    const first: RecognitionResult[] = [];
    const second: RecognitionResult[] = [];

    const firstStart = h.engine.start(h.video.element, (event) => first.push(event));
    const firstCancelled = expect(firstStart).rejects.toMatchObject({ name: 'AbortError' });
    const secondStart = h.engine.start(h.video.element, (event) => second.push(event));

    modelChecks[1]();
    await secondStart;
    modelChecks[0]();
    await firstCancelled;

    expect(first.map((event) => event.state)).toEqual(['loading', 'camera_off']);
    expect(second.map((event) => event.state)).toEqual(['loading', 'ready']);
    expect(first[0].sessionId).not.toBe(second[0].sessionId);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.video.raw.srcObject).toBe(h.stream);
    expect(h.video.pendingCount()).toBe(1);
  });

  it('pauses classification and resumes the inference loop', async () => {
    const h = createHarness();
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));

    h.engine.pause();
    expect(events.at(-1)!.state).toBe('paused');
    const pausedCount = events.length;
    h.advance(150);
    h.video.flush();
    expect(events).toHaveLength(pausedCount);
    expect(h.detector.detectForVideo).not.toHaveBeenCalled();

    h.engine.resume();
    expect(events.at(-1)!.state).toBe('ready');
    h.advance(150);
    h.video.flush();
    expect(h.detector.detectForVideo).toHaveBeenCalledTimes(1);
    expect(events.at(-1)!.state).toBe('recognizing');
  });

  it('releases camera, model and timers on stop and stays idempotent', async () => {
    const h = createHarness();
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));
    h.advance(120);
    h.video.flush();
    expect(h.detector.detectForVideo).toHaveBeenCalledTimes(1);

    h.engine.stop();
    expect(events.at(-1)!.state).toBe('camera_off');
    expect(h.track.stopped).toBe(true);
    expect(h.detector.close).toHaveBeenCalledTimes(1);
    expect(h.video.raw.srcObject).toBeNull();
    expect(h.video.pendingCount()).toBe(0);

    h.advance(120);
    h.video.flush();
    expect(h.detector.detectForVideo).toHaveBeenCalledTimes(1);

    h.engine.stop();
    expect(events.filter((event) => event.state === 'camera_off')).toHaveLength(1);
  });

  it('emits an error and releases the camera when the stream ends', async () => {
    const h = createHarness();
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));

    expect(h.track.onended).not.toBeNull();
    h.track.onended!();

    expect(events.at(-1)!.state).toBe('error');
    expect(events.at(-1)!.error).toContain('camera stream');
    expect(h.track.stopped).toBe(true);
    expect(h.video.pendingCount()).toBe(0);

    h.engine.stop();
    expect(events.at(-1)!.state).toBe('camera_off');
  });

  it('supports repeated start/stop cycles with a new session each time', async () => {
    const h = createHarness();
    const events: RecognitionResult[] = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      await h.engine.start(h.video.element, (event) => events.push(event));
      h.engine.stop();
    }

    expect(new Set(events.map((event) => event.sessionId)).size).toBe(3);
    expect(events.map((event) => event.state)).toEqual([
      'loading', 'ready', 'camera_off',
      'loading', 'ready', 'camera_off',
      'loading', 'ready', 'camera_off',
    ]);
  });

  it('never claims a classification before a classifier exists', async () => {
    const h = createHarness();
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));
    h.advance(120);
    h.video.flush();
    h.engine.pause();
    h.engine.resume();
    h.advance(120);
    h.video.flush();
    h.engine.stop();

    expect(events.length).toBeGreaterThan(4);
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_event, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.sessionId)).size).toBe(1);
    for (const event of events) {
      expect(event.schemaVersion).toBe(1);
      expect(event.sign).toBeNull();
      expect(event.confidence).toBe(0);
      expect(event.stable).toBe(false);
      expect(event.accepted).toBe(false);
      expect(event.latencyMs).toBeGreaterThanOrEqual(0);
      if (event.state === 'error') {
        expect(event.error).toBeTruthy();
      } else {
        expect(event.error).toBeNull();
      }
    }
    expect(h.engine.getSupportedSigns()).toEqual([]);
  });
});
