# Local recognition assets

## Google MediaPipe Hand Landmarker

- File: `hand_landmarker.task`
- Source: [Google-hosted Hand Landmarker model, float16, version 1](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task)
- Upstream project and documentation: [Google MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
- Attribution: Google / MediaPipe contributors; provided under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- Format: MediaPipe Tasks `.task` model bundle; the source release path identifies the `float16/1` variant.
- Expected file length: **7,819,105 bytes**. Matching this length is a basic completeness check, not proof of integrity.
- Browser runtime: `@mediapipe/tasks-vision` pinned to **0.10.35**; inference uses the CPU delegate.

Download this model once to this directory and include it in the shared repository so Laptop B can use the same local asset. The application loads it from `/models/hand_landmarker.task`; it must not fetch the model from a runtime CDN.

From `app`, run `npm.cmd run assets` after installing the locked dependencies. It copies the complete installed package's `wasm` directory to `public/wasm` using local files only. Generated WASM files are ignored by Git. The script warns when the model is absent or its length differs and never downloads a replacement automatically.

Hand Landmarker estimates hand landmarks. It is **not an ASL letter classifier**. No trained Signly ASL model or validated supported-letter list is included in this bootstrap.

## Future Signly classifier format

The planned local classifier file is `asl-knn-v1.json`. Its metadata must declare a model/schema version, a separate `preprocessingVersion`, training provenance, provisional status, and the enabled letters that passed live validation. Store only independent training-hold prototypes; never include validation or final-test samples in a deployed model.

The recognition implementation must assign and share one preprocessing version between collector, trainer, and live inference. The planned transform uses 21 image landmarks, converts y to width units with `height / width`, subtracts the wrist, and divides all coordinates by the mean wrist-to-MCP distance for indices 5, 9, 13, and 17. It preserves orientation and depth. Any change to that transform requires a new preprocessing version and compatible training data/model.

An initial A/B/C classifier trained from the demonstrator's samples is provisional. A candidate or neighbor-vote score does not establish accuracy or enable a letter for the main application before the human acceptance check.
