import type {
  LandmarkFrame,
  RecognitionEngine,
  RecognitionResult,
  RecognitionState,
} from '../contracts/recognition';
import {
  createHandLandmarker,
  ensureHandLandmarkerModel,
  type HandLandmarkDetection,
  type HandLandmarkDetector,
} from './landmarker';
import { createLandmarkOverlay, type LandmarkOverlay } from './overlay';

const SUPPORTED_SIGNS: readonly string[] = Object.freeze([]);
const MIN_INFERENCE_INTERVAL_MS = 100;
const FRAME_FALLBACK_INTERVAL_MS = 33;
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { width: 640, height: 480, facingMode: 'user' },
};

let nextSession = 0;

interface FrameRequest {
  kind: 'video' | 'animation' | 'timeout';
  handle: number;
}

interface EmitFields {
  sign?: string | null;
  confidence?: number;
  handsDetected?: number;
  latencyMs?: number;
  error?: string | null;
}

interface Session {
  id: string;
  sequence: number;
  onResult: (result: RecognitionResult) => void;
  onLandmarks?: (frame: LandmarkFrame) => void;
  video: HTMLVideoElement;
  stream: MediaStream | null;
  detector: HandLandmarkDetector | null;
  overlay: LandmarkOverlay | null;
  running: boolean;
  paused: boolean;
  frameRequest: FrameRequest | null;
  lastVideoTime: number;
  lastInferenceAt: number;
}

