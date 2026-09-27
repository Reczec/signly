# Signly recognition contract v1

The implemented boundary is [app/src/contracts/recognition.ts](../app/src/contracts/recognition.ts). RecognitionResult v1 is unchanged. The React/Vite app receives in-process callbacks from local recognition; there is no recognition server or network event transport.

## Results and events

`sign` is a supported word (including multiword labels such as `thank you`) or null. In explicit legacy mode it may be a letter. `confidence` is a score in [0,1]: softmax for the word model, neighbor-vote fraction for legacy kNN. It is neither measured webcam accuracy nor MediaPipe handedness confidence.

States: `camera_off`, `loading`, `ready`, `no_hand`, `recognizing`, `low_confidence`, `accepted`, `release_required`, `paused`, `error`.

`accepted` and `stable` are true only on the single accepted event. Every start creates a sessionId and every event increases that session's sequence. Append a word only on acceptance and deduplicate by `(sessionId, sequence)`, never by label: the same word may be repeated after release.

Other states have false acceptance flags. Rejected word predictions have `sign:null`; `low_confidence` can retain the model score, or zero when capture quality failed before classification. `release_required` has no new sign; the UI retains the previous decision independently. Error text appears only in the error state. Optional capture-phase and rejection-reason callbacks provide presentation details without changing RecognitionResult.

`timestamp` uses Unix milliseconds; internal capture and inference timing uses a monotonic clock. `latencyMs` measures processing, excluding the intentional capture interval. It is not the full gesture-to-result latency.

## Lifecycle

`createRecognitionEngine()` implements the existing `RecognitionEngine` interface. `start(video, onResult, onLandmarks?)` loads local models, acquires the camera and starts detection. `stop()` cancels initialization/callbacks and closes camera tracks and per-session MediaPipe tasks. The verified ONNX session is shared and cached for the page lifetime. `pause()` preserves preview but suspends classification; `resume()` clears capture history and requires a fresh hand-away interval.

Async inference from stopped or paused sessions cannot emit results into a replacement session. Model/camera errors are reported to the UI and startup promises reject where appropriate. No silent mock or legacy fallback is allowed.

`getSupportedSigns()` is empty before model loading and returns the loaded model's supported labels afterwards. UNKNOWN is not a label; uncertain predictions are rejected.

`LandmarkFrame` contains original unmirrored camera coordinates, up to two hands and optional pose points. CSS mirrors video and overlay together. Word recognition supports both hands; the one-hand restriction belongs only to the explicit legacy classifier.

## Current word acceptance

- Live vocabulary: 12 enabled words listed in the [README](../README.md), input `[32,162]`, preprocessing `signly-sequence-v1`.
- Model hash, label order, tensor version and the frozen research thresholds are verified against embedded ONNX metadata. The frozen artifact uses 0.90; the live loader explicitly uses 0.80 and excludes work from supported labels and accepted predictions, documented in [live policy](LIVE_POLICY_12_WORDS.md).
- Capture requires at least six frames over 600 ms, ending on hand withdrawal or after 2.6 seconds. Short occlusions remain masked. Observation gaps over 250 ms interrupt capture; insufficient hand/pose visibility is rejected.
- An accepted or rejected attempt requires 600 ms of continuously observed hand absence before another attempt. Pauses, gaps and visible hands do not count as release.
- Clear/backspace affect the word builder only. They do not reset the detector or manufacture recognition events.

The old static kNN/stabilizer remains available through `?mode=legacy`, with its own thresholds and release policy. It does not affect normal word recognition. Historical task ownership and A/B/C milestones are preserved in the original Laptop A/B planning prompts, not in the current runtime contract.
