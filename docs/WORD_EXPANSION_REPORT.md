# Signly word-recognition expansion — 2026-09-27

**Later live-app adjustment:** [Webcam tuning](WEBCAM_TUNING.md) documents the current 0.85 live acceptance threshold and 600 ms minimum capture. The frozen research artifact and results below retain their original 0.90 policy; they are not acceptance metrics for the adjusted app.

The shipped model supports **13 experimental isolated ASL words**: drink, help, yes, no, thank you, sad, cold, take, give, change, work, day, white. All original twelve labels remain. The architecture and RecognitionResult v1 boundary remain intact. This is not continuous translation.

Work stayed on `feature/word-recognition-expansion`, based on `e9e32c0`. No commit, push, branch switch or merge was performed. The original twelve-word model is preserved locally in ignored `research/word-signs/artifacts/expansion/baseline.onnx`; Git also retains the complete baseline. There is no automatic runtime fallback. A/B/C remains available only through `?mode=legacy`.

**Selection evidence.** The declared candidates plus the first 200 official WLASL glosses yielded 4,044 annotated candidates, 2,045 obtainable full-file candidates, and 870 compatible with frozen signer/source ownership. Twenty labels initially met the modest minimum of four train, one validation and one test clip. One cross-label duplicate (`wlasl-32257`, “last”, identical to baseline `wlasl-05743`, “before”) was excluded; this left nineteen eligible labels and 130 unique target clips. Another 84 real, non-target validation clips were reserved for rejection calibration. All 214 decoded and produced landmarks. This minimum is prototype coverage, not evidence of production robustness.

