import { describe, expect, it, vi } from 'vitest';
import {
  createDataset,
  parseSamplesDataset,
  type CollectedSample,
  type SamplesDataset,
} from './dataset';
import {
  FEATURE_DIMENSIONS,
  PREPROCESSING_VERSION,
} from './features';
import {
  buildKnnModel,
  createKnnClassifier,
  loadKnnClassifier,
  parseKnnModel,
  rmsDistance,
  type KnnModel,
  type KnnPrototype,
} from './classifier';

const CENTERS: Record<string, number> = { A: 0, B: 4, C: -4 };

function syntheticFrame(label: string, hold: number, frame: number): number[] {
  const center = CENTERS[label];
  return Array.from({ length: FEATURE_DIMENSIONS }, (_, dimension) => {
    const noise = (((hold * 7 + frame * 3 + dimension) % 5) - 2) * 0.001;
    return center + hold * 0.01 + noise;
  });
}

function syntheticDataset(
  labels = ['A', 'B', 'C'],
  holdsPerLabel = 8,
  extraValidationHolds = 0,
): SamplesDataset {
  const samples: CollectedSample[] = [];
  let timestamp = 1_790_416_800_000;
  for (const label of labels) {
    for (let hold = 0; hold < holdsPerLabel; hold++) {
      for (let frame = 0; frame < 5; frame++) {
        samples.push({
          signerId: 'demo',
          sessionId: `session-${hold % 2}`,
          holdId: `${label}-hold-${hold}`,
          split: 'train',
          timestamp: timestamp++,
          label,
          preprocessingVersion: PREPROCESSING_VERSION,
          features: syntheticFrame(label, hold, frame),
        });
      }
    }
    for (let hold = 0; hold < extraValidationHolds; hold++) {
      for (let frame = 0; frame < 5; frame++) {
        samples.push({
          signerId: 'demo',
          sessionId: 'session-val',
          holdId: `${label}-val-${hold}`,
          split: 'validation',
          timestamp: timestamp++,
          label,
          preprocessingVersion: PREPROCESSING_VERSION,
          features: syntheticFrame(label, hold + 40, frame),
        });
      }
    }
  }
  return parseSamplesDataset({
    schemaVersion: 1,
    preprocessingVersion: PREPROCESSING_VERSION,
    samples,
  });
}

function scalar(value: number): number[] {
  return new Array<number>(FEATURE_DIMENSIONS).fill(value);
}

function handModel(spec: {
  labels: string[];
  clusters: Record<string, number[]>;
  radii: Record<string, number>;
  enabledLabels?: string[];
  knn?: Partial<KnnModel['knn']>;
}): KnnModel {
  const prototypes: KnnPrototype[] = [];
  for (const [label, values] of Object.entries(spec.clusters)) {
    values.forEach((value, index) => {
      prototypes.push({
        label,
        holdId: `${label}-hold-${index}`,
        sessionId: 'session-0',
        signerId: 'demo',
        features: scalar(value),
      });
    });
  }
  return {
    schemaVersion: 1,
    preprocessingVersion: PREPROCESSING_VERSION,
    featureDimensions: FEATURE_DIMENSIONS,
    trainedAt: '2026-09-26T00:00:00.000Z',
    provisional: true,
    labels: spec.labels,
    enabledLabels: spec.enabledLabels ?? [],
    knn: { k: 7, minVotes: 6, minSeparation: 0.15, classSize: 3, ...(spec.knn ?? {}) },
    prototypes,
    radii: spec.radii,
    training: {
      split: 'train',
      frames: prototypes.length * 5,
      holds: prototypes.length,
      signers: ['demo'],
      perLabel: {},
    },
  };
}

function distance(left: readonly number[], right: readonly number[]): number {
  return rmsDistance(left, right);
}

