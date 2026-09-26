import type { SequenceFrame } from './sequence';
import { encodeSequence } from './sequence';
import type { WordPrediction, WordRecognitionModel } from './wordModel';

export interface WordCaptureDecision {
  phase: 'idle' | 'capturing' | 'release_required';
  prediction?: WordPrediction;
  rejected?: boolean;
  confidence?: number;
}

export interface WordCaptureOptions {
  minFrames?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  releaseMs?: number;
  minHandFrameFraction?: number;
  minPoseFrameFraction?: number;
}

const DEFAULTS = {
  minFrames: 10,
  minDurationMs: 900,
  maxDurationMs: 1800,
  releaseMs: 600,
  minHandFrameFraction: 0.35,
  minPoseFrameFraction: 0.2,
};

export class WordCaptureBuffer {
  private frames: SequenceFrame[] = [];
  private awaitingRelease = false;
  private releaseStartedAt: number | null = null;
  private readonly options: Required<WordCaptureOptions>;

  constructor(
    private readonly model: WordRecognitionModel,
    options: WordCaptureOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  reset(): void {
    this.frames = [];
    this.awaitingRelease = false;
    this.releaseStartedAt = null;
  }

  async update(frame: SequenceFrame): Promise<WordCaptureDecision> {
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

    if (!hasHand) {
      this.frames = [];
      return { phase: 'idle' };
    }

    this.frames.push(frame);
    const duration = frame.timestampMs - this.frames[0]!.timestampMs;
    const ready =
      this.frames.length >= this.options.minFrames &&
      (duration >= this.options.minDurationMs || duration >= this.options.maxDurationMs);
    if (!ready) return { phase: 'capturing' };

    const encoded = encodeSequence(this.frames);
    this.frames = [];
    this.awaitingRelease = true;
    this.releaseStartedAt = null;
    if (
      encoded.quality.handFrameFraction < this.options.minHandFrameFraction ||
      encoded.quality.poseFrameFraction < this.options.minPoseFrameFraction
    ) {
      return { phase: 'release_required', rejected: true, confidence: 0 };
    }
    const prediction = await this.model.predict(encoded.tensor);
    return {
      phase: 'release_required',
      prediction,
      rejected: !prediction.accepted,
      confidence: prediction.confidence,
    };
  }
}
