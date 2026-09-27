import * as ort from 'onnxruntime-web/wasm';
import { SEQUENCE_DIMENSIONS, SEQUENCE_LENGTH } from './sequence';
import { validateWordMetadata, verifyWordModel } from './wordModelContract';

export const WORD_MODEL_PATH = '/models/word-classifier-v1.onnx';
export const WORD_LABELS_PATH = '/models/word-classifier-v1.labels.json';
export const WORD_MODEL_REPOSITORY_PATH = 'app/public/models/word-classifier-v1.onnx';
export const WORD_LABELS_REPOSITORY_PATH = 'app/public/models/word-classifier-v1.labels.json';
export const ORT_WASM_BASE_PATH = '/ort/';

// Live usability policy, separate from the frozen research model's calibration.
// Validation: 7/14 accepted (one wrong), 11/84 non-target clips accepted.
export const WEBCAM_ACCEPTANCE = Object.freeze({ confidence: 0.85, margin: 0 });

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

let modelPromise: Promise<WordRecognitionModel> | null = null;

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
    modelPromise = createWordRecognitionModel('webcam').catch((cause) => {
      modelPromise = null;
      throw cause;
    });
  }
  return modelPromise;
}

export async function createWordRecognitionModel(policy: 'metadata' | 'webcam' = 'metadata'): Promise<WordRecognitionModel> {
  ort.env.wasm.wasmPaths = { wasm: ORT_WASM_BASE_PATH + 'ort-wasm-simd-threaded.wasm' };
  ort.env.wasm.numThreads = 1;
  const metadata = validateWordMetadata(await fetchJson<unknown>(WORD_LABELS_PATH));
  const { labels } = metadata;
  const acceptance = policy === 'webcam' ? WEBCAM_ACCEPTANCE : metadata.acceptance;
  const response = await fetch(WORD_MODEL_PATH);
  if (!response.ok) throw new Error(`Cannot load ${WORD_MODEL_REPOSITORY_PATH}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verifyWordModel(bytes, metadata);
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }).catch((cause: unknown) => {
    throw new Error(`Word ONNX model could not be initialized from ${WORD_MODEL_REPOSITORY_PATH}.`, { cause });
  });

  if (session.inputNames.length !== 1 || session.inputNames[0] !== metadata.inputName ||
      session.outputNames.length !== 1 || session.outputNames[0] !== metadata.outputName) {
    await session.release();
    throw new Error('Word model input/output contract mismatch.');
  }

  return {
    labels: Object.freeze([...labels]),
    async predict(sequence) {
      const flat = sequence.flat();
      if (sequence.length !== SEQUENCE_LENGTH || sequence.some(row => row.length !== SEQUENCE_DIMENSIONS) || !flat.every(Number.isFinite)) {
        throw new Error(`Word sequence must have shape [${SEQUENCE_LENGTH}, ${SEQUENCE_DIMENSIONS}].`);
      }
      const inputName = session.inputNames[0] ?? 'sequence';
      const outputName = session.outputNames[0] ?? 'logits';
      const feeds = {
        [inputName]: new ort.Tensor('float32', Float32Array.from(flat), [1, SEQUENCE_LENGTH, SEQUENCE_DIMENSIONS]),
      };
      const outputs = await session.run(feeds);
      const logits = Array.from(outputs[outputName].data as Float32Array);
      if (logits.length !== labels.length || !logits.every(Number.isFinite) ||
          outputs[outputName].dims.length !== 2 || outputs[outputName].dims[0] !== 1 || outputs[outputName].dims[1] !== labels.length) {
        throw new Error('Word model returned invalid logits.');
      }
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
        accepted: best.confidence >= acceptance.confidence && margin >= acceptance.margin,
      };
    },
  };
}
