# Local landmark collection

Keep sample exports in this directory for local training. Git ignores everything here except this README. Do not force-add data exports, raw personal recordings, or personal identifiers. Export normalized landmark features only; raw video is unnecessary. Use a non-identifying signer ID.

## Hackathon MVP shortcut

`npm.cmd run train` accepts **3 independent holds per letter** as its hard minimum and writes `public/models/asl-knn-v1.json` with `A`, `B`, `C` enabled. Collect **6 or more holds per letter** for reliable live recognition. The 12-hold, two-session protocol below remains the long-term standard; the shortcut only lowers the bar to run the first demo.

## First A/B/C checkpoint

1. Use the physical right hand, a steady camera and light, and the unmirrored camera input. Confirm MediaPipe's handedness interpretation on the actual camera before collecting. Mirroring belongs to the display only.
2. For one demonstrator, collect **12 independent training holds for each of A, B, and C**, distributed across **two separate short sessions**. Rest, lower the hand, and reposition between holds.
3. Capture **five valid frames per hold at 5 Hz**. This produces 60 training frames per letter and 180 total, grouped into 36 independent holds. Reject no hand, two hands, the wrong hand, nonfinite coordinates, or degenerate geometry. A missing hand must never become a zero-vector sample.
4. Record `signerId`, `sessionId`, `holdId`, `split`, `timestamp`, `label`, `preprocessingVersion`, and the normalized feature vector. Each hold belongs to exactly one split. Use the same preprocessing implementation as training and live recognition.
5. Export to `data/samples.json`. The trainer will average each hold's five frames into **one prototype**, yielding 12 prototypes per letter. It must never treat adjacent frames as independent kNN neighbors or randomly split them across datasets.
6. Train the first model using only the training split. A validation or final-test split is not required for this initial run. Training-only leave-one-hold-out distances initialize provisional radii; mark the model provisional and keep enabled labels separate from candidate labels.
7. Reload the real classifier in the collector diagnostics, then perform **10 fresh holds per letter**. Each letter must be correct on at least **9/10** holds. Also check 60 seconds of empty camera with zero appends and that a held letter appends only once. Record actual counts, camera/light, frame rate, and latency; automated tests do not verify this human checkpoint.

Do not expand beyond A/B/C until the first slice passes. Unsupported or relaxed poses are not invented ASL labels. `UNKNOWN` is an internal rejection class; no-hand remains a separate condition.

## Later collection and evaluation

For each enabled target letter, each of two people collects 12 training, 4 validation, and 4 final-test holds, with five frames per hold and separate sessions for each split. Collect final tests only after tuning is frozen. Keep signer/session/hold groups intact and detect split leakage. Collect varied unsupported poses for the internal `UNKNOWN` class separately, following `docs/PROMPT_LAPTOP_A.md`.

Use validation positives and unknowns to calibrate thresholds. Final-test samples must never train prototypes or tune thresholds. Report evaluation per independent hold with confusion, rejections, and denominators; if a genuinely held-out test split is absent, report evaluation unavailable rather than substituting training data. Performance with trained demonstrators does not establish accuracy for unseen signers.
