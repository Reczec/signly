import type { RecognitionResult } from '../contracts/recognition'

/** Terminal events, including asynchronous runtime errors, permit a new start. */
export function isTerminalResult(result: RecognitionResult): boolean {
  return result.state === 'error' || result.state === 'camera_off'
}
