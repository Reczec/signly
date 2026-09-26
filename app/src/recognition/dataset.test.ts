import { describe, expect, it } from 'vitest';
import { FEATURE_DIMENSIONS, PREPROCESSING_VERSION } from './features';
import { createDataset, parseSamplesDataset } from './dataset';

function sample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signerId: 'demo',
    sessionId: 'session-1',
    holdId: 'session-1-hold-1',
    split: 'train',
    timestamp: 1_790_416_800_000,
    label: 'A',
    preprocessingVersion: PREPROCESSING_VERSION,
    features: Array.from({ length: FEATURE_DIMENSIONS }, (_, index) => index / 100),
    ...overrides,
  };
}

function dataset(samples: Record<string, unknown>[]): unknown {
  return {
    schemaVersion: 1,
    preprocessingVersion: PREPROCESSING_VERSION,
    samples,
  };
}

describe('sample dataset schema', () => {
  it('creates an empty dataset with the current preprocessing version', () => {
    const created = createDataset();
    expect(created).toEqual({
      schemaVersion: 1,
      preprocessingVersion: PREPROCESSING_VERSION,
      samples: [],
    });
  });

  it('parses a valid A/B/C dataset', () => {
    const parsed = parseSamplesDataset(
      dataset([
        sample(),
        sample({ holdId: 'session-1-hold-2', label: 'B' }),
        sample({ holdId: 'session-2-hold-1', sessionId: 'session-2', label: 'C' }),
      ]),
    );

    expect(parsed.samples).toHaveLength(3);
    expect(parsed.samples.map((entry) => entry.label)).toEqual(['A', 'B', 'C']);
    expect(parsed.samples[0].split).toBe('train');
    expect(parsed.samples[0].features).toHaveLength(FEATURE_DIMENSIONS);
  });

  it('rejects a wrong schema version', () => {
    expect(() => parseSamplesDataset({ schemaVersion: 99 })).toThrow('schemaVersion');
    expect(() => parseSamplesDataset('not an object')).toThrow('JSON object');
  });

  it('rejects mixed preprocessing versions inside one dataset', () => {
    expect(() =>
      parseSamplesDataset(dataset([sample({ preprocessingVersion: 'signly-landmark-v0' })])),
    ).toThrow('mixed preprocessing versions');
  });

  it('detects split leakage when one hold appears in two splits', () => {
    expect(() =>
      parseSamplesDataset(dataset([sample(), sample({ split: 'test' })])),
    ).toThrow('Split leakage');
  });

  it('rejects a hold that mixes labels, sessions or signers', () => {
    expect(() => parseSamplesDataset(dataset([sample(), sample({ label: 'B' })]))).toThrow(
      'mixes labels',
    );
    expect(() =>
      parseSamplesDataset(dataset([sample(), sample({ sessionId: 'session-2' })])),
    ).toThrow('mixes sessions or signers');
    expect(() => parseSamplesDataset(dataset([sample(), sample({ signerId: 'other' })]))).toThrow(
      'mixes sessions or signers',
    );
  });

  it('rejects malformed samples with an indexed message', () => {
    expect(() => parseSamplesDataset(dataset([sample({ holdId: '' })]))).toThrow('sample[0].holdId');
    expect(() => parseSamplesDataset(dataset([sample({ label: 'a' })]))).toThrow('sample[0].label');
    expect(() => parseSamplesDataset(dataset([sample({ split: 'holdout' })]))).toThrow(
      'sample[0].split',
    );
    expect(() => parseSamplesDataset(dataset([sample({ timestamp: 'now' })]))).toThrow(
      'sample[0].timestamp',
    );
    expect(() =>
      parseSamplesDataset(dataset([sample({ features: Array(FEATURE_DIMENSIONS - 1).fill(0) })])),
    ).toThrow('sample[0].features');
    expect(() =>
      parseSamplesDataset(
        dataset([
          sample({ features: Array.from({ length: FEATURE_DIMENSIONS }, () => Number.NaN) }),
        ]),
      ),
    ).toThrow('non-finite');
    expect(() => parseSamplesDataset(dataset([sample({ signerId: 7 })]))).toThrow(
      'sample[0].signerId',
    );
    expect(() => parseSamplesDataset({ schemaVersion: 1, preprocessingVersion: 'x' })).toThrow(
      'samples array',
    );
  });
});
