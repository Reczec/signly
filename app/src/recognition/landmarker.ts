export const WASM_BASE_PATH = '/wasm';
export const MODEL_PATH = '/models/hand_landmarker.task';
export const MODEL_REPOSITORY_PATH = 'app/public/models/hand_landmarker.task';
export const MODEL_DOWNLOAD_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const MODEL_EXPECTED_BYTES = 7_819_105;
export const MAX_HANDS = 2;

export const MODEL_MISSING_MESSAGE =
  `Hand Landmarker model not found: place hand_landmarker.task (${MODEL_EXPECTED_BYTES.toLocaleString('en-US')} bytes) ` +
  `at ${MODEL_REPOSITORY_PATH}. Download it once from ${MODEL_DOWNLOAD_URL}. The browser loads it from ${MODEL_PATH} ` +
  `and never downloads it at runtime.`;

export const WASM_LOAD_MESSAGE =
  `Local MediaPipe WASM could not be loaded from ${WASM_BASE_PATH}. ` +
  'Run "npm.cmd run assets" from the app directory to copy the locked @mediapipe/tasks-vision 0.10.35 wasm files into public/wasm.';

export const MODEL_LOAD_MESSAGE =
  `Hand Landmarker could not be initialized from ${MODEL_PATH}. ` +
  `Verify that ${MODEL_REPOSITORY_PATH} exists with ${MODEL_EXPECTED_BYTES.toLocaleString('en-US')} bytes ` +
  `and that ${WASM_BASE_PATH} contains the local wasm files.`;

export interface HandLandmarkDetection {
  landmarks: { x: number; y: number; z: number }[][];
  handedness?: { categoryName: string }[][];
  handednesses?: { categoryName: string }[][];
}

export interface HandLandmarkDetector {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): HandLandmarkDetection;
  close(): void;
}

export interface ModelProbeResponse {
  ok: boolean;
  headers?: { get(name: string): string | null };
}

export type ModelProbeFetch = (
  input: string,
  init?: { method?: string },
) => Promise<ModelProbeResponse>;

export function modelSizeMessage(actualBytes: number): string {
  return (
    `Hand Landmarker model at ${MODEL_REPOSITORY_PATH} has ${actualBytes.toLocaleString('en-US')} bytes; ` +
    `expected ${MODEL_EXPECTED_BYTES.toLocaleString('en-US')} bytes. ` +
    `Replace it with a complete download from ${MODEL_DOWNLOAD_URL}.`
  );
}

function defaultModelProbe(input: string, init?: { method?: string }): Promise<ModelProbeResponse> {
  return globalThis.fetch(input, init);
}

export async function ensureHandLandmarkerModel(
  fetchImpl: ModelProbeFetch = defaultModelProbe,
): Promise<void> {
  let probe: ModelProbeResponse | undefined;
  try {
    probe = await fetchImpl(MODEL_PATH, { method: 'HEAD' });
  } catch {
    probe = undefined;
  }
  if (!probe || !probe.ok) throw new Error(MODEL_MISSING_MESSAGE);

  const contentType = probe.headers?.get('content-type');
  if (contentType && contentType.includes('text/html')) throw new Error(MODEL_MISSING_MESSAGE);

  const contentLength = probe.headers?.get('content-length');
  const bytes = contentLength ? Number(contentLength) : Number.NaN;
  if (Number.isFinite(bytes) && bytes !== MODEL_EXPECTED_BYTES) {
    throw new Error(modelSizeMessage(bytes));
  }
}

interface VisionFileset {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
  assetLoaderPath?: string;
  assetBinaryPath?: string;
}

let filesetPromise: Promise<VisionFileset> | null = null;

function loadVisionFileset(): Promise<VisionFileset> {
  if (!filesetPromise) {
    filesetPromise = import('@mediapipe/tasks-vision')
      .then(({ FilesetResolver }) => FilesetResolver.forVisionTasks(WASM_BASE_PATH))
      .catch((cause: unknown) => {
        filesetPromise = null;
        throw new Error(WASM_LOAD_MESSAGE, { cause });
      });
  }
  return filesetPromise;
}

export async function createHandLandmarker(): Promise<HandLandmarkDetector> {
  const fileset = await loadVisionFileset();
  const { HandLandmarker } = await import('@mediapipe/tasks-vision');
  try {
    return await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: MAX_HANDS,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch (cause) {
    throw new Error(MODEL_LOAD_MESSAGE, { cause });
  }
}
