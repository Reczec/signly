import type { SamplesDataset } from './dataset';
import { FEATURE_DIMENSIONS, PREPROCESSING_VERSION } from './features';

export const KNN_MODEL_PATH = '/models/asl-knn-v1.json';
export const KNN_MODEL_SCHEMA_VERSION = 1;
export const DEFAULT_K = 7;
export const DEFAULT_MIN_VOTES = 6;
export const DEFAULT_MIN_SEPARATION = 0.15;
export const DEFAULT_CLASS_SIZE = 3;
export const MIN_HOLDS_PER_LABEL = 3;
export const LOO_RADIUS_PERCENTILE = 0.95;
export const UNKNOWN_LABEL = 'UNKNOWN';

export interface KnnPrototype {
  label: string;
  holdId: string;
  sessionId: string;
  signerId: string;
  features: number[];
}

export interface KnnModel {
  schemaVersion: number;
  preprocessingVersion: string;
  featureDimensions: number;
  trainedAt: string;
  provisional: boolean;
  labels: string[];
  enabledLabels: string[];
  knn: {
    k: number;
    minVotes: number;
    minSeparation: number;
    classSize: number;
  };
  prototypes: KnnPrototype[];
  radii: Record<string, number>;
  training: {
    split: string;
    frames: number;
    holds: number;
    signers: string[];
    perLabel: Record<string, { holds: number; frames: number }>;
  };
}

export interface Classification {
  label: string;
  confidence: number;
  accepted: boolean;
}

export interface SignClassifier {
  readonly labels: readonly string[];
  readonly enabledLabels: readonly string[];
  classify(features: readonly number[]): Classification | null;
}

export interface BuildKnnModelOptions {
  labels?: readonly string[];
  enabledLabels?: readonly string[];
  minHoldsPerLabel?: number;
}

export interface KnnModelResponse {
  ok: boolean;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

export type KnnModelFetch = (input: string, init?: { method?: string }) => Promise<KnnModelResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteFeatures(value: unknown, dimensions: number): value is number[] {
  if (!Array.isArray(value) || value.length !== dimensions) return false;
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return false;
  }
  return true;
}

export function rmsDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let index = 0; index < a.length; index++) {
    const difference = a[index] - b[index];
    if (!Number.isFinite(difference)) return Number.POSITIVE_INFINITY;
    sum += difference * difference;
  }
  return Math.sqrt(sum / a.length);
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

interface HoldGroup {
  label: string;
  sessionId: string;
  signerId: string;
  frames: number[][];
}

