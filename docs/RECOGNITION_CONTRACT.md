# Signly recognition contract v1

Planning artifact; no application has been implemented yet.

The runtime is a React + Vite + TypeScript browser app. MediaPipe Hand Landmarker extracts landmarks locally; a local kNN classifier recognizes isolated ASL fingerspelling letters. There is no recognition server and no network event transport. This object passes through an in-process callback.

```json
{
  "schemaVersion": 1,
  "sessionId": "demo-session-1",
  "sequence": 42,
  "sign": "A",
  "confidence": 0.857143,
  "stable": true,
  "accepted": true,
  "timestamp": 1790416800000,
  "state": "accepted",
  "handsDetected": 1,
  "latencyMs": 42,
  "error": null
}
```

`sign`: supported uppercase letter or null. `confidence`: winning neighbor vote fraction in [0,1], a heuristic match score, not calibrated correctness probability. Do not substitute MediaPipe handedness confidence. `timestamp`: Unix milliseconds from Date.now(). Inference and stabilization use performance.now() internally. `latencyMs`: current inference/classification duration, excluding the intentional stability hold.

`state`: one of `camera_off`, `loading`, `ready`, `no_hand`, `recognizing`, `low_confidence`, `accepted`, `release_required`, `paused`, `error`.

`stable` is true only on an accepted event in v1. `accepted` is a one-event pulse, not a persistent status. Each start creates a new sessionId; sequence increases on every result in that session. Append only when accepted is true and that (sessionId, sequence) has not been processed. Repeated letters are allowed after release; do not deduplicate by letter value.

Outside acceptance, stable and accepted are false. Unsupported/unknown/no-hand/paused/error results have sign:null and confidence:0. Recognizing results may carry a tentative sign and score, but must never update transcript or large accepted subtitle. release_required has sign:null; the UI preserves its previously accepted subtitle independently. error is a human-readable string only in error state; otherwise null. Two detected hands produce low_confidence, sign:null, no acceptance, and UI guidance to show one hand.

Initial UI state is camera_off with null sign, zero score and false flags. start emits loading, then ready with null sign and false flags; a successful first start is armed immediately. Resume requires a new release interval. Clear only empties displayed text/subtitle; retain the processed-event IDs until the session changes.

## Fixed TypeScript boundary

Laptop A creates `app/src/contracts/recognition.ts` during bootstrap. Freeze it before Laptop B branches.

```ts
export type RecognitionState =
  | 'camera_off' | 'loading' | 'ready' | 'no_hand'
  | 'recognizing' | 'low_confidence' | 'accepted'
  | 'release_required' | 'paused' | 'error';

export interface RecognitionResult {
  schemaVersion: 1;
  sessionId: string;
  sequence: number;
  sign: string | null;
  confidence: number;
  stable: boolean;
  accepted: boolean;
  timestamp: number;
  state: RecognitionState;
  handsDetected: number;
  latencyMs: number;
  error: string | null;
}

export interface LandmarkFrame {
  width: number;
  height: number;
  hands: {
    handedness: 'Left' | 'Right';
    landmarks: { x: number; y: number; z: number }[];
  }[];
}

export interface RecognitionEngine {
  start(
    video: HTMLVideoElement,
    onResult: (result: RecognitionResult) => void,
    onLandmarks?: (frame: LandmarkFrame) => void
  ): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  getSupportedSigns(): readonly string[];
}
```

`app/src/recognition/index.ts` exports `createRecognitionEngine(): RecognitionEngine`. start owns camera acquisition/model loading/inference; stop releases tracks, callbacks, animation timers and model resources. pause keeps preview but stops classification; resume clears history and requires a fresh hand-away interval. Errors emit a result and reject the start promise where appropriate; UI handles both without duplicate messages. Protect asynchronous initialization against stop/unmount races. No automatic mock fallback.

getSupportedSigns() excludes the internal UNKNOWN rejection class. Before model loading it returns an empty list; after loading it returns only enabled, validated letter labels.

Overlay coordinates are original unmirrored camera coordinates. Mirror video and canvas together with CSS only. The MVP uses the physical right hand; verify handedness mapping on the actual unmirrored input rather than assuming a legacy MediaPipe convention. Detect up to two hands; only classify a single supported hand.

## Acceptance behavior

- Initial vocabulary: A B C. Required ten: A B C F I L O V W Y. Preferred fifteen: A B C D E F H I L O P U V W Y. Publish only labels that passed the live acceptance check.
- Confidence: k=7 neighbor votes, at least 6/7 for a candidate. Add class-distance and runner-up separation rejection. Unknown is not a sign.
- Keep the last 1000 ms of observations. Require at least five eligible observations of the same label spanning at least 600 ms, at least 80% agreement across all observations in the window, and a passing current observation. Null/low confidence observations count against agreement. No stale acceptance after frame gaps longer than 400 ms. This window also permits the measured fallback of 5 inferences per second.
- Require stable pose as well: the mean feature vectors of consecutive populated 200 ms bins must remain inside a movement tolerance calibrated on validation holds. Empty bins alone do not cause rejection; the 400 ms gap rule still applies. This reduces acceptance while moving through a supported handshape.
- After one acceptance, require no detected hands continuously for 1000 ms before any next letter. Low confidence, unsupported poses, pause, and two hands do not count as release. This is a deliberately constrained isolated-letter interaction.
- Clear pending history on release, pause, stop, model change, and camera loss. Keep the displayed transcript separate from recognition history.

## Ownership

Laptop A: app/src/recognition, app/src/collector, app/collector.html, app/scripts, app/public/models, generated app/public/wasm, app/data, recognition tests, package files, bootstrap config, this contract.

Laptop B: app/src/ui, app/src/mocks, app/src/App.tsx, app/src/App.css, app/src/index.css, README.md, docs/demo.md, docs/results.md.

app/src/main.tsx and build configuration are frozen after A's bootstrap. A integrates main; both use feature branches. B never imports MediaPipe or creates another camera stream. Dependency changes go through A.