type FrameCallbackVideo = {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface RecognitionEngineOptions {
  checkModel?: () => Promise<void>;
  loadLandmarker?: () => Promise<HandLandmarkDetector>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  now?: () => number;
  overlay?: boolean;
}

function errorMessage(cause: unknown): string {
  const message = (cause as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.length > 0) return message;
  return String(cause);
}

function createAbortError(): DOMException {
  return new DOMException('Recognition initialization was stopped or replaced.', 'AbortError');
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function normalizeHandedness(categoryName: string | undefined): 'Left' | 'Right' {
  return categoryName === 'Left' ? 'Left' : 'Right';
}

function toLandmarkFrame(
  video: HTMLVideoElement,
  detection: HandLandmarkDetection,
): LandmarkFrame {
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
  };
}

function cameraErrorMessage(cause: unknown): string {
  const name = (cause as { name?: unknown } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera permission denied. Allow camera access for this site and start again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is unavailable, possibly in use by another application.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'The camera does not support the requested 640x480 input.';
    default:
      return `Camera start failed: ${errorMessage(cause)}`;
  }
}

export function createRecognitionEngine(
  options: RecognitionEngineOptions = {},
): RecognitionEngine {
  const checkModel = options.checkModel ?? ensureHandLandmarkerModel;
  const loadLandmarker = options.loadLandmarker ?? createHandLandmarker;
  const requestCamera =
    options.getUserMedia ??
    ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
  const now = options.now ?? (() => performance.now());
  const overlayEnabled = options.overlay ?? true;
  let session: Session | undefined;

  function emit(current: Session, state: RecognitionState, fields: EmitFields = {}) {
    current.onResult({
      schemaVersion: 1,
      sessionId: current.id,
      sequence: ++current.sequence,
      sign: fields.sign ?? null,
      confidence: fields.confidence ?? 0,
      stable: false,
      accepted: false,
      timestamp: Date.now(),
      state,
      handsDetected: fields.handsDetected ?? 0,
      latencyMs: fields.latencyMs ?? 0,
      error: fields.error ?? null,
    });
  }

  function cancelFrame(current: Session) {
    const request = current.frameRequest;
    if (!request) return;
    current.frameRequest = null;
    const video = current.video as unknown as FrameCallbackVideo;
    if (request.kind === 'video' && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(request.handle);
    } else if (request.kind === 'animation' && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(request.handle);
    } else if (request.kind === 'timeout') {
      globalThis.clearTimeout(request.handle);
    }
  }

  function teardown(current: Session) {
    current.running = false;
    cancelFrame(current);
    if (current.overlay) {
      current.overlay.destroy();
      current.overlay = null;
    }
    if (current.detector) {
      current.detector.close();
      current.detector = null;
    }
    if (current.stream) {
      for (const track of current.stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      if (current.video.srcObject === current.stream) current.video.srcObject = null;
      current.stream = null;
    }
  }

  function fail(current: Session, message: string) {
    teardown(current);
    if (session === current) emit(current, 'error', { error: message });
  }

  function scheduleFrame(current: Session) {
    if (current.frameRequest || !current.running || current.paused) return;
    const video = current.video as unknown as FrameCallbackVideo;
    if (typeof video.requestVideoFrameCallback === 'function') {
      current.frameRequest = {
        kind: 'video',
        handle: video.requestVideoFrameCallback(() => onFrame(current)),
      };
      return;
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      current.frameRequest = {
        kind: 'animation',
        handle: globalThis.requestAnimationFrame(() => onFrame(current)),
      };
      return;
    }
    current.frameRequest = {
      kind: 'timeout',
      handle: globalThis.setTimeout(() => onFrame(current), FRAME_FALLBACK_INTERVAL_MS) as unknown as number,
    };
  }

  function runInference(current: Session, stamp: number) {
    const detector = current.detector;
    if (!detector) return;
    const startedAt = now();
    let detection: HandLandmarkDetection;
    try {
      detection = detector.detectForVideo(current.video, stamp);
    } catch (cause) {
      fail(current, `Hand Landmarker inference failed: ${errorMessage(cause)}`);
      return;
    }
    const latencyMs = Math.round(now() - startedAt);
    const frame = toLandmarkFrame(current.video, detection);
    current.overlay?.draw(frame);
    current.onLandmarks?.(frame);
    if (frame.hands.length === 0) {
      emit(current, 'no_hand', { latencyMs });
      return;
    }
    emit(current, 'recognizing', { handsDetected: frame.hands.length, latencyMs });
  }

  function onFrame(current: Session) {
    current.frameRequest = null;
    if (session !== current || !current.running || current.paused) return;
    scheduleFrame(current);
    const video = current.video;
    if (video.readyState < 2) return;
    const stamp = now();
    if (video.currentTime === current.lastVideoTime) return;
    if (stamp - current.lastInferenceAt < MIN_INFERENCE_INTERVAL_MS) return;
    current.lastVideoTime = video.currentTime;
    current.lastInferenceAt = stamp;
    runInference(current, stamp);
  }

  function stop() {
    const current = session;
    if (!current) return;
    session = undefined;
    teardown(current);
    emit(current, 'camera_off');
  }

  async function start(
    video: HTMLVideoElement,
    onResult: (result: RecognitionResult) => void,
    onLandmarks?: (frame: LandmarkFrame) => void,
  ): Promise<void> {
    stop();
    const current: Session = {
      id: `recognition-${Date.now()}-${++nextSession}`,
      sequence: 0,
      onResult,
      onLandmarks,
      video,
      stream: null,
      detector: null,
      overlay: null,
      running: false,
      paused: false,
      frameRequest: null,
      lastVideoTime: -1,
      lastInferenceAt: Number.NEGATIVE_INFINITY,
    };
    session = current;
    emit(current, 'loading');

    try {
      await checkModel();
      if (session !== current) throw createAbortError();

      let stream: MediaStream;
      try {
        stream = await requestCamera(CAMERA_CONSTRAINTS);
      } catch (cause) {
        throw new Error(cameraErrorMessage(cause));
      }
      if (session !== current) {
        stopTracks(stream);
        throw createAbortError();
      }
      current.stream = stream;
      video.srcObject = stream;
      for (const track of stream.getTracks()) {
        track.onended = () => {
          if (session === current && current.running) {
            fail(current, 'The camera stream ended unexpectedly.');
          }
        };
      }

      try {
        await video.play();
      } catch (cause) {
        throw new Error(`Camera preview failed to start: ${errorMessage(cause)}`);
      }
      if (session !== current) throw createAbortError();
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error('The camera stream contains no video frames.');
      }

      const detector = await loadLandmarker();
      if (session !== current) {
        detector.close();
        throw createAbortError();
      }
      current.detector = detector;

      current.overlay =
        overlayEnabled && video.parentElement ? createLandmarkOverlay(video) : null;
      current.running = true;
      current.lastVideoTime = -1;
      current.lastInferenceAt = Number.NEGATIVE_INFINITY;
      emit(current, 'ready');
      scheduleFrame(current);
    } catch (cause) {
      teardown(current);
      if (session !== current) throw createAbortError();
      const message = errorMessage(cause);
      emit(current, 'error', { error: message });
      throw new Error(message);
    }
  }

  function pause() {
    const current = session;
    if (!current || !current.running || current.paused) return;
    current.paused = true;
    cancelFrame(current);
    emit(current, 'paused');
  }

  function resume() {
    const current = session;
    if (!current || !current.running || !current.paused) return;
    current.paused = false;
    current.lastVideoTime = -1;
    current.lastInferenceAt = Number.NEGATIVE_INFINITY;
    emit(current, 'ready');
    scheduleFrame(current);
  }

  return {
    start,
    pause,
    resume,
    stop,
    getSupportedSigns: () => SUPPORTED_SIGNS,
  };
}
