import type {
  RecognitionEngine,
  RecognitionResult,
  RecognitionState,
} from '../contracts/recognition';

const SUPPORTED_SIGNS: readonly string[] = Object.freeze([]);
const BOOTSTRAP_ERROR =
  'Recognition is not available in this bootstrap yet. Connect the local ' +
  'camera/Hand Landmarker pipeline and a validated kNN model first; no signs are enabled.';

let nextSession = 0;

interface Session {
  id: string;
  sequence: number;
  onResult: (result: RecognitionResult) => void;
}

/**
 * Honest bootstrap implementation of the frozen UI boundary.
 * It deliberately opens no camera and never emits ready, landmarks, or predictions.
 * Replace this implementation with the measured local recognizer in the next milestone.
 */
export function createRecognitionEngine(): RecognitionEngine {
  let session: Session | undefined;

  function emit(current: Session, state: RecognitionState, error: string | null = null) {
    current.onResult({
      schemaVersion: 1,
      sessionId: current.id,
      sequence: ++current.sequence,
      sign: null,
      confidence: 0,
      stable: false,
      accepted: false,
      timestamp: Date.now(),
      state,
      handsDetected: 0,
      latencyMs: 0,
      error,
    });
  }

  function stop() {
    const stopped = session;
    session = undefined;
    if (stopped) emit(stopped, 'camera_off');
  }

  return {
    async start(_video, onResult, _onLandmarks) {
      stop();
      const current: Session = {
        id: `recognition-${Date.now()}-${++nextSession}`,
        sequence: 0,
        onResult,
      };
      session = current;
      emit(current, 'loading');

      // Keep initialization asynchronous so stop/unmount and replacement starts
      // already have the same cancellation behavior as the future real engine.
      await Promise.resolve();
      if (session !== current) {
        throw new DOMException('Recognition initialization was stopped or replaced.', 'AbortError');
      }

      emit(current, 'error', BOOTSTRAP_ERROR);
      throw new Error(BOOTSTRAP_ERROR);
    },
    // There is no running recognizer to pause or resume in this bootstrap.
    pause() {},
    resume() {},
    stop,
    getSupportedSigns: () => SUPPORTED_SIGNS,
  };
}
