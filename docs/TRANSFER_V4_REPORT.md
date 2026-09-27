# Minimal transfer attempt — 2026-09-27

The user's request was to keep the next step short and prioritize a working app. This attempt used the existing public data and deployed 13-word checkpoint: no downloads or long pretraining. Only **130 parameters** in two new output rows were trained for **cake** and **what**. The existing encoder and original output rows were frozen. RecognitionResult, runtime preprocessing, UI, 0.85 live policy and 600 ms capture minimum remain unchanged.

The single preregistered candidate uses 67 training clips and 18 validation clips. The 17 test clips listed in the source manifest were not used. Selection was by validation cross entropy, maximum 200 full-batch epochs, patience 30, Adam learning rate 0.02, weight decay 0.001, fixed seed 20260926. The protocol was saved before training; no follow-up hyperparameter search was performed.

Result: **14/18 validation predictions correct (77.78%)**. All four validation clips for the two additions were classified correctly, but the original-word subset dropped from **11/14 to 10/14**. At confidence 0.85, it accepted 7 correct and 1 wrong clip overall; on original words it retained 6 correct and 1 wrong acceptance. Non-target false acceptances dropped from 11/84 to 5/84. These tiny validation samples do not establish webcam accuracy.

The candidate failed the existing promotion rule, so it was **not deployed**. The app still supports drink, help, yes, no, thank you, sad, cold, take, give, change, work, day and white. The original raw logits are numerically identical, but new outputs compete in the softmax and can change the winning label. Freezing original weights alone does not guarantee unchanged predictions.

The 135,759-parameter candidate has PyTorch/ONNX maximum absolute difference **0.0000019074**, with matching validation predictions. Export reproduction is checked separately against its exact SHA-256. All model files remain in ignored research artifacts. No final test inference or new browser-parity run was needed for this rejected candidate. The deployed model SHA-256 remains `f81951819621c1dd3201989abfd32e91a1bac8fc790ad05ce83d948b9f83ca61`.

Reports: `research/word-signs/reports/transfer-v4/{protocol,result,frozen}.json`. Source and regression checks: `transfer_v4.py`, `test_transfer_v4.py`. Existing data counts and provenance remain in the v3 manifest. Reproduce from the repository root with the existing pinned environment and caches:

```powershell
& research/word-signs/.venv/Scripts/python.exe research/word-signs/transfer_v4.py --reproduce
```

The working 13-word demo is the minimal usable result for now. Further expansion needs stronger data or representation learning; it should not be presented as a quick guaranteed fix. No commit, push, branch change or UI redesign was performed.

Final verification: 175 app tests and both new transfer regression tests passed; production build passed. The independent retraining/export produced an identical ONNX hash.
