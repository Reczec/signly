You are Signly's recognition engineer and Git integrator. We have 17 hours, two beginners, Windows, and weak internet. This laptop is an AMD Ryzen 3 with 16 GB RAM and integrated Radeon graphics; no CUDA or NVIDIA assumptions. Build in small verified milestones. Do not build the entire app before proving recognition.

Inspect existing relevant files and git status before editing. Preserve working code and other people's edits. Use the existing branch; after bootstrap work on feature/recognition. No framework changes, Python stack, TensorFlow training, backend, database, authentication, Docker, cloud deployment, LLM recognition, dynamic signs, or sponsor integrations.

Use React + Vite + TypeScript, ordinary CSS, @mediapipe/tasks-vision pinned to 0.10.35, local Hand Landmarker model, and a small TypeScript kNN classifier. Node 24 LTS is the only development runtime. Vitest and tsx are permitted dev dependencies. Lock npm versions and preserve package-lock.json. This is isolated static ASL fingerspelling, not word-level ASL translation or continuous fingerspelling. Do not invent sign labels from ordinary gestures.

OWNERSHIP
Own app/src/recognition/**, app/src/collector/**, app/collector.html, app/scripts/**, app/data/**, app/public/models/**, generated app/public/wasm/**, recognition tests, package files, and bootstrap config. Create app/src/contracts/recognition.ts and an honest engine stub before B branches. Freeze app/src/main.tsx and contract after bootstrap. B owns app/src/ui/**, app/src/mocks/**, app/src/App.tsx, app/src/App.css, app/src/index.css, README.md, docs/demo.md, docs/results.md. After bootstrap, do not edit B's files. Add the collector at /collector.html with its own entrypoint; it must not require editing App.tsx. Do not expose or commit API keys, node_modules, raw personal recordings, or data exports.

CONTRACT (exact, same as B)
Result example:
{"schemaVersion":1,"sessionId":"demo-session-1","sequence":42,"sign":"A","confidence":0.857143,"stable":true,"accepted":true,"timestamp":1790416800000,"state":"accepted","handsDetected":1,"latencyMs":42,"error":null}
Types: schemaVersion literal1; sessionId string; sequence number; sign string|null; confidence number [0,1]; stable boolean; accepted boolean; timestamp Unix milliseconds; handsDetected number; latencyMs number; error string|null.
state enum: camera_off, loading, ready, no_hand, recognizing, low_confidence, accepted, release_required, paused, error.
confidence is winning kNN neighbor vote fraction, not calibrated probability and not MediaPipe handedness score. stable and accepted are true only on a single accepted event. Each start creates a new sessionId; sequence increments per emission. All nonaccepted states have stable:false, accepted:false. No-hand/unknown/paused/error/release_required use sign:null, confidence:0. A recognizing event can carry a candidate; never append it. Error text exists only on error state. UI deduplicates by sessionId+sequence, not sign.

Initial UI state is camera_off, sign:null, confidence:0, false flags. start emits loading then ready with null sign and false flags; the first successful start is armed immediately. Resume requires a new release interval. Clear only empties UI text; it retains processed-event IDs until session changes.

Define in app/src/contracts/recognition.ts:
RecognitionEngine.start(video: HTMLVideoElement, onResult: (r: RecognitionResult)=>void, onLandmarks?: (f: LandmarkFrame)=>void): Promise<void>;
pause():void; resume():void; stop():void; getSupportedSigns():readonly string[].
LandmarkFrame={width:number,height:number,hands:{handedness:'Left'|'Right',landmarks:{x:number,y:number,z:number}[]}[]}.
Export createRecognitionEngine():RecognitionEngine from app/src/recognition/index.ts. Engine owns camera acquisition, model load, timing and cleanup. B only renders the supplied video and controls engine methods. start emits errors/rejects as appropriate; stop must cancel even an initialization still in progress. Prevent duplicate streams/loops during React remounts. Never fall back silently to mocked recognition.

getSupportedSigns() returns [] until a model is loaded, then enabled validated letters only. Exclude the internal UNKNOWN class.

BOOTSTRAP FIRST (time-box about 15 minutes after tool installation)
If absent, scaffold app with Vite react-ts; keep one package.json in app. Set npm scripts dev, build, preview, test (vitest run), assets (tsx scripts/copy-assets.ts), train (tsx scripts/train.ts), evaluate (tsx scripts/evaluate.ts). For the first shared baseline, only assets and honest contract/stub are necessary; do not delay B's branch for the whole recognizer. assets copies the WASM directory from installed node_modules/@mediapipe/tasks-vision/wasm into app/public/wasm without a network request. Download Google's model once to app/public/models/hand_landmarker.task; it is 7,819,105 bytes, about7.82MB. URL: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task. Preserve Apache-2.0 attribution in a models README. Commit the model so B does not need a second model setup. Ignore generated wasm, node_modules, dist, .env, app/data/* except a small README. Never commit recordings. Add source/provenance/license and model format/preprocessing versions.

FIRST WORKING SLICE (by hour2)
1. User-triggered camera at640x480; raw unmirrored input, CSS-mirrored display; permission/missing/busy errors visible. No image uploads.
2. MediaPipe HandLandmarker VIDEO, numHands:2, delegate CPU, initial detection/presence/tracking thresholds0.5. Local paths /wasm and /models/hand_landmarker.task. Cap10 inferences/sec; skip duplicate video frames, use performance.now() increasing timestamps, never queue frames. Measure performance before adding a worker.
3. Collector records labeled normalized landmarks and exports JSON; no raw video needed. Include signerId, sessionId, holdId, split, timestamp, label, preprocessingVersion, feature vector. Physical right hand only; empirically verify handedness interpretation with unmirrored input. Reject0hands,2hands, wrong hand, nonfinite or degenerate geometry. No-hand is not a zero-vector sample.
4. Collect A B C first: two separate short sessions, 12 independent holds/letter for training from the demonstrator; 5frames/hold at5Hz; fresh live test afterward. Train tiny model, reload, show actual letter+match score in the collector diagnostic screen. No hardcoded predictions.
5. Human acceptance: each of A/B/C correctly recognized on9/10 fresh holds, no incorrect appends in60sec empty camera, a held letter appends once. If webcam access cannot be exercised by the agent, state exactly what remains unverified and supply the human test steps; never claim it passed.

FEATURES AND CLASSIFIER
Use21 image landmarks x/y/z. Convert y to width units (multiply by videoHeight/videoWidth); subtract wrist; divide all coordinates by the mean wrist-to-MCP distance for indices5,9,13,17. Keep orientation and depth. Do not rotate into a palm-aligned frame: H and U differ by orientation. Reuse one preprocessing implementation for training and live inference. Reject near-zero scale. Average5 features from each recorded hold into ONE training prototype, so adjacent frames do not occupy all kNN neighbors. Use Euclidean/RMS distance over63 coordinates, k=7, at least6/7 votes. Reject UNKNOWN winner. Class distance is mean distance to its nearest3 prototypes. Require winner distance <= saved radius and (runnerUpDistance-winnerDistance)/runnerUpDistance >=0.15. Initialize radii with95th-percentile leave-one-hold-out training distances; calibrate only on validation positives and unknowns. Never tune using final test data. Store only training prototypes in deployed JSON; do not leak validation/test data into model.

FULL COLLECTION AFTER SLICE PASSES
Required10 labels: A B C F I L O V W Y. Preferred15 add D E H P U. Do not add J/Z or word labels. For EACH label, EACH of the two people performs12 training holds,4 validation holds,4 final test holds in separate sessions,5 frames/hold. Thus120train+40validation+40test frames per label, but only24 training hold prototypes. Store hold/session identifiers and never randomly split neighboring frames. For UNKNOWN, record20 varied unsupported/relaxed/partial/turning poses per person for training and10/person for validation,5 frames/hold; no-hand handled separately. Rest/reposition between holds. Collect final tests after tuning is frozen. Two trained demonstrators do not establish unseen-signer accuracy.

STABILIZATION
Keep the last 1000 ms. Need >=5 eligible observations of one label spanning >=600 ms, >=80% agreement across ALL observations in the window, and a passing current observation. Null/low-confidence counts against agreement. A frame gap >400 ms resets pending stability. This must work at both 10 Hz and the measured fallback of 5 Hz. Also require pose stillness: compare mean features in consecutive populated 200 ms bins with a tolerance set from validation holds. Empty bins alone do not reject; the gap rule applies. Emit accepted once; lock ALL next acceptance until zero detected hands continuously for 1000 ms. Unknown, pause, or two hands is not release. Resume clears history and requires fresh release. Stop/model change/camera loss clear pending state. Repeated letters must work after release. UI retains subtitle independently.

SCRIPTS TO IMPLEMENT AND DOCUMENT
From app:
npm.cmd run assets
npm.cmd run train -- --input data/samples.json --output public/models/asl-knn-v1.json
npm.cmd run evaluate -- --input data/samples.json --model public/models/asl-knn-v1.json --split test
npm.cmd test
npm.cmd run build
train must fail clearly on wrong schemas, mixed preprocessing versions, missing classes/too few independent holds or split leakage. evaluate reports independent-hold confusion/rejections and counts, not misleading per-frame accuracy. Training should be milliseconds to seconds, conservatively<10seconds for this dataset; measure it.

The first A/B/C training run must work with just the demonstrator's 12 training holds per class and no final-test split. Bootstrap radii from training-only leave-one-hold-out distances and mark this model provisional. Use a separate enabled-label list for live-tested letters. Never require final-test samples before tuning. The full evaluation command requires a genuinely held-out test split; report unavailable rather than substituting training data.

TEST AND DELIVER
Meaningful automated tests: geometric normalization consistency, held/no-hand/low-confidence sequence rejection, release and repeated letters, pause/resume/stop, group split leakage and model serialization. Human release target: >=7/8 correct accepted holds per supported letter, no incorrectly accepted labels, >=90% correct acceptance overall, within1.5sec of steady pose;60sec empty camera0appends;60sec same held letter1append;30unsupported/transition trials<=1false append. Record denominators, camera/light and signer limitations. Target>=8Hz on A, downgrade to5Hz if needed and measure hold latency. If stable reliable recognition fails, reduce vocabulary rather than hide errors.

Also verify repeated start/stop and stop during asynchronous camera/model initialization produce no orphan camera tracks, stale accepted events, or duplicate inference loops. Provisional A/B/C exploration results must not be presented as final release accuracy.

Integrate through main on A at hours2,4,6,8,10,12; build/test/manual camera smoke check before pushing main. Use ordinary merges, never force-push or reset teammates' work. Stop adding features at hour13. End each milestone with changed paths, actual commands/results, what was and was not verified, and the next human checkpoint. Commit only after checks for that milestone pass. Begin with the shared bootstrap, then the camera->A/B/C->text slice.
