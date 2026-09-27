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
  for (let index = 1; index < 27; index++) {
    decision = await buffer.update(frame(start + index * 100));
  }
  return decision;
}

describe('word capture buffering', () => {
  it('never accepts or substitutes a disabled sign and reports the reason', async () => {
    const wordModel = model(false);
    vi.mocked(wordModel.predict).mockResolvedValue({ label: null, confidence: .98, margin: .97,
      accepted: false, rejection: 'unsupported_sign' });
    const decision = await pump(new WordCaptureBuffer(wordModel));
    expect(decision).toMatchObject({ rejected: true, reason: 'unsupported_sign', prediction: { label: null, accepted: false } });
  });

  it('allows a complete 600ms sign while keeping release protection', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);
    for (let t = 0; t <= 600; t += 100) await buffer.update(frame(t));
    expect(wordModel.predict).not.toHaveBeenCalled();
    await buffer.update(frame(700, 0));
    await buffer.update(frame(800, 0));
    expect((await buffer.update(frame(900, 0))).prediction?.accepted).toBe(true);
    await pump(buffer, 1000);
    expect(wordModel.predict).toHaveBeenCalledTimes(1);
  });

  it.each([100, 150])('still rejects an incomplete or sparse short sequence (%ims interval)', async interval => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);
    // Five frames: either too short (400ms) or too few samples (600ms).
    for (let i = 0; i < 5; i++) await buffer.update(frame(i * interval));
    const last = 4 * interval;
    await buffer.update(frame(last + 100, 0));
    await buffer.update(frame(last + 200, 0));
    expect(await buffer.update(frame(last + 300, 0))).toMatchObject({ reason: 'too_short', rejected: true });
    expect(wordModel.predict).not.toHaveBeenCalled();
  });

  it('does not crop the sign at the minimum duration and keeps short missing detections masked', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);
    for (let t = 0; t <= 2500; t += 100) await buffer.update(frame(t, t === 700 ? 0 : 1));
    expect(wordModel.predict).not.toHaveBeenCalled();
    await buffer.update(frame(2600));
    expect(wordModel.predict).toHaveBeenCalledTimes(1);
    const tensor = vi.mocked(wordModel.predict).mock.calls[0][0];
    expect(tensor.some(row => row[157] === 0)).toBe(true);
  });

  it('rejects interrupted observation streams rather than joining different signs', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);
    await buffer.update(frame(0));
    expect(await buffer.update(frame(1000))).toMatchObject({ rejected: true, reason: 'observation_gap' });
    await pump(buffer, 1100);
    expect(wordModel.predict).not.toHaveBeenCalled();
  });

  it('requires continuous observed absence; a stalled camera is not release evidence', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);
    await pump(buffer);
    await buffer.update(frame(2700, 0));
    expect(await buffer.update(frame(4000, 0))).toMatchObject({ phase: 'release_required' });
    expect(await buffer.update(frame(4100))).toMatchObject({ phase: 'release_required' });
    expect(wordModel.predict).toHaveBeenCalledTimes(1);
  });

  it('finishes on withdrawal after a complete sign and rejects a too-short sign', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);
    for (let t = 0; t <= 1000; t += 100) await buffer.update(frame(t));
    await buffer.update(frame(1100, 0));
    await buffer.update(frame(1200, 0));
    expect((await buffer.update(frame(1300, 0))).prediction?.accepted).toBe(true);
    buffer.reset();
    await buffer.update(frame(2800));
    await buffer.update(frame(2900, 0));
    await buffer.update(frame(3000, 0));
    expect(await buffer.update(frame(3100, 0))).toMatchObject({ reason: 'too_short', rejected: true });
  });

  it('allows one pending inference and cancels its result across reset', async () => {
    let resolve!: (prediction: Awaited<ReturnType<WordRecognitionModel['predict']>>) => void;
    const wordModel = model(true);
    vi.mocked(wordModel.predict).mockImplementation(() => new Promise(r => { resolve = r; }));
    const buffer = new WordCaptureBuffer(wordModel);
    for (let t = 0; t < 2600; t += 100) await buffer.update(frame(t));
    const pending = buffer.update(frame(2600));
    expect(await buffer.update(frame(2700))).toEqual({ phase: 'analyzing' });
    expect(wordModel.predict).toHaveBeenCalledTimes(1);
    buffer.reset(true);
    resolve({ label: 'thank you', confidence: 1, margin: 1, accepted: true });
    expect((await pending).prediction).toBeUndefined();
    expect(await buffer.update(frame(2800))).toMatchObject({ phase: 'release_required' });
  });

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
    expect(await buffer.update(frame(2700))).toMatchObject({ phase: 'release_required' });
    expect(wordModel.predict).toHaveBeenCalledTimes(1);

    await buffer.update(frame(2800, 0));
    for (let t = 2900; t <= 3400; t += 100) await buffer.update(frame(t, 0));
    await pump(buffer, 3500);

    expect(wordModel.predict).toHaveBeenCalledTimes(2);
  });

  it('rejects low-quality sequences before model inference and reset clears lifecycle state', async () => {
    const wordModel = model(true);
    const buffer = new WordCaptureBuffer(wordModel);
    for (let index = 0; index < 27; index++) {
      await buffer.update(frame(index * 100, 1, []));
    }
    expect(wordModel.predict).not.toHaveBeenCalled();

    buffer.reset();
    const decision = await pump(buffer, 2800);
    expect(decision.prediction?.accepted).toBe(true);
    expect(wordModel.predict).toHaveBeenCalledTimes(1);
  });
});
