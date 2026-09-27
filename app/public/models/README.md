# Local recognition assets

## Google MediaPipe Hand Landmarker

- File: `hand_landmarker.task`
- Source: [Google-hosted Hand Landmarker model, float16, version 1](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task)
- Upstream project and documentation: [Google MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
- Attribution: Google / MediaPipe contributors; provided under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- Format: MediaPipe Tasks `.task` model bundle; the source release path identifies the `float16/1` variant.
- Expected file length: **7,819,105 bytes**. Matching this length is a basic completeness check, not proof of integrity.
- Browser runtime: `@mediapipe/tasks-vision` pinned to **0.10.35**; inference uses the CPU delegate.

The shared model is kept in this directory. The application loads it from `/models/hand_landmarker.task`; it must not fetch the model from a runtime CDN.

From `app`, run `npm.cmd run assets` after installing the locked dependencies. It copies the complete installed package's `wasm` directory to `public/wasm` using local files only. Generated WASM files are ignored by Git. The script warns when the model is absent or its length differs and never downloads a replacement automatically.

Hand Landmarker estimates landmarks. The separate temporal ONNX model below classifies isolated ASL words.

## Explicit legacy classifier

The optional `asl-knn-v1.json` classifier is used only by `?mode=legacy`. Its metadata declares a model/schema version, a separate `preprocessingVersion`, training provenance, provisional status, and enabled letters. Store only independent training-hold prototypes; never include validation or final-test samples as deployed prototypes.

The legacy collector, trainer and classifier share their own preprocessing version. Its transform uses 21 image landmarks, converts y to width units with `height / width`, subtracts the wrist, and divides coordinates by the mean wrist-to-MCP distance for indices 5, 9, 13, and 17. Any change requires a new preprocessing version and compatible training data/model. Word recognition never silently falls back to this classifier.

An initial A/B/C classifier trained from the demonstrator's samples is provisional. A candidate or neighbor-vote score does not establish accuracy or enable a letter for the main application before the human acceptance check.

## MediaPipe Pose Landmarker

- File: `pose_landmarker_lite.task`
- Source: Google-hosted Pose Landmarker Lite, float16, version 1.
- Runtime path: `/models/pose_landmarker_lite.task`.
- Expected file length: **5,777,746 bytes**.

The temporal word model consumes two hands plus upper-body pose. The browser loads this local pose model next to the hand model; it must not fetch a pose model from a runtime CDN.

## Signly temporal word model

- File: `word-classifier-v1.onnx`
- Labels: `word-classifier-v1.labels.json`
- Runtime path: `/models/word-classifier-v1.onnx`.
- Preprocessing: `signly-sequence-v1`, shape `[32, 162]`.
- Vocabulary: `drink`, `help`, `yes`, `no`, `thank you`, `sad`, `cold`, `take`, `give`, `change`, `work`, `day`, `white`.
- Parameters: 135,629. ONNX opset 17; label metadata schema 2.
- Frozen research acceptance: confidence >= 0.90; explicit margin >= 0.00. The live app explicitly uses 0.85 for usability; see [webcam tuning](../../../docs/WEBCAM_TUNING.md) for its separate validation evidence.
- Metadata binds model SHA-256, label order, thresholds and preprocessing to an embedded ONNX contract.

This experimental isolated-word model was frozen through `research/word-signs/expansion.py`. The app uses it only for local browser inference through ONNX Runtime Web and does not report live accuracy. See [the expansion report](../../../docs/WORD_EXPANSION_REPORT.md) for exact data counts, weak held-out support, high rejection, final test results, reproduction and rollback information. Do not deploy the validation-only `train.py` output directly; runtime requires the frozen schema-2 export.

The subsequent [15–27 word experiment](../../../docs/WORD_EXPANSION_V3_REPORT.md) did not pass the validation gates. Its models are research artifacts only; the live vocabulary remains these thirteen words.

ONNX Runtime Web wasm is served locally from `app/public/ort/`. The runtime files come from the locked `onnxruntime-web` package; the app must not use a CDN for inference.