export function buildKnnModel(
  dataset: SamplesDataset,
  options: BuildKnnModelOptions = {},
): KnnModel {
  const minHoldsPerLabel = options.minHoldsPerLabel ?? MIN_HOLDS_PER_LABEL;
  if (dataset.preprocessingVersion !== PREPROCESSING_VERSION) {
    throw new Error(
      `Dataset preprocessingVersion ${dataset.preprocessingVersion} does not match the current ${PREPROCESSING_VERSION}; retrain with the current preprocessing implementation.`,
    );
  }
  const trainSamples = dataset.samples.filter((sample) => sample.split === 'train');
  if (trainSamples.length === 0) {
    throw new Error('No training samples found in split "train".');
  }
  const presentLabels = [...new Set(trainSamples.map((sample) => sample.label))].sort();
  const expectedLabels = [...(options.labels ?? [])];
  if (expectedLabels.length > 0) {
    const missing = expectedLabels.filter((label) => !presentLabels.includes(label));
    const unexpected = presentLabels.filter((label) => !expectedLabels.includes(label));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `Label mismatch: missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]; expected [${expectedLabels.join(', ')}].`,
      );
    }
  }

  const holds = new Map<string, HoldGroup>();
  for (const sample of trainSamples) {
    const known = holds.get(sample.holdId);
    if (!known) {
      holds.set(sample.holdId, {
        label: sample.label,
        sessionId: sample.sessionId,
        signerId: sample.signerId,
        frames: [sample.features],
      });
      continue;
    }
    if (known.label !== sample.label) {
      throw new Error(
        `Hold ${sample.holdId} mixes labels "${known.label}" and "${sample.label}" inside the training split.`,
      );
    }
    known.frames.push(sample.features);
  }

  const prototypes: KnnPrototype[] = [];
  const perLabel: Record<string, { holds: number; frames: number }> = {};
  for (const [holdId, hold] of holds) {
    const averaged = new Array<number>(FEATURE_DIMENSIONS).fill(0);
    for (const frame of hold.frames) {
      if (frame.length !== FEATURE_DIMENSIONS) {
        throw new Error(`Hold ${holdId} contains a frame with the wrong feature dimension.`);
      }
      for (let index = 0; index < FEATURE_DIMENSIONS; index++) averaged[index] += frame[index];
    }
    for (let index = 0; index < FEATURE_DIMENSIONS; index++) {
      averaged[index] /= hold.frames.length;
    }
    prototypes.push({
      label: hold.label,
      holdId,
      sessionId: hold.sessionId,
      signerId: hold.signerId,
      features: averaged,
    });
    const stats = (perLabel[hold.label] ??= { holds: 0, frames: 0 });
    stats.holds += 1;
    stats.frames += hold.frames.length;
  }

  const labels = Object.keys(perLabel).sort();
  for (const label of labels) {
    const stats = perLabel[label];
    if (stats.holds < minHoldsPerLabel) {
      throw new Error(
        `Label ${label} has ${stats.holds} independent training holds; at least ${minHoldsPerLabel} are required.`,
      );
    }
  }

  const radii: Record<string, number> = {};
  for (const label of labels) {
    const own = prototypes.filter((prototype) => prototype.label === label);
    const leaveOneOut: number[] = [];
    for (let index = 0; index < own.length; index++) {
      const distances = own
        .filter((_prototype, other) => other !== index)
        .map((prototype) => rmsDistance(own[index].features, prototype.features))
        .sort((left, right) => left - right);
      const take = Math.min(DEFAULT_CLASS_SIZE, distances.length);
      let sum = 0;
      for (let position = 0; position < take; position++) sum += distances[position];
      leaveOneOut.push(sum / take);
    }
    radii[label] = percentile(leaveOneOut, LOO_RADIUS_PERCENTILE);
  }

  const enabledLabels = [...new Set(options.enabledLabels ?? [])].sort();
  for (const label of enabledLabels) {
    if (!labels.includes(label)) {
      throw new Error(`enabledLabels contains "${label}" which has no training prototypes.`);
    }
  }

  const signers = [...new Set(prototypes.map((prototype) => prototype.signerId))].sort();
  return {
    schemaVersion: KNN_MODEL_SCHEMA_VERSION,
    preprocessingVersion: dataset.preprocessingVersion,
    featureDimensions: FEATURE_DIMENSIONS,
    trainedAt: new Date().toISOString(),
    provisional: true,
    labels,
    enabledLabels,
    knn: {
      k: DEFAULT_K,
      minVotes: DEFAULT_MIN_VOTES,
      minSeparation: DEFAULT_MIN_SEPARATION,
      classSize: DEFAULT_CLASS_SIZE,
    },
    prototypes,
    radii,
    training: {
      split: 'train',
      frames: trainSamples.length,
      holds: holds.size,
      signers,
      perLabel,
    },
  };
}

