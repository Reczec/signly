import type { SequenceFrame } from './sequence';
import { encodeSequence } from './sequence';
import type { WordPrediction, WordRecognitionModel } from './wordModel';

export type WordCaptureRejection = 'too_short' | 'observation_gap' | 'landmark_quality' | 'confidence';

export interface WordCaptureDecision {
  phase: 'idle' | 'capturing' | 'analyzing' | 'release_required';
  prediction?: WordPrediction;
  rejected?: boolean;
  confidence?: number;
  reason?: WordCaptureRejection;
}

export interface WordCaptureOptions {
  minFrames?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  releaseMs?: number;
  maxObservationGapMs?: number;
  endGapMs?: number;
  minHandFrameFraction?: number;
  minPoseFrameFraction?: number;
}

const DEFAULTS = {
  minFrames: 6,
  minDurationMs: 600,
  maxDurationMs: 1800,
  releaseMs: 600,
  maxObservationGapMs: 250,
  endGapMs: 250,
  minHandFrameFraction: 0.35,
  minPoseFrameFraction: 0.2,
};

export class WordCaptureBuffer {
  private frames: SequenceFrame[] = [];
  private awaitingRelease = false;
  private releaseStartedAt: number | null = null;
  private lastAt: number | null = null;
  private lastHandAt: number | null = null;
  private generation = 0;
  private pending = false;
  private readonly options: Required<WordCaptureOptions>;

  get analyzing(): boolean { return this.pending; }

  constructor(
    private readonly model: WordRecognitionModel,
    options: WordCaptureOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  reset(requireRelease = false): void {
    this.generation++;
    this.frames = [];
    this.awaitingRelease = requireRelease;
    this.releaseStartedAt = null;
    this.lastAt = null;
    this.lastHandAt = null;
    this.pending = false;
  }

  async update(frame: SequenceFrame): Promise<WordCaptureDecision> {
    if (!Number.isFinite(frame.timestampMs) || (this.lastAt !== null && frame.timestampMs <= this.lastAt)) {
      throw new Error('Capture timestamps must increase.');
    }
    const gap = this.lastAt === null ? 0 : frame.timestampMs - this.lastAt;
    this.lastAt = frame.timestampMs;
    if (this.pending) return { phase: 'analyzing' };
    if (gap > this.options.maxObservationGapMs) {
      this.releaseStartedAt = null;
      if (this.frames.length) {
        this.frames = [];
        this.awaitingRelease = true;
        return { phase: 'release_required', rejected: true, reason: 'observation_gap' };
      }
    }
    const hasHand = frame.hands.length > 0;
    if (this.awaitingRelease) {
      if (hasHand) {
        this.releaseStartedAt = null;
        return { phase: 'release_required' };
      }
      this.releaseStartedAt ??= frame.timestampMs;
      if (frame.timestampMs - this.releaseStartedAt >= this.options.releaseMs) {
        this.awaitingRelease = false;
        this.releaseStartedAt = null;
        this.frames = [];
        return { phase: 'idle' };
      }
      return { phase: 'release_required' };
    }

    if (!hasHand && !this.frames.length) return { phase: 'idle' };
    if (hasHand) this.lastHandAt = frame.timestampMs;

    this.frames.push(frame);
    const duration = frame.timestampMs - this.frames[0]!.timestampMs;
    // Keep short occlusions as masked observations. Finish a complete sign on
    // hand withdrawal, or at the bounded capture deadline, not at minimum age.
    const ended = !hasHand && this.lastHandAt !== null && frame.timestampMs - this.lastHandAt >= this.options.endGapMs;
    const ready = ended || duration >= this.options.maxDurationMs;
    if (!ready) return { phase: 'capturing' };

    const frames = ended ? this.frames.filter(f => f.timestampMs <= this.lastHandAt!) : this.frames;
    this.frames = [];
    this.awaitingRelease = true;
    this.releaseStartedAt = null;
    if (frames.length < this.options.minFrames || frames.at(-1)!.timestampMs - frames[0]!.timestampMs < this.options.minDurationMs) {
      return { phase: 'release_required', rejected: true, confidence: 0, reason: 'too_short' };
    }
    const encoded = encodeSequence(frames);
    if (
      encoded.quality.handFrameFraction < this.options.minHandFrameFraction ||
      encoded.quality.poseFrameFraction < this.options.minPoseFrameFraction
    ) {
      return { phase: 'release_required', rejected: true, confidence: 0, reason: 'landmark_quality' };
    }
    const generation = this.generation;
    this.pending = true;
    try {
      const prediction = await this.model.predict(encoded.tensor);
      if (generation !== this.generation) return { phase: 'idle' };
      return { phase: 'release_required', prediction, rejected: !prediction.accepted,
        confidence: prediction.confidence, reason: prediction.accepted ? undefined : 'confidence' };
    } catch (cause) {
      if (generation !== this.generation) return { phase: 'idle' };
      throw cause;
    } finally {
      if (generation === this.generation) this.pending = false;
    }
  }
}
