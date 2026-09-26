import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_DOWNLOAD_URL,
  MODEL_PATH,
  MODEL_REPOSITORY_PATH,
  WASM_BASE_PATH,
  createHandLandmarker,
  ensureHandLandmarkerModel,
} from './landmarker';

const { forVisionTasks, createFromOptions } = vi.hoisted(() => ({
  forVisionTasks: vi.fn(),
  createFromOptions: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks },
  HandLandmarker: { createFromOptions },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hand landmarker local assets', () => {
  it('accepts the model when the local path answers successfully', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: (name: string) => (name === 'content-length' ? '7819105' : null) },
    })) as unknown as typeof fetch;

    await expect(ensureHandLandmarkerModel(fetchImpl)).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith(MODEL_PATH, { method: 'HEAD' });
  });

  it('treats an html fallback response as a missing model', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
    })) as unknown as typeof fetch;

    await expect(ensureHandLandmarkerModel(fetchImpl)).rejects.toThrow(MODEL_REPOSITORY_PATH);
    await expect(ensureHandLandmarkerModel(fetchImpl)).rejects.toThrow(MODEL_DOWNLOAD_URL);
  });

  it('rejects a model file whose byte count is wrong', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: (name: string) => (name === 'content-length' ? '620' : null) },
    })) as unknown as typeof fetch;

    await expect(ensureHandLandmarkerModel(fetchImpl)).rejects.toThrow('620 bytes');
    await expect(ensureHandLandmarkerModel(fetchImpl)).rejects.toThrow('7,819,105 bytes');
  });

  it('reports the manual placement path when the model is missing or unreachable', async () => {
    const missing = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    await expect(ensureHandLandmarkerModel(missing)).rejects.toThrow(MODEL_REPOSITORY_PATH);
    await expect(ensureHandLandmarkerModel(missing)).rejects.toThrow(MODEL_DOWNLOAD_URL);

    const unreachable = vi.fn(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    await expect(ensureHandLandmarkerModel(unreachable)).rejects.toThrow(MODEL_REPOSITORY_PATH);
  });

  it('fails with local wasm instructions when the wasm fileset cannot be loaded', async () => {
    forVisionTasks.mockRejectedValue(new Error('loader missing'));

    await expect(createHandLandmarker()).rejects.toThrow(WASM_BASE_PATH);
    await expect(createHandLandmarker()).rejects.toThrow('npm.cmd run assets');
  });

  it('creates the hand landmarker from the local wasm and model with up to two hands', async () => {
    forVisionTasks.mockResolvedValue({
      wasmLoaderPath: '/wasm/vision_wasm_internal.js',
      wasmBinaryPath: '/wasm/vision_wasm_internal.wasm',
    });
    createFromOptions.mockResolvedValue({ detectForVideo: vi.fn(), close: vi.fn() });

    const detector = await createHandLandmarker();

    expect(forVisionTasks).toHaveBeenCalledWith(WASM_BASE_PATH);
    expect(createFromOptions).toHaveBeenCalledTimes(1);
    const [fileset, options] = createFromOptions.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(fileset).toEqual({
      wasmLoaderPath: '/wasm/vision_wasm_internal.js',
      wasmBinaryPath: '/wasm/vision_wasm_internal.wasm',
    });
    expect(options).toMatchObject({
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
    });
    expect(typeof detector.detectForVideo).toBe('function');
    expect(typeof detector.close).toBe('function');
  });

  it('wraps model initialization failures with the repository path', async () => {
    createFromOptions.mockRejectedValue(new Error('invalid model bundle'));

    await expect(createHandLandmarker()).rejects.toThrow(MODEL_REPOSITORY_PATH);
  });
});
