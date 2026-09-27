import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWordRecognitionModel, loadWordRecognitionModel } from './wordModel';
import { validateWordMetadata, verifyWordModel } from './wordModelContract';

const ortMock = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), release: vi.fn() }));
vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} },
  Tensor: class { constructor(public type: string, public data: Float32Array, public dims: number[]) {} },
  InferenceSession: { create: ortMock.create },
}));
const bytes = new Uint8Array(readFileSync(new URL('../../public/models/word-classifier-v1.onnx', import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL('../../public/models/word-classifier-v1.labels.json', import.meta.url), 'utf8'));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('.json')
    ? { ok: true, json: async () => metadata }
    : { ok: true, arrayBuffer: async () => bytes.slice().buffer }));
  ortMock.create.mockResolvedValue({ inputNames: ['sequence'], outputNames: ['logits'], run: ortMock.run, release: ortMock.release });
});

describe('local word model contract', () => {
  it('uses the more permissive webcam policy in the live loader while preserving frozen research thresholds', async () => {
    const live = await loadWordRecognitionModel();
    const frozen = await createWordRecognitionModel();
    const input = Array.from({ length: 32 }, () => Array(162).fill(0));
    for (const confidence of [.79, .81, .84, .91]) {
      const logits = new Float32Array(metadata.labels.length).fill(Math.log((1 - confidence) / (metadata.labels.length - 1)));
      logits[4] = Math.log(confidence);
      ortMock.run.mockResolvedValue({ logits: { data: logits, dims: [1, logits.length] } });
      expect(await live.predict(input)).toMatchObject({ label: 'thank you', accepted: confidence >= .80 });
      expect(await frozen.predict(input)).toMatchObject({ label: 'thank you', accepted: confidence >= .9 });
    }
  });

  it('removes work from live vocabulary and rejects it without promoting another word', async () => {
    const live = await createWordRecognitionModel('webcam');
    expect(live.labels).toHaveLength(12);
    expect(live.labels).not.toContain('work');
    expect(live.labels).toContain('change');
    expect(live.labels).toContain('yes');
    const input = Array.from({ length: 32 }, () => Array(162).fill(0));
    const probabilities = Array(metadata.labels.length).fill(.001);
    probabilities[metadata.labels.indexOf('work')] = .87;
    probabilities[metadata.labels.indexOf('change')] = .119;
    const logits = Float32Array.from(probabilities.map(Math.log));
    ortMock.run.mockResolvedValue({ logits: { data: logits, dims: [1, logits.length] } });
    expect(await live.predict(input)).toMatchObject({ label: null, accepted: false, rejection: 'unsupported_sign' });
    const frozen = await createWordRecognitionModel();
    expect(frozen.labels).toEqual(metadata.labels);
  });

  it('does not inflate an enabled word score by discarding the removed class', async () => {
    const live = await createWordRecognitionModel('webcam');
    const probabilities = Array(metadata.labels.length).fill(.001);
    probabilities[metadata.labels.indexOf('change')] = .79;
    probabilities[metadata.labels.indexOf('work')] = .199;
    const logits = Float32Array.from(probabilities.map(Math.log));
    ortMock.run.mockResolvedValue({ logits: { data: logits, dims: [1, logits.length] } });
    const prediction = await live.predict(Array.from({ length: 32 }, () => Array(162).fill(0)));
    expect(prediction).toMatchObject({ label: 'change', accepted: false });
    expect(prediction.confidence).toBeCloseTo(.79);
  });

  it('checks the shipped model checksum, embedded label order, dimensions and thresholds', async () => {
    await expect(verifyWordModel(bytes, validateWordMetadata(metadata))).resolves.toBeUndefined();
    expect(metadata.labels).toContain('thank you');
    const model = await createWordRecognitionModel();
    expect(model.labels).toEqual(metadata.labels);
    expect(Object.isFrozen(model.labels)).toBe(true);
  });

  it.each([
    { labels: [] }, { labels: ['yes', 'yes'] }, { labels: ['yes', ''] },
    { labels: ['yes', 'UNKNOWN'] }, { labels: ['yes', 2] },
    { acceptance: { confidence: NaN, margin: .1 } }, { sequenceDimensions: 163 },
    { preprocessingVersion: 'different' }, { inputName: 'wrong' }, { modelSha256: 'bad' },
  ])('rejects malformed metadata %j', change => {
    expect(() => validateWordMetadata({ ...metadata, ...change })).toThrow();
  });

  it('rejects a corrupt model and swapped labels even with the right model hash', async () => {
    const corrupt = bytes.slice(); corrupt[20] ^= 1;
    await expect(verifyWordModel(corrupt, metadata)).rejects.toThrow('checksum');
    await expect(verifyWordModel(bytes, { ...metadata, labels: [...metadata.labels].reverse() })).rejects.toThrow('labels mismatch');
    await expect(verifyWordModel(bytes, { ...metadata, acceptance: { confidence: .5, margin: .1 } })).rejects.toThrow('acceptance mismatch');
  });

  it('rejects ragged and nonfinite inputs, output size mismatches and nonfinite logits', async () => {
    const model = await createWordRecognitionModel();
    const input = Array.from({ length: 32 }, () => Array(162).fill(0));
    const ragged = input.map(row => [...row]); ragged[0].pop(); ragged[1].push(0);
    await expect(model.predict(ragged)).rejects.toThrow('shape');
    input[0][0] = NaN;
    await expect(model.predict(input)).rejects.toThrow('shape');
    input[0][0] = 0;
    ortMock.run.mockResolvedValue({ logits: { data: new Float32Array([1]), dims: [1,1] } });
    await expect(model.predict(input)).rejects.toThrow('logits');
    ortMock.run.mockResolvedValue({ logits: { data: new Float32Array(metadata.labels.length).fill(NaN), dims: [1,metadata.labels.length] } });
    await expect(model.predict(input)).rejects.toThrow('logits');
  });

  it('uses metadata thresholds and keeps the exported label order', async () => {
    const model = await createWordRecognitionModel();
    const input = Array.from({ length: 32 }, () => Array(162).fill(0));
    const logits = new Float32Array(metadata.labels.length); logits[4] = 10;
    ortMock.run.mockResolvedValue({ logits: { data: logits, dims: [1,logits.length] } });
    expect(await model.predict(input)).toMatchObject({ label: metadata.labels[4], accepted: true });
    logits.fill(0);
    expect(await model.predict(input)).toMatchObject({ accepted: false });
  });

  it('releases an incompatible session and fails instead of falling back', async () => {
    ortMock.create.mockResolvedValue({ inputNames: ['bad'], outputNames: ['logits'], release: ortMock.release });
    await expect(createWordRecognitionModel()).rejects.toThrow('contract mismatch');
    expect(ortMock.release).toHaveBeenCalledTimes(1);
  });
});
