import { FEATURE_DIMENSIONS, PREPROCESSING_VERSION } from './features';

export const DATASET_SCHEMA_VERSION = 1;
export const SAMPLE_SPLITS = ['train', 'validation', 'test'] as const;

export type SampleSplit = (typeof SAMPLE_SPLITS)[number];

export interface CollectedSample {
  signerId: string;
  sessionId: string;
  holdId: string;
  split: SampleSplit;
  timestamp: number;
  label: string;
  preprocessingVersion: string;
  features: number[];
}

export interface SamplesDataset {
  schemaVersion: typeof DATASET_SCHEMA_VERSION;
  preprocessingVersion: string;
  samples: CollectedSample[];
}

const LABEL_PATTERN = /^[A-Z]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function createDataset(
  preprocessingVersion: string = PREPROCESSING_VERSION,
): SamplesDataset {
  return { schemaVersion: DATASET_SCHEMA_VERSION, preprocessingVersion, samples: [] };
}

interface HoldGroup {
  split: SampleSplit;
  label: string;
  sessionId: string;
  signerId: string;
}

export function parseSamplesDataset(raw: unknown): SamplesDataset {
  if (!isRecord(raw)) throw new Error('Samples dataset must be a JSON object.');
  if (raw.schemaVersion !== DATASET_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported samples dataset schemaVersion ${String(raw.schemaVersion)}; expected ${DATASET_SCHEMA_VERSION}.`,
    );
  }
  if (!isNonEmptyString(raw.preprocessingVersion)) {
    throw new Error('Samples dataset is missing a preprocessingVersion string.');
  }
  if (!Array.isArray(raw.samples)) {
    throw new Error('Samples dataset must contain a samples array.');
  }
  const preprocessingVersion = raw.preprocessingVersion;
  const samples: CollectedSample[] = [];
  const holds = new Map<string, HoldGroup>();

  raw.samples.forEach((entry: unknown, index: number) => {
    const where = `sample[${index}]`;
    if (!isRecord(entry)) throw new Error(`${where} must be a JSON object.`);
    if (!isNonEmptyString(entry.signerId)) throw new Error(`${where}.signerId must be a non-empty string.`);
    if (!isNonEmptyString(entry.sessionId)) throw new Error(`${where}.sessionId must be a non-empty string.`);
    if (!isNonEmptyString(entry.holdId)) throw new Error(`${where}.holdId must be a non-empty string.`);
    if (typeof entry.label !== 'string' || !LABEL_PATTERN.test(entry.label)) {
      throw new Error(`${where}.label must contain uppercase letters only.`);
    }
    const split = entry.split;
    if (typeof split !== 'string' || !(SAMPLE_SPLITS as readonly string[]).includes(split)) {
      throw new Error(`${where}.split must be one of ${SAMPLE_SPLITS.join(', ')}.`);
    }
    if (typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) {
      throw new Error(`${where}.timestamp must be a finite number.`);
    }
    if (entry.preprocessingVersion !== preprocessingVersion) {
      throw new Error(
        `${where}.preprocessingVersion ${String(entry.preprocessingVersion)} does not match dataset preprocessingVersion ${preprocessingVersion}; mixed preprocessing versions are not allowed.`,
      );
    }
    const features = entry.features;
    if (!Array.isArray(features) || features.length !== FEATURE_DIMENSIONS) {
      throw new Error(`${where}.features must contain exactly ${FEATURE_DIMENSIONS} numbers.`);
    }
    for (const value of features) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${where}.features contains a non-finite value.`);
      }
    }

    const sample: CollectedSample = {
      signerId: entry.signerId,
      sessionId: entry.sessionId,
      holdId: entry.holdId,
      split: split as SampleSplit,
      timestamp: entry.timestamp,
      label: entry.label,
      preprocessingVersion,
      features: features as number[],
    };

    const known = holds.get(sample.holdId);
    if (!known) {
      holds.set(sample.holdId, {
        split: sample.split,
        label: sample.label,
        sessionId: sample.sessionId,
        signerId: sample.signerId,
      });
    } else if (known.split !== sample.split) {
      throw new Error(
        `Split leakage: hold ${sample.holdId} appears in splits "${known.split}" and "${sample.split}". Every hold must belong to exactly one split.`,
      );
    } else if (known.label !== sample.label) {
      throw new Error(
        `Hold ${sample.holdId} mixes labels "${known.label}" and "${sample.label}".`,
      );
    } else if (known.sessionId !== sample.sessionId || known.signerId !== sample.signerId) {
      throw new Error(
        `Hold ${sample.holdId} mixes sessions or signers; a hold must stay in one group.`,
      );
    }
    samples.push(sample);
  });

  return { schemaVersion: DATASET_SCHEMA_VERSION, preprocessingVersion, samples };
}
