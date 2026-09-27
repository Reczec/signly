# Webcam usability adjustment — 2026-09-27

**Historical first adjustment:** the subsequent [12-word live policy](LIVE_POLICY_12_WORDS.md) uses 0.80, excludes work and extends maximum capture to 2.6 seconds. The measurements below belong to the earlier 0.85 policy.

Following a user report that correct-looking gestures were rarely accepted, the live loader now uses a confidence threshold of **0.85**, down from the frozen research model's **0.90**. Margin remains zero. The ONNX weights, labels, checksum, embedded contract, preprocessing and RecognitionResult v1 are unchanged. The standalone `createWordRecognitionModel()` factory still defaults to metadata thresholds for reproducible research; the application's `loadWordRecognitionModel()` explicitly selects the webcam policy. Model integrity is verified before either policy runs.

This is a usability tradeoff, not improved classifier accuracy. The already-recorded **validation** grid in `research/word-signs/reports/expansion/candidate-13.json` gives:

| Confidence | Target clips accepted / 14 | Wrong target acceptances | Non-target false acceptances / 84 |
|---|---:|---:|---:|
| 0.90, frozen research | 5 | 0 | 5 |
| 0.85, live app | 7 | 1 | 11 |
| 0.80, considered only | 7 | 1 | 15 |

0.85 has the same target coverage as 0.80 in this small sample with fewer non-target false acceptances. No test-set evaluation was run or used for this change. These calibration-set counts do not measure webcam performance. The historical report's acceptance/test results describe the frozen 0.90 policy and must not be presented as results for the current app.

Capture now allows at least six observed frames over at least **600 ms**, instead of ten frames over 900 ms. This removes an unconditional rejection of shorter gestures before the model is called. The maximum capture duration (1.8 seconds), end-of-sign detection, landmark quality checks, observation-gap rejection and continuous hand-release requirement remain unchanged. Shorter input is processed by the same timestamp-based encoder. Its effect on human webcam accuracy remains unmeasured.

An optional presentation callback carries a typed rejection reason separately from RecognitionResult. The result card distinguishes a short capture, interrupted camera observations, insufficient visible landmarks and low model confidence. The reason remains visible while waiting for hand release and clears on the next attempt or lifecycle transition. Rejected predictions never append a token.

Validation: `npm.cmd test` passed **175 tests across 17 files**. Regression coverage checks the actual live loader's relaxed acceptance versus the metadata policy, complete 600 ms signs, rejection of incomplete/sparse sequences, continued release protection, engine rejection reporting, and retention/clearing of rejection feedback in the app. The production build (`npm.cmd run build`) and whitespace check also passed. Model and metadata SHA-256 values still match the frozen artifacts.

Next practical step: reload the app and try several known signs, lowering both hands between attempts. Record whether each attempt is correct, wrong, or rejected; for rejection, use the displayed reason. No training recording or upload is needed. If camera-gap messages dominate, investigate live processing cadence before changing thresholds again. If confidence rejection dominates despite complete, visible captures, improve public training coverage and live/video sequence alignment before expanding the vocabulary. The existing 19-word candidate failed validation and should not replace the 13-word model merely to increase the displayed count.