export function parseKnnModel(raw: unknown): KnnModel {
  if (!isRecord(raw)) throw new Error('kNN model must be a JSON object.');
  if (raw.schemaVersion !== KNN_MODEL_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported kNN model schemaVersion ${String(raw.schemaVersion)}; expected ${KNN_MODEL_SCHEMA_VERSION}.`,
    );
  }
  if (raw.preprocessingVersion !== PREPROCESSING_VERSION) {
    throw new Error(
      `kNN model preprocessingVersion ${String(raw.preprocessingVersion)} does not match the current ${PREPROCESSING_VERSION}; retrain the model.`,
    );
  }
  if (raw.featureDimensions !== FEATURE_DIMENSIONS) {
    throw new Error(
      `kNN model featureDimensions ${String(raw.featureDimensions)} does not match ${FEATURE_DIMENSIONS}.`,
    );
  }
  if (typeof raw.trainedAt !== 'string' || raw.trainedAt.length === 0) {
    throw new Error('kNN model is missing trainedAt provenance.');
  }
  if (typeof raw.provisional !== 'boolean') throw new Error('kNN model is missing provisional status.');
  if (!Array.isArray(raw.labels) || raw.labels.some((label) => !isNonEmptyString(label))) {
    throw new Error('kNN model labels must be an array of non-empty strings.');
  }
  const labels = [...raw.labels] as string[];
  if (new Set(labels).size !== labels.length) throw new Error('kNN model labels contain duplicates.');
  if (!Array.isArray(raw.enabledLabels) || raw.enabledLabels.some((label) => !isNonEmptyString(label))) {
    throw new Error('kNN model enabledLabels must be an array of non-empty strings.');
  }
  const enabledLabels = [...raw.enabledLabels] as string[];
  for (const label of enabledLabels) {
    if (!labels.includes(label)) {
      throw new Error(`kNN model enabledLabels contains "${label}" which is not a trained label.`);
    }
  }

  const knn = raw.knn;
  if (!isRecord(knn)) throw new Error('kNN model is missing knn settings.');
  const { k, minVotes, minSeparation, classSize } = knn;
  if (!Number.isInteger(k) || (k as number) < 1) throw new Error('kNN model knn.k must be a positive integer.');
  if (!Number.isInteger(minVotes) || (minVotes as number) < 1) {
    throw new Error('kNN model knn.minVotes must be a positive integer.');
  }
  if ((minVotes as number) > (k as number)) {
    throw new Error('kNN model knn.minVotes cannot exceed knn.k.');
  }
  if (typeof minSeparation !== 'number' || !Number.isFinite(minSeparation) || minSeparation < 0 || minSeparation > 1) {
    throw new Error('kNN model knn.minSeparation must be a number in [0, 1].');
  }
  if (!Number.isInteger(classSize) || (classSize as number) < 1) {
    throw new Error('kNN model knn.classSize must be a positive integer.');
  }

  if (!Array.isArray(raw.prototypes)) throw new Error('kNN model must contain a prototypes array.');
  const prototypes: KnnPrototype[] = [];
  raw.prototypes.forEach((entry: unknown, index: number) => {
    const where = `prototypes[${index}]`;
    if (!isRecord(entry)) throw new Error(`${where} must be a JSON object.`);
    if (!isNonEmptyString(entry.label) || !labels.includes(entry.label)) {
      throw new Error(`${where}.label must reference a trained label.`);
    }
    if (!isNonEmptyString(entry.holdId)) throw new Error(`${where}.holdId must be a non-empty string.`);
    if (!isNonEmptyString(entry.sessionId)) throw new Error(`${where}.sessionId must be a non-empty string.`);
    if (!isNonEmptyString(entry.signerId)) throw new Error(`${where}.signerId must be a non-empty string.`);
    if (!isFiniteFeatures(entry.features, FEATURE_DIMENSIONS)) {
      throw new Error(`${where}.features must contain exactly ${FEATURE_DIMENSIONS} finite numbers.`);
    }
    prototypes.push({
      label: entry.label,
      holdId: entry.holdId,
      sessionId: entry.sessionId,
      signerId: entry.signerId,
      features: entry.features,
    });
  });

  const radiiRaw = raw.radii;
  if (!isRecord(radiiRaw)) throw new Error('kNN model is missing radii.');
  const radii: Record<string, number> = {};
  for (const label of labels) {
    const radius = radiiRaw[label];
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) {
      throw new Error(`kNN model radii.${label} must be a finite number >= 0.`);
    }
    radii[label] = radius;
  }

  const training = raw.training;
  if (!isRecord(training)) throw new Error('kNN model is missing training provenance.');
  if (!isNonEmptyString(training.split)) throw new Error('kNN model training.split must be a non-empty string.');
  if (!Number.isInteger(training.frames) || !Number.isInteger(training.holds)) {
    throw new Error('kNN model training.frames and training.holds must be integers.');
  }
  if (!Array.isArray(training.signers) || training.signers.some((entry) => !isNonEmptyString(entry))) {
    throw new Error('kNN model training.signers must be an array of non-empty strings.');
  }
  if (!isRecord(training.perLabel)) throw new Error('kNN model training.perLabel must be an object.');

  return {
    schemaVersion: KNN_MODEL_SCHEMA_VERSION,
    preprocessingVersion: PREPROCESSING_VERSION,
    featureDimensions: FEATURE_DIMENSIONS,
    trainedAt: raw.trainedAt,
    provisional: raw.provisional,
    labels,
    enabledLabels,
    knn: {
      k: k as number,
      minVotes: minVotes as number,
      minSeparation: minSeparation as number,
      classSize: classSize as number,
    },
    prototypes,
    radii,
    training: {
      split: training.split,
      frames: training.frames as number,
      holds: training.holds as number,
      signers: training.signers as string[],
      perLabel: training.perLabel as Record<string, { holds: number; frames: number }>,
    },
  };
}

export function createKnnClassifier(model: KnnModel): SignClassifier {
  const byLabel = new Map<string, number[][]>();
  for (const prototype of model.prototypes) {
    const list = byLabel.get(prototype.label);
    if (list) list.push(prototype.features);
    else byLabel.set(prototype.label, [prototype.features]);
  }

  function classDistance(label: string, features: readonly number[]): number {
    const list = byLabel.get(label);
    if (!list || list.length === 0) return Number.POSITIVE_INFINITY;
    const distances = list
      .map((candidate) => rmsDistance(candidate, features))
      .sort((left, right) => left - right);
    const take = Math.min(model.knn.classSize, distances.length);
    let sum = 0;
    for (let index = 0; index < take; index++) sum += distances[index];
    return sum / take;
  }

  return {
    labels: Object.freeze([...model.labels]),
    enabledLabels: Object.freeze([...model.enabledLabels]),
    classify(features: readonly number[]): Classification | null {
      if (model.labels.length === 0) return null;
      if (!isFiniteFeatures(features, model.featureDimensions)) return null;
      const ranked = model.labels
        .map((label) => ({ label, distance: classDistance(label, features) }))
        .sort((left, right) => left.distance - right.distance);
      const winner = ranked[0];
      const runnerUp = ranked[1];
      const neighbors = model.prototypes
        .map((prototype) => ({ label: prototype.label, distance: rmsDistance(prototype.features, features) }))
        .sort((left, right) => left.distance - right.distance);
      const used = Math.min(model.knn.k, neighbors.length);
      let votes = 0;
      for (let index = 0; index < used; index++) {
        if (neighbors[index].label === winner.label) votes += 1;
      }
      const confidence = used > 0 ? votes / used : 0;
      let accepted =
        winner.label !== UNKNOWN_LABEL &&
        votes >= model.knn.minVotes &&
        winner.distance <= model.radii[winner.label];
      if (accepted && runnerUp) {
        const separation =
          runnerUp.distance > 0
            ? (runnerUp.distance - winner.distance) / runnerUp.distance
            : 0;
        accepted = separation >= model.knn.minSeparation;
      }
      return { label: winner.label, confidence, accepted };
    },
  };
}

function defaultModelFetch(input: string, init?: { method?: string }): Promise<KnnModelResponse> {
  return globalThis.fetch(input, init);
}

export async function loadKnnClassifier(
  url: string = KNN_MODEL_PATH,
  fetchImpl: KnnModelFetch = defaultModelFetch,
): Promise<SignClassifier | null> {
  let response: KnnModelResponse;
  try {
    response = await fetchImpl(url, { method: 'GET' });
  } catch {
    return null;
  }
  if (!response || !response.ok) return null;
  const contentType = response.headers?.get('content-type');
  if (contentType && contentType.includes('text/html')) return null;
  let raw: unknown;
  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    throw new Error(`kNN model at ${url} could not be read.`, { cause });
  }
  try {
    raw = JSON.parse(body);
  } catch (cause) {
    throw new Error(`kNN model at ${url} is not valid JSON; retrain it with npm.cmd run train.`, {
      cause,
    });
  }
  try {
    return createKnnClassifier(parseKnnModel(raw));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`kNN model at ${url} is invalid: ${message}`, { cause });
  }
}
