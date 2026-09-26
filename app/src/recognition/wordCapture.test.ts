import { describe, expect, it, vi } from 'vitest';
import type { SequenceFrame } from './sequence';
import { WordCaptureBuffer } from './wordCapture';
import type { WordRecognitionModel } from './wordModel';

const HAND = Array.from({ length: 21 }, (_, index) => ({
  x: 0.4 + index * 0.002,
  y: 0.4 + index * 0.002,
  z: -index * 0.001,
}));

const POSE = Array.from({ length: 33 }, (_, index) => ({
  x: 0.5,
  y: 0.5,
  z: 0,
  visibility: 1,
  presence: 1,
  ...(index === 11 ? { x: 0.35, y: 0.4 } : {}),
  ...(index === 12 ? { x: 0.65, y: 0.4 } : {}),
}));

function frame(timestampMs: number, hands = 1, pose = POSE): SequenceFrame {
  return {
    timestampMs,
    width: 640,
    height: 480,
    hands: Array.from({ length: hands }, () => ({ handedness: 'Right' as const, landmarks: HAND })),
    pose,
  };
}

function model(accepted: boolean): WordRecognitionModel {
  return {
    labels: Object.freeze(['thank you']),
    predict: vi.fn(async () => ({
      label: 'thank you',
      confidence: accepted ? 0.82 : 0.42,
      margin: accepted ? 0.3 : 0.04,
      accepted,
    })),
  };
}

async function pump(buffer: WordCaptureBuffer, start = 0) {
  let decision = await buffer.update(frame(start));
  for (let index = 1; index < 10; index++) {
    decision = await buffer.update(frame(start + index * 100));
  }
  return decision;
}

describe('word capture buffering', () => {
  it('buffers an isolated sequence and returns an accepted word prediction', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);

    const decision = await pump(buffer);

    expect(wordModel.predict).toHaveBeenCalledTimes(1);
    expect(decision.prediction).toMatchObject({ label: 'thank you', accepted: true });
    expect(decision.rejected).toBe(false);
    expect(decision.phase).toBe('release_required');
  });

  it('returns rejected when the model confidence is below the acceptance policy', async () => {
    const wordModel = model(false);
    const buffer = new WordCaptureBuffer(wordModel);

    const decision = await pump(buffer);

    expect(decision.prediction).toMatchObject({ label: 'thank you', accepted: false });
    expect(decision.rejected).toBe(true);
    expect(decision.confidence).toBeCloseTo(0.42);
  });

  it('requires release before accepting repeated signs', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);

    await pump(buffer);
    expect(await buffer.update(frame(1000))).toMatchObject({ phase: 'release_required' });
    expect(wordModel.predict).toHaveBeenCalledTimes(1);

    await buffer.update(frame(1100, 0));
    await buffer.update(frame(1800, 0));
    await pump(buffer, 1900);

    expect(wordModel.predict).toHaveBeenCalledTimes(2);
  });

  it('rejects low-quality sequences before model inference and reset clears lifecycle state', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);
    for (let index = 0; index < 10; index++) {
      await buffer.update(frame(index * 100, 1, []));
    }
    expect(wordModel.predict).not.toHaveBeenCalled();

    buffer.reset();
    const decision = await pump(buffer, 2000);
    expect(decision.prediction?.accepted).toBe(true);
    expect(wordModel.predict).toHaveBeenCalledTimes(1);
  });
});
