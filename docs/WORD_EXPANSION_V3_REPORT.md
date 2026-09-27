# Vocabulary expansion v3 — 2026-09-27

**Decision: retain the working 13-word model.** Four separately trained candidates with 15, 19, 23 and 27 words failed the preregistered validation gates. No candidate was copied into the app. The more permissive live policy confirmed by the user remains active: confidence 0.85, minimum capture 600 ms. This experiment made no UI or recognition-runtime changes.

Live vocabulary: **drink, help, yes, no, thank you, sad, cold, take, give, change, work, day, white**. The model still has 135,629 parameters and SHA-256 `f81951819621c1dd3201989abfd32e91a1bac8fc790ad05ce83d948b9f83ca61`. Its metadata/embedded research threshold remains 0.90; the explicit live policy is 0.85. V3's frozen decision records the live evaluation policy, not a rewritten model contract.

## Public data and split boundaries

The review was broadened from the first 200 to all **2,000 official WLASL glosses**. The pinned public [Voxel51 mirror](https://huggingface.co/datasets/Voxel51/WLASL/tree/3cf8daaac08088798f539d62fa511028bf5e6fd0) contains 11,878 matching whole-file annotations. All v2 signer and source assignments, including previously unused assignments, remain frozen. There are 4,506 compatible whole-file records after known duplicate exclusion; only 27 labels satisfy the modest class-coverage requirements while preserving the fixed negative validation set. This is a limit of this particular source and split policy, not a claim that public ASL data is exhausted.

The [official metadata documentation](https://github.com/dxli94/WLASL) and [preprocessing code](https://github.com/dxli94/WLASL/blob/master/start_kit/preprocess.py) distinguish source-video frame ranges and prepared clips. V3 conservatively continues to use whole-file annotations; it does not guess whether an unfamiliar video has already been trimmed. Labels, signer IDs and splits come from official metadata, not mirror labels.

New labels were ranked **before any training** by validation support, number of training signers, training support, then lexical order. The fixed order was: cake, what, before, compare, woman, grapes, transfer, when, add, fish, lose, upset, interest, pizza. These are experimental candidates, **not supported words in the app**.

The largest experiment includes **180 unique videos: 120 train, 30 validation, 30 reserved test**, with 22 / 12 / 12 distinct signers respectively and no overlap between splits. It includes 92 more target clips than the deployed 13-word dataset, of which 50 were newly obtained beyond the previous 19-word experiment. The unchanged negative validation set adds 84 other-sign videos. All 264 public video hashes were reverified against saved manifests and mirror object IDs. No manual recording, fabricated clip, cross-split identity reuse or raw-video tracking was introduced. Exact per-class counts are in `research/word-signs/reports/expansion-v3/availability.json` and appended below.

The initial sandbox prevented new network downloads. That incomplete attempt is retained in `download-attempt-1.json`. Downloads then completed with network permission **before training**; the final manifest contains all 27 planned labels with no download exclusions. The interrupted attempt did not influence vocabulary ordering or training outcomes.

## Validation results and promotion decision

All candidates use the current **0.85 live threshold**, fixed in advance with no threshold search. The architecture, seed, learning rate, batch size, early stopping and existing 0.01 input-noise augmentation are unchanged. Augmentation is applied during training to real tensors; it is not counted as extra data.

| Model | Validation correct | Accuracy | Macro F1 | Correct on original 14 validation clips | Accepted correct / wrong on original clips | False acceptances on 84 other-sign clips |
|---|---:|---:|---:|---:|---:|---:|
| Current 13 | 11/14 | 78.57% | 0.7564 | 11 | 6 / 1 | 11 |
| Candidate 15 | 12/18 | 66.67% | 0.6933 | 10 | 4 / 1 | 12 |
| Candidate 19 | 16/22 | 72.73% | 0.6877 | 10 | 5 / 2 | 11 |
| Candidate 23 | 15/26 | 57.69% | 0.5580 | 9 | 4 / 2 | 8 |
| Candidate 27 | 16/30 | 53.33% | 0.4741 | 7 | 4 / 1 | 7 |

The full validation sets differ because the vocabulary grows; the paired original-14 comparison exposes regression on existing words. Every candidate loses at least one existing correct prediction and accepts fewer existing correct signs. Lower non-target acceptance in the largest models accompanies poorer target recognition and is not sufficient for promotion.

Promotion required: overall accuracy at least baseline; macro F1 no more than 0.02 below baseline; no loss of correct original predictions or accepted-correct original predictions; no additional accepted-wrong original predictions; and no increase in fixed negative false acceptances. The largest passing stage would win. **None passed.** Forcing 40–50 words without adequate class coverage would not address these failures.

Across their complete validation sets, the 15 / 19 / 23 / 27 models accept 5 / 8 / 9 / 7 clips, of which 1 / 2 / 2 / 1 are wrong, and reject 13 / 14 / 17 / 23. There is no trained UNKNOWN class: low scores are rejected. Other-sign videos are calibration/validation evidence, not an independent open-set test or a measurement of arbitrary everyday hand movement.

The repeated confusion is **yes → no** (two validation clips in every candidate). Other recurring errors include **take → no** and **before → day**; the 27-word model also confuses several older signs with **before**. Full confusion matrices, class metrics, learning curves and hashes are preserved in the four `candidate-*.json` reports.

**No final test inference was performed.** Since no candidate qualified, the new test set remains unopened for prediction and the previously reported historical test is not reevaluated. Historical 13-word results remain in the v2 report and describe the old 0.90 research policy. There is no new held-out accuracy claim for v3 and no measured webcam accuracy.

## Architecture, parity and reproducibility

The unchanged temporal network has three Conv1D blocks (64/128/128), temporal pooling, a 64-unit head and one output per class. Input remains `[32,162]`: up to two hands and upper-body pose, without face tracking. Offline MediaPipe extraction and the shared TypeScript encoder retain `signly-sequence-v1`. Only the classifier head's output count changes.

| Candidate | Parameters | Best epoch | PyTorch ↔ ONNX maximum absolute difference |
|---|---:|---:|---:|
| 15 | 135,759 | 42 | 0.0000023842 |
| 19 | 136,019 | 25 | 0.0000023842 |
| 23 | 136,279 | 31 | 0.0000038147 |
| 27 | 136,539 | 32 | 0.0000028610 |

All validation predictions match after ONNX export. All four training runs were reproduced independently with **byte-identical ONNX SHA-256 values** and no test feature reads. New browser numerical-parity testing was unnecessary because no new model or runtime code was deployed; earlier browser parity evidence applies to the unchanged artifact, not to the discarded candidates.

From the repository root, using the existing pinned Python 3.12 environment and Node 24 installation:

```powershell
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
$env:SIGNLY_NODE = 'C:\Program Files\nodejs\node.exe'
& research/word-signs/.venv/Scripts/python.exe research/word-signs/expansion_v3.py restore
& research/word-signs/.venv/Scripts/python.exe research/word-signs/expansion_v3.py extract
& research/word-signs/.venv/Scripts/python.exe research/word-signs/expansion_v3.py reproduce
```

`restore` verifies saved public videos and restores the local pose cache; `extract` processes development clips only; `reproduce` reruns the four fixed train/validation experiments and verifies exact export hashes. Dependencies are pinned in `requirements-lock.txt`. On a new installation, create a Python 3.12 environment and install that lock file using the PyTorch CPU wheel index for `torch==2.6.0+cpu`. The app's locked Node dependencies and local MediaPipe model files are prerequisites. Downloads and Node subprocess execution may require sandbox permission.

Do not delete the frozen report or rerun selection to manufacture a different result. `plan`, `prepare`, `experiment` and `freeze` refuse to retune the completed experiment. Any new model/data strategy needs a separately versioned protocol. Models, checkpoints, logs, landmark caches and raw videos remain ignored.

## Verification and next technical step

- App: **175/175 tests in 17 files**, production build successful.
- Research: **18/18 tests**, including signer/source/hash boundaries, test access guards, promotion regressions and protection of the deployed model.
- All four exports reproduced exactly; 264 public video hashes verified.
- No UI redesign, runtime CDN, cloud inference, contract change, commit, push or branch switch.
- The repository already contained the previous implementation changes. This iteration's file inventory is `research/word-signs/reports/expansion-v3/changed-files.json`; pre-existing edits are preserved.

To run the unchanged working app:

```powershell
# From the repository root:
cd app
npm.cmd run dev
```

The next model experiment should address data efficiency and domain mismatch before increasing classes again: use additional **training-only** public signs to pretrain a temporal representation, then compare fine-tuning against the current model with the same identity boundaries. This is a proposed experiment, not a demonstrated improvement. Cross-dataset video acquisition would also require reliable signer/source identity reconciliation. Four to six training clips per word and only one or two validation clips per word remain the main evidence limitation; scanning more gloss names alone has not solved it.

Human check: try the existing words with the current 0.85 policy, lower hands between attempts, and distinguish correct / wrong / rejected attempts. Record the displayed rejection reason. The user's report that this setting feels better is useful feedback, not a measured accuracy estimate. No user training recordings are required.

## Exact largest-experiment class counts

| Word | Train | Validation | Reserved test | Train signers |
|---|---:|---:|---:|---:|
| drink | 4 | 1 | 1 | 3 |
| help | 5 | 1 | 2 | 2 |
| yes | 5 | 2 | 1 | 5 |
| no | 5 | 1 | 1 | 5 |
| thank you | 4 | 1 | 1 | 4 |
| sad | 4 | 1 | 1 | 4 |
| cold | 4 | 1 | 1 | 4 |
| take | 5 | 1 | 1 | 3 |
| give | 4 | 1 | 2 | 3 |
| change | 6 | 1 | 1 | 3 |
| work | 5 | 1 | 1 | 5 |
| day | 4 | 1 | 1 | 4 |
| white | 4 | 1 | 1 | 2 |
| cake | 4 | 2 | 1 | 4 |
| what | 4 | 2 | 1 | 4 |
| before | 6 | 1 | 2 | 5 |
| compare | 5 | 1 | 1 | 5 |
| woman | 6 | 1 | 1 | 4 |
| grapes | 4 | 1 | 1 | 4 |
| transfer | 4 | 1 | 1 | 4 |
| when | 4 | 1 | 1 | 4 |
| add | 4 | 1 | 1 | 3 |
| fish | 4 | 1 | 1 | 3 |
| lose | 4 | 1 | 1 | 3 |
| upset | 4 | 1 | 1 | 3 |
| interest | 4 | 1 | 1 | 2 |
| pizza | 4 | 1 | 1 | 2 |