The publicly available [Voxel51 WLASL mirror](https://huggingface.co/datasets/Voxel51/WLASL) supplies bytes only. Official WLASL metadata supplies labels, signers and splits. Downloads used mirror revision `3cf8daaac08088798f539d62fa511028bf5e6fd0`, verified git/LFS object hashes and video SHA-256. No login, cookies or access-control workaround was used. Only whole-file annotations were selected to avoid ambiguous video trimming. Mirror verification does not prove every original URL is still available. See the original dataset's C-UDA terms; this task did not relicense the data.

All baseline signer/source assignments and baseline validation/test clip membership were frozen. New identities were assigned deterministically from metadata, test then validation then train; conflicting clips were discarded rather than moved between official splits. Exact duplicate bytes are excluded even within a split. Selection used availability and validation outcomes, never new test predictions. Near-duplicates with different encodings and incorrect upstream identity annotations remain possible.

| Stage | Validation correct | Accuracy | Macro F1 | Original 13 validation clips correct | Decision |
|---|---:|---:|---:|---:|---|
| Original 12 | 9/13 | 69.23% | 0.6722 | 9 | Regression reference |
| Retrained 12 | 10/13 | 76.92% | 0.7361 | 10 | Passed |
| 13, adding white | 11/14 | 78.57% | 0.7564 | 10 | Selected |
| 19 | 13/21 | 61.90% | 0.5737 | 9 | Rejected |

The promotion rule was declared before training: overall validation accuracy at least baseline, no loss of correct baseline validation predictions, and macro F1 at least baseline minus 0.02. The largest passing stage won. Nineteen failed, so thirty to fifty were not forced. More labels without stronger signer-disjoint public coverage would make the demo less credible. The nineteen-label experiment also included what, before, woman, fish, lose and pizza; these six are **not** supported by the shipped model.

**Final dataset.** Counts are clips; parentheses show distinct signers within each class/split. Across classes there are 20 train, 8 validation and 9 test signers, with zero cross-split overlap.

| Word | Train | Validation | Test |
|---|---:|---:|---:|
| drink | 4 (3) | 1 (1) | 1 (1) |
| help | 5 (2) | 1 (1) | 2 (2) |
| yes | 5 (5) | 2 (2) | 1 (1) |
| no | 5 (5) | 1 (1) | 1 (1) |
| thank you | 4 (4) | 1 (1) | 1 (1) |
| sad | 4 (4) | 1 (1) | 1 (1) |
| cold | 4 (4) | 1 (1) | 1 (1) |
| take | 5 (3) | 1 (1) | 1 (1) |
| give | 4 (3) | 1 (1) | 2 (2) |
| change | 6 (3) | 1 (1) | 1 (1) |
| work | 5 (5) | 1 (1) | 1 (1) |
| day | 4 (4) | 1 (1) | 1 (1) |
| white | 4 (2) | 1 (1) | 1 (1) |
| Total | **59** | **14** | **15** |

Train class counts range from four to six, without oversampling or copied clips. Mean detected hand-frame fractions are 0.7190/0.6086/0.6437 for train/validation/test; pose fractions 1.0000/0.9969/0.9984; two-hand fractions 0.2813/0.1712/0.2653. The per-clip report records wrist movement and two-hand visibility as measured proxies, not linguistic judgments. Five original training clips have hand visibility below the live 0.35 quality gate; they remain documented baseline data, not silently removed after viewing test results. Some classes have only two training signers.

**Final evaluation after freezing.** Vocabulary, checkpoint, thresholds, label order and artifact hashes were written to `research/word-signs/reports/expansion/frozen.json` before the final evaluator opened test tensors. Test evaluation is a separate command; repeated evaluation and further experiments in this version are blocked. Historical baseline test results had already been published before this task, so the reused fourteen baseline clips are a frozen reevaluation, not a completely fresh independent test set.

| Split | Ungated accuracy | Macro F1 | Gate accepted | Wrong accepted | Rejected |
|---|---:|---:|---:|---:|---:|
| Train | 58/59, 98.31% | 0.9845 | 41 | 0 | 18 |
| Validation | 11/14, 78.57% | 0.7564 | 5 | 0 | 9 |
| Final test | 12/15, 80.00% | 0.7436 | 5 | 0 | 10 |

Validation confusions: yes→no, take→no, give→white, once each. Final test confusions: drink→no, take→work, give→cold, once each. Full matrices and per-class precision/recall/F1 are in `reports/expansion/final-evaluation.json`. The historical baseline test score was 13/14, 92.86%; the new ungated test result is lower. It was not used to revise the frozen decision. These tiny denominators do not establish a reliable improvement in generalization, and none of these metrics measures webcam accuracy.

**Rejection.** The selected confidence threshold is **0.90**, replacing 0.65; the explicit margin threshold is **0.00**, replacing 0.15. At confidence 0.90 the top-two margin is already at least 0.80, so an extra 0.15 requirement is redundant. A fixed grid was evaluated on validation only, maximizing accepted target coverage with zero wrong target acceptances and at most 10% false acceptance on the non-target pool. For the final model, the old thresholds accepted 9/14 target clips with one error and falsely accepted 23/84 non-target clips. The selected gate accepts 5/14 targets with no observed error and falsely accepts 5/84 non-targets (5.95%). This is calibration-set performance, not a separate open-set test. High rejection is a real limitation: 9/14 validation and 10/15 final test clips are rejected. No semantic UNKNOWN class was trained. Rejection emits no word; confidence is a softmax score, not calibrated correctness probability.

**Model and preprocessing.** The unchanged temporal Conv1D architecture has **135,629 parameters**, three convolution blocks (64/128/128 channels), global pooling and a 64-unit head, exported with ONNX opset 17. Seed 20260926, batch 8, Adam, validation-loss early stopping with patience 30: best epoch 26 of 56. Existing Gaussian input perturbation (standard deviation 0.01) is training augmentation only; no synthetic videos, extra clip records, or fabricated production landmark dataset was created.

MediaPipe 0.10.35 extracts up to two hands and one pose, sampled around 15 Hz offline. The browser processes at most 10 Hz. Both call the exact same TypeScript `encodeSequence`: `signly-sequence-v1`, `[32,162]`, timestamp-nearest resampling with observations farther than 120 ms masked. The encoder orders hands using handedness plus wrist continuity. Eight upper-body pose points are shoulder-centered/scaled; hand shape is wrist-relative with aspect-ratio correction. Hand depth is local to the hand; pose depth is not combined with it. Missing hand/body relationships have explicit masks. Input coordinates remain unmirrored; only the webcam display is mirrored. No separate face detector or face features were added.

PyTorch→Python ONNX maximum absolute logit difference: **1.90735e-6**, with identical predictions across all 88 final clips. Browser WASM→Python ONNX on one real validation sequence: **1.43051e-6**, same class. Re-encoding its raw landmarks in the browser yields **zero Float32 difference** from training input. This checks numerical compatibility, not identical landmark detections on every browser/device. A separate frozen-model reproduction produced the exact same SHA-256:

`f81951819621c1dd3201989abfd32e91a1bac8fc790ad05ce83d948b9f83ca61`

Runtime verifies this hash and the label order, sequence version/shape and thresholds embedded inside ONNX, rejects malformed metadata/nonfinite tensors/logits, and never falls back to letters on failure. Models and WASM remain local. The shared ONNX session is cached for the page lifetime; camera and MediaPipe tasks are released per session.

**Live/UI changes.** Capture now ends after a complete sign and 250 ms of hand absence, or at 1.8 seconds. It requires at least ten observations and 900 ms; short occlusions remain masked samples. Observation gaps above 250 ms reject the window. Rearming requires 600 ms continuously observed hand absence; pause/resume also requires release. Pending results/errors cannot change a paused, stopped, or replaced session. Partial MediaPipe initialization and cleanup errors cannot leave the camera running. Restart UI state is corrected. Accepted/rejected outcomes remain readable while waiting for release. `RecognitionResult` fields and state union are unchanged; an optional local phase callback distinguishes recording from analysis.

Vocabulary chips and the current-token tile fit content, keep “thank you” together and wrap their surrounding layout. Result text fits words. Normal mode says “Unterstützte Wörter” and “Modell-Konfidenz”; kNN wording is confined to explicit legacy mode. Browser layout checks used 50 clearly labeled fixture words at 320, 375 and 1200 pixels; no word elements clipped. The fixture is not a claim of 50 supported signs. The optional `?debug=1` panel was not added; separate development-only parity/layout pages provide verification without adding production UI.

**Run the app** (PowerShell):

```powershell
# From the repository root:
Set-Location app
npm.cmd ci
npm.cmd run assets
npm.cmd run dev
```

Open the localhost URL printed by Vite. `npm.cmd test` and `npm.cmd run build` run the checks. Node 24 is required; the lockfile pins npm dependencies. The assets command copies local installed WASM packages, without a runtime CDN.

**Reproduce the frozen model without reopening test outcomes:**

```powershell
# Run from the repository root.
# Existing environment can be reused. For a new environment, use Python 3.12:
py -3.12 -m venv research/word-signs/.venv
& research/word-signs/.venv/Scripts/python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r research/word-signs/requirements-lock.txt
$env:SIGNLY_NODE = (Get-Command node.exe).Source
$env:MPLCONFIGDIR = Join-Path (Get-Location) 'research/word-signs/cache/matplotlib'
& research/word-signs/.venv/Scripts/python.exe research/word-signs/expansion.py restore
& research/word-signs/.venv/Scripts/python.exe research/word-signs/expansion.py extract
& research/word-signs/.venv/Scripts/python.exe research/word-signs/expansion.py reproduce
& research/word-signs/.venv/Scripts/python.exe -m unittest discover -s research/word-signs -p test_expansion.py -v
```

`restore` checks pinned clip bytes; public URLs may later disappear. `reproduce` trains on the frozen train/validation inputs, exports `artifacts/expansion/reproduced.onnx`, and requires an exact hash match. It does not overwrite the shipped model. The experiment actually used `prepare → extract → experiment → freeze → final`; the existing frozen reports intentionally prevent restarting that selection or repeating its final test. `train.py` now evaluates train/validation only and cannot accidentally overwrite the historical test report. For new model-selection work, create a new experiment version and predeclare its evaluation protocol.

For browser parity, copy `research/word-signs/artifacts/expansion/browser-parity.json` into `app/public/verification/browser-parity.json`, start Vite, and open `/scripts/browser-parity.html`. Click “Run parity check”. Remove that temporary copied fixture before building a release. `/scripts/ui-verification.html` exercises the word layout. Neither page is a production build entry. Raw videos, landmarks/features, the Python environment, checkpoints and temporary verification data remain ignored.

**Separate quality audit against e9e32c0.** Reviewed runtime/UI/research diffs and new files after implementation, checked frozen artifacts, official annotations, cross-split signer/source/hash separation, calibration membership, and test-loader guards. Found and fixed the restart UI-state race, cleanup continuation after native close errors, a 320-pixel horizontal overflow and text-file line-ending damage. Regression coverage checks those lifecycle cases, stale promise resolutions/rejections, continuous release, capture interruption, metadata/hash/label mismatch, multiword tokens, expanded rendering, and explicit legacy behavior. No new cloud inference, runtime CDN, API key, tracked raw video/cache/environment or secret was found. Known residuals: tiny support, imperfect upstream identities/labels, training/live framing and duration differences, left-handed and lighting variability, five poor-visibility training clips, and limited open-set evidence. Human webcam recognition, end-to-end webcam latency, and other browsers/devices remain unverified.

The final verification results and exact changed-file inventory are recorded in `research/word-signs/reports/expansion/verification.json` and `changed-files.json`.

**Human demo check (not training data).** Start with hands out of frame and shoulders visible. Show each of the thirteen supported signs three times, noting correct/incorrect/rejected separately. Keep one sign visible to confirm only one token is added; lower both hands until “Bereit” before repeating. Test “thank you” as one token and delete it once. Pause during capture, resume with hands still visible, and confirm no delayed acceptance. Stop/restart the camera twice and test a denied camera permission followed by retry. Try several unsupported signs and record false acceptance. Use consistent light and a second signer if available; do not report confidence as accuracy or upload/record personal training footage.