describe('rms distance', () => {
  it('is the root mean square over all coordinates', () => {
    expect(distance([0, 0, 0], [3, 4, 0])).toBeCloseTo(Math.sqrt(25 / 3), 10);
    expect(distance([1, 1], [1, 1])).toBe(0);
  });

  it('returns infinity for mismatched or empty vectors', () => {
    expect(distance([1], [1, 2])).toBe(Number.POSITIVE_INFINITY);
    expect(distance([], [])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('kNN model training', () => {
  it('averages each hold into one prototype and marks the model provisional', () => {
    const dataset = syntheticDataset();
    expect(dataset.samples).toHaveLength(120);

    const model = buildKnnModel(dataset, { labels: ['A', 'B', 'C'] });

    expect(model.schemaVersion).toBe(1);
    expect(model.preprocessingVersion).toBe(PREPROCESSING_VERSION);
    expect(model.featureDimensions).toBe(FEATURE_DIMENSIONS);
    expect(model.provisional).toBe(true);
    expect(model.labels).toEqual(['A', 'B', 'C']);
    expect(model.enabledLabels).toEqual([]);
    expect(model.prototypes).toHaveLength(24);
    expect(model.prototypes.filter((prototype) => prototype.label === 'A')).toHaveLength(8);
    expect(model.training).toMatchObject({ split: 'train', frames: 120, holds: 24 });
    expect(model.training.perLabel.A).toEqual({ holds: 8, frames: 40 });
    expect(model.radii.A).toBeGreaterThan(0);
    expect(model.radii.B).toBeGreaterThan(0);
    expect(model.radii.C).toBeGreaterThan(0);
    expect(model.knn).toEqual({ k: 7, minVotes: 6, minSeparation: 0.15, classSize: 3 });
  });

  it('keeps validation holds out of prototypes and provenance counts', () => {
    const model = buildKnnModel(syntheticDataset(['A', 'B', 'C'], 8, 4), {
      labels: ['A', 'B', 'C'],
    });

    expect(model.prototypes).toHaveLength(24);
    expect(model.training.frames).toBe(120);
    expect(model.prototypes.some((prototype) => prototype.holdId.includes('-val-'))).toBe(false);
  });

  it('records enabled letters separately from trained candidates', () => {
    const model = buildKnnModel(syntheticDataset(), {
      labels: ['A', 'B', 'C'],
      enabledLabels: ['B'],
    });

    expect(model.enabledLabels).toEqual(['B']);
    expect(model.labels).toEqual(['A', 'B', 'C']);

    expect(() =>
      buildKnnModel(syntheticDataset(), { labels: ['A', 'B', 'C'], enabledLabels: ['Z'] }),
    ).toThrow('no training prototypes');
  });

  it('fails clearly on missing classes, unexpected labels and too few holds', () => {
    expect(() => buildKnnModel(syntheticDataset(), { labels: ['A', 'B'] })).toThrow(
      'unexpected [C]',
    );
    expect(() => buildKnnModel(syntheticDataset(), { labels: ['A', 'B', 'C', 'D'] })).toThrow(
      'missing [D]',
    );
    expect(() => buildKnnModel(syntheticDataset(['A', 'B', 'C'], 2))).toThrow(
      'independent training holds',
    );
    expect(() => buildKnnModel(createDataset())).toThrow('No training samples');
  });

  it('fails on a preprocessing version that does not match the current one', () => {
    const dataset = syntheticDataset();
    expect(() => buildKnnModel({ ...dataset, preprocessingVersion: 'signly-landmark-v0' })).toThrow(
      'retrain',
    );
  });
});

describe('kNN model serialization', () => {
  it('survives a JSON round trip and still classifies', () => {
    const model = buildKnnModel(syntheticDataset(), { labels: ['A', 'B', 'C'] });
    const restored = parseKnnModel(JSON.parse(JSON.stringify(model)));

    expect(restored).toEqual(model);
    expect(Object.isFrozen(createKnnClassifier(restored).enabledLabels)).toBe(true);

    const classifier = createKnnClassifier(restored);
    const result = classifier.classify(syntheticFrame('A', 0, 0));
    expect(result).toMatchObject({ label: 'A', accepted: true });
    expect(result!.confidence).toBeGreaterThanOrEqual(6 / 7);
  });

  it('rejects malformed models with specific messages', () => {
    const model = buildKnnModel(syntheticDataset(), { labels: ['A', 'B', 'C'] });

    expect(() => parseKnnModel({ ...model, schemaVersion: 99 })).toThrow('schemaVersion');
    expect(() => parseKnnModel({ ...model, preprocessingVersion: 'signly-landmark-v0' })).toThrow(
      'retrain',
    );
    expect(() => parseKnnModel({ ...model, featureDimensions: 62 })).toThrow('featureDimensions');
    expect(() => parseKnnModel({ ...model, enabledLabels: ['Z'] })).toThrow('not a trained label');
    expect(() => parseKnnModel({ ...model, knn: { ...model.knn, minVotes: 8 } })).toThrow(
      'cannot exceed',
    );
    expect(() => parseKnnModel({ ...model, knn: { ...model.knn, minSeparation: 2 } })).toThrow(
      'minSeparation',
    );
    expect(() => {
      const broken = { ...model };
      const radii = { ...broken.radii };
      delete radii.C;
      parseKnnModel({ ...broken, radii });
    }).toThrow('radii.C');
    expect(() =>
      parseKnnModel({
        ...model,
        prototypes: [...model.prototypes, { ...model.prototypes[0], label: 'Z' }],
      }),
    ).toThrow('prototypes[24].label');
    expect(() => parseKnnModel('nope')).toThrow('JSON object');
  });
});

describe('kNN classification', () => {
  const model = buildKnnModel(syntheticDataset(), { labels: ['A', 'B', 'C'] });
  const classifier = createKnnClassifier(model);

  it('recognizes each trained letter with a passing vote and separation check', () => {
    for (const label of ['A', 'B', 'C'] as const) {
      const result = classifier.classify(syntheticFrame(label, 3, 2));
      expect(result).toMatchObject({ label, accepted: true });
      expect(result!.confidence).toBeGreaterThanOrEqual(6 / 7);
    }
    expect(classifier.labels).toEqual(['A', 'B', 'C']);
  });

  it('rejects when fewer than 6 of 7 neighbors vote for the winner', () => {
    const voteRejected = createKnnClassifier(
      handModel({
        labels: ['A', 'B'],
        clusters: {
          A: [1.0, 1.01, 1.02, 1.03],
          B: [1.5, 1.51, 1.52, 1.53],
        },
        radii: { A: 2, B: 2 },
      }),
    );

    const result = voteRejected.classify(scalar(0));
    expect(result).toMatchObject({ label: 'A', accepted: false, confidence: 4 / 7 });
  });

  it('rejects a winner whose class distance exceeds the saved radius', () => {
    const query = syntheticFrame('A', 0, 0).map((value) => value + 0.5);
    const result = classifier.classify(query);

    expect(result).toMatchObject({ label: 'A', accepted: false });
  });

  it('rejects when the runner-up class is too close to the winner', () => {
    const separationRejected = createKnnClassifier(
      handModel({
        labels: ['A', 'B'],
        clusters: {
          A: [1.0, 1.01, 1.02, 1.03, 1.04, 1.05, 5, 5],
          B: [1.1, 1.11, 1.12, 9],
        },
        radii: { A: 2, B: 2 },
      }),
    );

    const result = separationRejected.classify(scalar(0));
    expect(result).toMatchObject({ label: 'A', accepted: false });
    expect(result!.confidence).toBeGreaterThanOrEqual(6 / 7);
  });

  it('never accepts an UNKNOWN winner', () => {
    const withUnknown = createKnnClassifier(
      handModel({
        labels: ['A', 'UNKNOWN'],
        clusters: {
          A: [5, 5, 5, 5, 5, 5, 5, 5],
          UNKNOWN: [1, 1, 1, 1, 1, 1, 1, 1],
        },
        radii: { A: 2, UNKNOWN: 2 },
      }),
    );

    const result = withUnknown.classify(scalar(0));
    expect(result).toMatchObject({ label: 'UNKNOWN', accepted: false });
  });

  it('returns null for unusable feature vectors', () => {
    expect(classifier.classify([1, 2, 3])).toBeNull();
    expect(classifier.classify(scalar(Number.NaN))).toBeNull();
    expect(
      createKnnClassifier({
        ...model,
        labels: [],
        prototypes: [],
        radii: {},
      }).classify(scalar(0)),
    ).toBeNull();
  });
});

describe('kNN model loading', () => {
  const model = buildKnnModel(syntheticDataset(), {
    labels: ['A', 'B', 'C'],
    enabledLabels: ['A'],
  });
  const json = JSON.stringify(model);

  function response(overrides: {
    ok?: boolean;
    contentType?: string | null;
    body?: string;
  }) {
    return {
      ok: overrides.ok ?? true,
      headers: { get: (name: string) => (name === 'content-type' ? (overrides.contentType ?? 'application/json') : null) },
      text: async () => overrides.body ?? json,
    };
  }

  it('loads a classifier from a valid JSON model', async () => {
    const fetchImpl = vi.fn(async () => response({}));
    const classifier = await loadKnnClassifier('/models/asl-knn-v1.json', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/models/asl-knn-v1.json', { method: 'GET' });
    expect(classifier).not.toBeNull();
    expect(classifier!.labels).toEqual(['A', 'B', 'C']);
    expect(classifier!.enabledLabels).toEqual(['A']);
    expect(classifier!.classify(syntheticFrame('B', 1, 1))).toMatchObject({
      label: 'B',
      accepted: true,
    });
  });

  it('treats a missing or unreachable model file as absent', async () => {
    await expect(
      loadKnnClassifier('/models/missing.json', async () => response({ ok: false })),
    ).resolves.toBeNull();
    await expect(
      loadKnnClassifier('/models/missing.json', async () => {
        throw new TypeError('network down');
      }),
    ).resolves.toBeNull();
    await expect(
      loadKnnClassifier('/models/missing.json', async () =>
        response({ contentType: 'text/html', body: '<!doctype html>' }),
      ),
    ).resolves.toBeNull();
  });

  it('fails loudly on corrupt or invalid model content', async () => {
    await expect(
      loadKnnClassifier('/models/bad.json', async () =>
        response({ contentType: 'application/json', body: '<!doctype html>' }),
      ),
    ).rejects.toThrow('not valid JSON');
    await expect(
      loadKnnClassifier('/models/bad.json', async () =>
        response({ body: JSON.stringify({ schemaVersion: 99 }) }),
      ),
    ).rejects.toThrow('invalid');
  });
});

describe('empty dataset guard', () => {
  it('refuses to train without independent holds', () => {
    const empty = createDataset();
    expect(() => buildKnnModel(empty)).toThrow('No training samples');
    expect(distance([], [])).toBe(Number.POSITIVE_INFINITY);
  });
});
