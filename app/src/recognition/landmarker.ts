export const WASM_BASE_PATH = '/wasm';
export const MODEL_PATH = '/models/hand_landmarker.task';
export const POSE_MODEL_PATH = '/models/pose_landmarker_lite.task';
export const MODEL_REPOSITORY_PATH = 'app/public/models/hand_landmarker.task';
export const POSE_MODEL_REPOSITORY_PATH = 'app/public/models/pose_landmarker_lite.task';
export const MODEL_DOWNLOAD_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const POSE_MODEL_DOWNLOAD_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
export const MODEL_EXPECTED_BYTES = 7_819_105;
export const POSE_MODEL_EXPECTED_BYTES = 5_777_746;
export const MAX_HANDS = 2;

export const MODEL_MISSING_MESSAGE =
  `Hand Landmarker model not found: place hand_landmarker.task (${MODEL_EXPECTED_BYTES.toLocaleString('en-US')} bytes) ` +
  `at ${MODEL_REPOSITORY_PATH}. Download it once from ${MODEL_DOWNLOAD_URL}. The browser loads it from ${MODEL_PATH} ` +
  `and never downloads it at runtime.`;
export const POSE_MODEL_MISSING_MESSAGE =
  `Pose Landmarker model not found: place pose_landmarker_lite.task (${POSE_MODEL_EXPECTED_BYTES.toLocaleString('en-US')} bytes) ` +
  `at ${POSE_MODEL_REPOSITORY_PATH}. Download it once from ${POSE_MODEL_DOWNLOAD_URL}. The browser loads it from ${POSE_MODEL_PATH} ` +
  `and never downloads it at runtime.`;

export const WASM_LOAD_MESSAGE =
  `Local MediaPipe WASM could not be loaded from ${WASM_BASE_PATH}. ` +
  'Run "npm.cmd run assets" from the app directory to copy the locked @mediapipe/tasks-vision 0.10.35 wasm files into public/wasm.';

export const MODEL_LOAD_MESSAGE =
  `MediaPipe landmarkers could not be initialized from ${MODEL_PATH} and ${POSE_MODEL_PATH}. ` +
  `Verify that ${MODEL_REPOSITORY_PATH} exists with ${MODEL_EXPECTED_BYTES.toLocaleString('en-US')} bytes ` +
  `and ${POSE_MODEL_REPOSITORY_PATH} exists with ${POSE_MODEL_EXPECTED_BYTES.toLocaleString('en-US')} bytes, ` +
  `and that ${WASM_BASE_PATH} contains the local wasm files.`;

export interface HandLandmarkDetection {
  landmarks: { x: number; y: number; z: number }[][];
  handedness?: { categoryName: string }[][];
  handednesses?: { categoryName: string }[][];
  poseLandmarks?: { x: number; y: number; z: number; visibility?: number; presence?: number }[];
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

export function poseModelSizeMessage(actualBytes: number): string {
  return (
    `Pose Landmarker model at ${POSE_MODEL_REPOSITORY_PATH} has ${actualBytes.toLocaleString('en-US')} bytes; ` +
    `expected ${POSE_MODEL_EXPECTED_BYTES.toLocaleString('en-US')} bytes. ` +
    `Replace it with a complete download from ${POSE_MODEL_DOWNLOAD_URL}.`
  );
}

function defaultModelProbe(input: string, init?: { method?: string }): Promise<ModelProbeResponse> {
  return globalThis.fetch(input, init);
}

export async function ensureHandLandmarkerModel(
  fetchImpl: ModelProbeFetch = defaultModelProbe,
): Promise<void> {
  await ensureModel(fetchImpl, MODEL_PATH, MODEL_MISSING_MESSAGE, MODEL_EXPECTED_BYTES, modelSizeMessage);
  await ensureModel(
    fetchImpl,
    POSE_MODEL_PATH,
    POSE_MODEL_MISSING_MESSAGE,
    POSE_MODEL_EXPECTED_BYTES,
    poseModelSizeMessage,
  );
}

async function ensureModel(
  fetchImpl: ModelProbeFetch,
  path: string,
  missingMessage: string,
  expectedBytes: number,
  sizeMessage: (actualBytes: number) => string,
): Promise<void> {
  let probe: ModelProbeResponse | undefined;
  try {
    probe = await fetchImpl(path, { method: 'HEAD' });
  } catch {
    probe = undefined;
  }
  if (!probe || !probe.ok) throw new Error(missingMessage);

  const contentType = probe.headers?.get('content-type');
  if (contentType && contentType.includes('text/html')) throw new Error(missingMessage);

  const contentLength = probe.headers?.get('content-length');
  const bytes = contentLength ? Number(contentLength) : Number.NaN;
  if (Number.isFinite(bytes) && bytes !== expectedBytes) {
    throw new Error(sizeMessage(bytes));
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
  const { HandLandmarker, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  try {
    const hands = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: MAX_HANDS,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    const pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      outputSegmentationMasks: false,
    });
    return {
      detectForVideo(video: HTMLVideoElement, timestampMs: number): HandLandmarkDetection {
        const handResult = hands.detectForVideo(video, timestampMs);
        const poseResult = pose.detectForVideo(video, timestampMs);
        return {
          ...handResult,
          poseLandmarks: poseResult.landmarks?.[0] ?? [],
        };
      },
      close(): void {
        hands.close();
        pose.close();
      },
    };
  } catch (cause) {
    throw new Error(MODEL_LOAD_MESSAGE, { cause });
  }
}
