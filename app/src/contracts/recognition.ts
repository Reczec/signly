/** Shared v1 boundary between the local recognition engine and the UI. */
export type RecognitionState =
  | 'camera_off'
  | 'loading'
  | 'ready'
  | 'no_hand'
  | 'recognizing'
  | 'low_confidence'
  | 'accepted'
  | 'release_required'
  | 'paused'
  | 'error';

export interface RecognitionResult {
  schemaVersion: 1;
  /** A new ID for every start, including unsuccessful starts. */
  sessionId: string;
  /** Increases on every event in this session. Deduplicate by sessionId + sequence. */
  sequence: number;
  sign: string | null;
  /** Model score in [0, 1]; softmax for words, neighbor vote for legacy. Not measured accuracy. */
  confidence: number;
  /** True only for the single accepted event; never a persistent status. */
  stable: boolean;
  accepted: boolean;
  /** Unix milliseconds. Internal inference timing uses performance.now(). */
  timestamp: number;
  state: RecognitionState;
  handsDetected: number;
  /** Inference/classification duration, excluding the intentional stability hold. */
  latencyMs: number;
  /** Human-readable text only for the error state; otherwise null. */
  error: string | null;
}

/** Original, unmirrored camera coordinates; mirror the display with CSS only. */
export interface LandmarkFrame {
  width: number;
  height: number;
  hands: {
    handedness: 'Left' | 'Right';
    landmarks: { x: number; y: number; z: number }[];
  }[];
  pose?: { x: number; y: number; z: number; visibility?: number; presence?: number }[];
}

export interface RecognitionEngine {
  /** Owns camera acquisition, model loading, inference, timing, and cleanup. */
  start(
    video: HTMLVideoElement,
    onResult: (result: RecognitionResult) => void,
    onLandmarks?: (frame: LandmarkFrame) => void,
  ): Promise<void>;
  /** Keeps the preview but stops classification and clears pending stability. */
  pause(): void;
  /** Clears history and requires a new continuous hand-away release interval. */
  resume(): void;
  /** Cancels pending initialization and releases all camera/model/timer resources. */
  stop(): void;
  /** Empty before model loading; afterwards only enabled model labels, never UNKNOWN. */
  getSupportedSigns(): readonly string[];
}
