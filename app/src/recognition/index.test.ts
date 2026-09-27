import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LandmarkFrame, RecognitionResult } from '../contracts/recognition';
import type { SignClassifier } from './classifier';
import { createRecognitionEngine, type RecognitionEngineOptions } from './index';
import {
  MODEL_DOWNLOAD_URL,
  MODEL_REPOSITORY_PATH,
  type HandLandmarkDetection,
} from './landmarker';
import type { WordRecognitionModel } from './wordModel';

const HAND: { x: number; y: number; z: number }[] = Array.from({ length: 21 }, (_, index) => ({
  x: index / 21,
  y: 0.25 + index / 84,
  z: -index / 100,
}));
const POSE: { x: number; y: number; z: number; visibility: number; presence: number }[] = Array.from(
  { length: 33 },
  (_, index) => ({
    x: index === 11 ? 0.35 : index === 12 ? 0.65 : 0.5,
    y: 0.4,
    z: 0,
    visibility: 1,
    presence: 1,
  }),
);

function detection(hands: number): HandLandmarkDetection {
  return {
    landmarks: Array.from({ length: hands }, () => HAND),
    handedness: Array.from({ length: hands }, () => [{ categoryName: 'Right' }]),
  };
}

function wordDetection(hands: number): HandLandmarkDetection {
  return { ...detection(hands), poseLandmarks: POSE };
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
    loadWordModel: async () => null,
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

describe('live temporal word model integration', () => {
  it.each(['resolve', 'reject'] as const)('ignores a stale %s after pause/resume', async (outcome) => {
    let resolve!: (value: Awaited<ReturnType<WordRecognitionModel['predict']>>) => void;
    let reject!: (cause: unknown) => void;
    const wordModel = wordModelStub(true);
    vi.mocked(wordModel.predict).mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const h = createHarness({ loadWordModel: async () => wordModel });
    h.detector.detectForVideo = vi.fn(() => wordDetection(1));
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, e => events.push(e));
    await pumpAsync(h, 25);
    h.engine.pause(); h.engine.resume();
    const before = events.length;
    if (outcome === 'resolve') resolve({ label: 'thank you', confidence: 1, margin: 1, accepted: true });
    else reject(new Error('old inference failed'));
    await new Promise(r => setTimeout(r, 0));
    expect(events).toHaveLength(before);
    await pumpAsync(h, 20);
    expect(wordModel.predict).toHaveBeenCalledTimes(1);
    expect(events.at(-1)?.state).toBe('release_required');
    expect(h.track.stopped).toBe(false);
  });

  it('still stops the camera if native detector cleanup throws', async () => {
    const h = createHarness();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.detector.close.mockImplementation(() => { throw new Error('native close failed'); });
    await h.engine.start(h.video.element, () => {});
    expect(() => h.engine.stop()).not.toThrow();
    expect(h.track.stopped).toBe(true);
    expect(h.video.raw.srcObject).toBeNull();
    expect(h.video.pendingCount()).toBe(0);
    warning.mockRestore();
  });

  it('ignores a rejected inference after stop and a new session start', async () => {
    let reject!: (cause: unknown) => void;
    const wordModel = wordModelStub(true);
    vi.mocked(wordModel.predict).mockImplementation(() => new Promise((_yes, no) => { reject = no; }));
    const h = createHarness({ loadWordModel: async () => wordModel });
    h.detector.detectForVideo = vi.fn(() => wordDetection(1));
    const old: RecognitionResult[] = [], fresh: RecognitionResult[] = [];
    await h.engine.start(h.video.element, e => old.push(e));
    await pumpAsync(h, 25);
    h.engine.stop();
    await h.engine.start(h.video.element, e => fresh.push(e));
    reject(new Error('stopped inference failed'));
    await new Promise(r => setTimeout(r, 0));
    expect(old.at(-1)?.state).toBe('camera_off');
    expect(fresh.at(-1)?.state).toBe('ready');
    expect(h.video.pendingCount()).toBe(1);
  });

  it('loads the word model, buffers a sequence and accepts one word', async () => {
    const wordModel = wordModelStub(true);
    const h = createHarness({ loadWordModel: async () => wordModel });
    h.detector.detectForVideo = vi.fn((_video, _timestampMs) => wordDetection(1));
    const events: RecognitionResult[] = [];

    await h.engine.start(h.video.element, (event) => events.push(event));

    expect(h.engine.getSupportedSigns()).toEqual(['drink', 'thank you']);
    await pumpAsync(h, 25);

    expect(wordModel.predict).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.state === 'accepted')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      state: 'accepted',
      sign: 'thank you',
      accepted: true,
      stable: true,
      handsDetected: 1,
    });
  });

  it('rejects a buffered word prediction when confidence policy fails', async () => {
    const wordModel = wordModelStub(false);
    const onCaptureRejection = vi.fn();
    const h = createHarness({ loadWordModel: async () => wordModel, onCaptureRejection });
    h.detector.detectForVideo = vi.fn((_video, _timestampMs) => wordDetection(1));
    const events: RecognitionResult[] = [];

    await h.engine.start(h.video.element, (event) => events.push(event));
    await pumpAsync(h, 25);

    expect(wordModel.predict).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.state === 'accepted')).toBe(false);
    expect(onCaptureRejection).toHaveBeenCalledWith('confidence');
    expect(events.at(-1)).toMatchObject({
      state: 'low_confidence',
      sign: null,
      accepted: false,
      stable: false,
      handsDetected: 1,
    });
  });

  it('requires hand release before repeated word predictions', async () => {
    const wordModel = wordModelStub(true);
    const h = createHarness({ loadWordModel: async () => wordModel });
    h.detector.detectForVideo = vi.fn((_video, _timestampMs) => wordDetection(1));
    const events: RecognitionResult[] = [];

    await h.engine.start(h.video.element, (event) => events.push(event));
    await pumpAsync(h, 25);
    await pumpAsync(h, 3);
    expect(wordModel.predict).toHaveBeenCalledTimes(1);
    expect(events.at(-1)!.state).toBe('release_required');

    h.detector.detectForVideo = vi.fn((_video, _timestampMs) => wordDetection(0));
    await pumpAsync(h, 7);
    h.detector.detectForVideo = vi.fn((_video, _timestampMs) => wordDetection(1));
    await pumpAsync(h, 25);

    expect(wordModel.predict).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.state === 'accepted')).toHaveLength(2);
  });

  it('fails startup without falling back to legacy recognition when the word model cannot load', async () => {
    const h = createHarness({
      loadWordModel: async () => {
        throw new Error('Word ONNX model could not be initialized');
      },
      loadClassifier: async () => classifierStub(),
    });
    const events: RecognitionResult[] = [];

    await expect(h.engine.start(h.video.element, (event) => events.push(event))).rejects.toThrow(
      'Word ONNX model could not be initialized',
    );

    expect(events.map((event) => event.state)).toEqual(['loading', 'error']);
    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(h.engine.getSupportedSigns()).toEqual([]);
  });

  it('cleans up word capture lifecycle on stop', async () => {
    const wordModel = wordModelStub(true);
    const h = createHarness({ loadWordModel: async () => wordModel });
    h.detector.detectForVideo = vi.fn((_video, _timestampMs) => wordDetection(1));
    const events: RecognitionResult[] = [];

    await h.engine.start(h.video.element, (event) => events.push(event));
    await pumpAsync(h, 5);
    h.engine.stop();
    h.advance(120);
    h.video.flush();

    expect(events.at(-1)!.state).toBe('camera_off');
    expect(wordModel.predict).not.toHaveBeenCalled();
    expect(h.detector.close).toHaveBeenCalledTimes(1);
    expect(h.track.stopped).toBe(true);
  });
});

