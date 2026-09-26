import * as ort from 'onnxruntime-web/wasm';
import { SEQUENCE_DIMENSIONS, SEQUENCE_LENGTH, SEQUENCE_VERSION } from './sequence';

export const WORD_MODEL_PATH = '/models/word-classifier-v1.onnx';
export const WORD_LABELS_PATH = '/models/word-classifier-v1.labels.json';
export const WORD_MODEL_REPOSITORY_PATH = 'app/public/models/word-classifier-v1.onnx';
export const WORD_LABELS_REPOSITORY_PATH = 'app/public/models/word-classifier-v1.labels.json';
export const ORT_WASM_BASE_PATH = '/ort/';

export interface WordPrediction {
  label: string;
  confidence: number;
  margin: number;
  accepted: boolean;
}

export interface WordRecognitionModel {
  labels: readonly string[];
  predict(tensor: readonly (readonly number[])[]): Promise<WordPrediction>;
}

interface LabelsFile {
  preprocessingVersion?: unknown;
  sequenceLength?: unknown;
  sequenceDimensions?: unknown;
  labels?: unknown;
}

const ACCEPT_CONFIDENCE = 0.65;
const ACCEPT_MARGIN = 0.15;

let modelPromise: Promise<WordRecognitionModel> | null = null;

function assertLabelsFile(value: LabelsFile): string[] {
  if (value.preprocessingVersion !== SEQUENCE_VERSION) {
    throw new Error(`Word model preprocessing version mismatch: expected ${SEQUENCE_VERSION}.`);
  }
  if (value.sequenceLength !== SEQUENCE_LENGTH || value.sequenceDimensions !== SEQUENCE_DIMENSIONS) {
    throw new Error(`Word model shape mismatch: expected [${SEQUENCE_LENGTH}, ${SEQUENCE_DIMENSIONS}].`);
  }
  if (!Array.isArray(value.labels) || !value.labels.every((label) => typeof label === 'string')) {
    throw new Error('Word model labels are missing or invalid.');
  }
  return value.labels;
}

function softmax(logits: readonly number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Cannot load ${WORD_LABELS_REPOSITORY_PATH}.`);
  return (await response.json()) as T;
}

export async function loadWordRecognitionModel(): Promise<WordRecognitionModel> {
  if (!modelPromise) {
    modelPromise = createWordRecognitionModel().catch((cause) => {
      modelPromise = null;
      throw cause;
    });
  }
  return modelPromise;
}

async function createWordRecognitionModel(): Promise<WordRecognitionModel> {
  ort.env.wasm.wasmPaths = { wasm: ORT_WASM_BASE_PATH + 'ort-wasm-simd-threaded.wasm' };
  ort.env.wasm.numThreads = 1;
  const labels = assertLabelsFile(await fetchJson<LabelsFile>(WORD_LABELS_PATH));
  const session = await ort.InferenceSession.create(WORD_MODEL_PATH, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }).catch((cause: unknown) => {
    throw new Error(`Word ONNX model could not be initialized from ${WORD_MODEL_REPOSITORY_PATH}.`, { cause });
  });

  return {
    labels: Object.freeze([...labels]),
    async predict(sequence) {
      const flat = sequence.flat();
      if (sequence.length !== SEQUENCE_LENGTH || flat.length !== SEQUENCE_LENGTH * SEQUENCE_DIMENSIONS) {
        throw new Error(`Word sequence must have shape [${SEQUENCE_LENGTH}, ${SEQUENCE_DIMENSIONS}].`);
      }
      const inputName = session.inputNames[0] ?? 'sequence';
      const outputName = session.outputNames[0] ?? 'logits';
      const feeds = {
        [inputName]: new ort.Tensor('float32', Float32Array.from(flat), [1, SEQUENCE_LENGTH, SEQUENCE_DIMENSIONS]),
      };
      const outputs = await session.run(feeds);
      const logits = Array.from(outputs[outputName].data as Float32Array);
      const probabilities = softmax(logits);
      const ranked = probabilities
        .map((confidence, index) => ({ index, confidence }))
        .sort((a, b) => b.confidence - a.confidence);
      const best = ranked[0]!;
      const second = ranked[1]?.confidence ?? 0;
      const margin = best.confidence - second;
      return {
        label: labels[best.index]!,
        confidence: best.confidence,
        margin,
        accepted: best.confidence >= ACCEPT_CONFIDENCE && margin >= ACCEPT_MARGIN,
      };
    },
  };
}