function classifierStub(overrides: Partial<SignClassifier> = {}): SignClassifier {
  return {
    labels: Object.freeze(['A', 'B', 'C']),
    enabledLabels: Object.freeze(['A', 'B', 'C']),
    classify: () => ({ label: 'A', confidence: 6 / 7, accepted: true }),
    ...overrides,
  };
}

function pump(h: ReturnType<typeof createHarness>, frames: number): void {
  for (let index = 0; index < frames; index++) {
    h.advance(110);
    h.video.flush();
  }
}

async function pumpAsync(h: ReturnType<typeof createHarness>, frames: number): Promise<void> {
  for (let index = 0; index < frames; index++) {
    h.advance(110);
    h.video.flush();
    await Promise.resolve();
  }
}

function wordModelStub(accepted: boolean): WordRecognitionModel {
  return {
    labels: Object.freeze(['drink', 'thank you']),
    predict: vi.fn(async () => ({
      label: 'thank you',
      confidence: accepted ? 0.84 : 0.48,
      margin: accepted ? 0.25 : 0.03,
      accepted,
    })),
  };
}

describe('live kNN classifier integration', () => {
  it('loads the classifier, publishes enabled signs and accepts one pulse per hold', async () => {
    const h = createHarness({ loadClassifier: async () => classifierStub() });
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));

    expect(h.engine.getSupportedSigns()).toEqual(['A', 'B', 'C']);
    expect(Object.isFrozen(h.engine.getSupportedSigns())).toBe(true);

    pump(h, 7);
    const recognizing = events.filter((event) => event.state === 'recognizing');
    expect(recognizing).toHaveLength(6);
    for (const event of recognizing) {
      expect(event.sign).toBe('A');
      expect(event.confidence).toBeCloseTo(6 / 7, 10);
      expect(event.stable).toBe(false);
      expect(event.accepted).toBe(false);
    }
    const firstAccepts = events.filter((event) => event.state === 'accepted');
    expect(firstAccepts).toHaveLength(1);
    expect(firstAccepts[0]).toMatchObject({
      sign: 'A',
      stable: true,
      accepted: true,
      handsDetected: 1,
    });
    expect(firstAccepts[0].confidence).toBeCloseTo(6 / 7, 10);
    expect(firstAccepts[0].latencyMs).toBeGreaterThanOrEqual(0);

    pump(h, 3);
    const releasing = events.filter((event) => event.state === 'release_required');
    expect(releasing).toHaveLength(3);
    for (const event of releasing) {
      expect(event.sign).toBeNull();
      expect(event.confidence).toBe(0);
      expect(event.stable).toBe(false);
      expect(event.accepted).toBe(false);
    }

    h.setDetection(0);
    pump(h, 14);
    expect(events.some((event) => event.state === 'no_hand')).toBe(true);

    h.setDetection(1);
    pump(h, 7);
    const accepted = events.filter((event) => event.state === 'accepted');
    expect(accepted).toHaveLength(2);
    for (const event of events) {
      if (event.state === 'accepted') continue;
      expect(event.stable).toBe(false);
      expect(event.accepted).toBe(false);
    }
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_event, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.sessionId)).size).toBe(1);
  });

  it('returns low_confidence with a null sign when two hands are detected', async () => {
    const h = createHarness({ loadClassifier: async () => classifierStub() });
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));

    pump(h, 1);
    expect(events.at(-1)).toMatchObject({ state: 'recognizing', sign: 'A', handsDetected: 1 });

    h.setDetection(2);
    pump(h, 2);
    const last = events.at(-1)!;
    expect(last).toMatchObject({
      state: 'low_confidence',
      sign: null,
      confidence: 0,
      handsDetected: 2,
      stable: false,
      accepted: false,
    });
  });

  it('keeps landmark-only events when the classifier model file is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    const h = createHarness();
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));

    expect(h.engine.getSupportedSigns()).toEqual([]);
    pump(h, 2);
    const last = events.at(-1)!;
    expect(last).toMatchObject({
      state: 'recognizing',
      sign: null,
      confidence: 0,
      handsDetected: 1,
    });
    expect(events.some((event) => event.state === 'accepted')).toBe(false);
    expect(events.some((event) => event.state === 'low_confidence')).toBe(false);
  });

  it('never accepts a candidate that is not an enabled letter', async () => {
    const h = createHarness({
      loadClassifier: async () => classifierStub({ enabledLabels: Object.freeze([]) }),
    });
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));

    expect(h.engine.getSupportedSigns()).toEqual([]);
    pump(h, 10);
    expect(events.some((event) => event.state === 'accepted')).toBe(false);
    expect(events.some((event) => event.state === 'recognizing')).toBe(false);
    expect(events.at(-1)).toMatchObject({
      state: 'low_confidence',
      sign: null,
      confidence: 0,
      handsDetected: 1,
    });
  });

  it('stays low_confidence while the model rejects the classification', async () => {
    const h = createHarness({
      loadClassifier: async () =>
        classifierStub({ classify: () => ({ label: 'A', confidence: 0.4, accepted: false }) }),
    });
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));

    expect(h.engine.getSupportedSigns()).toEqual(['A', 'B', 'C']);
    pump(h, 10);
    expect(events.some((event) => event.state === 'accepted')).toBe(false);
    expect(events.some((event) => event.state === 'recognizing')).toBe(false);
    for (const event of events) {
      if (event.state !== 'low_confidence') continue;
      expect(event.sign).toBeNull();
      expect(event.confidence).toBe(0);
    }
  });

  it('requires a fresh release after resume and clears signs on stop', async () => {
    const h = createHarness({ loadClassifier: async () => classifierStub() });
    const events: RecognitionResult[] = [];
    await h.engine.start(h.video.element, (event) => events.push(event));

    pump(h, 1);
    expect(events.at(-1)!.state).toBe('recognizing');

    h.engine.pause();
    expect(events.at(-1)!.state).toBe('paused');
    h.engine.resume();
    expect(events.at(-1)!.state).toBe('ready');

    pump(h, 2);
    expect(events.at(-1)).toMatchObject({
      state: 'release_required',
      sign: null,
      confidence: 0,
    });

    h.setDetection(0);
    pump(h, 14);
    expect(events.at(-1)!.state).toBe('no_hand');

    h.setDetection(1);
    pump(h, 7);
    expect(events.filter((event) => event.state === 'accepted')).toHaveLength(1);

    h.engine.stop();
    expect(events.at(-1)!.state).toBe('camera_off');
    expect(h.engine.getSupportedSigns()).toEqual([]);
  });
});
