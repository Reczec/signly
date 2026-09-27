# Current live policy — 2026-09-27

At the user's request, live acceptance is now **0.80 confidence**. This is a score threshold, not an 80% precision or accuracy claim. The live vocabulary contains twelve words: drink, help, yes, no, thank you, sad, cold, take, give, change, day and white.

**Work is removed from the live vocabulary and output.** If its model output wins, the attempt is rejected with no label and an unsupported-sign explanation. It is not replaced by the second-best word. The softmax still includes the original outputs so removing work cannot artificially increase another word's confidence. The immutable research model, its 13-output label mapping, checksum and historical reports remain unchanged; the metadata-policy factory remains available for reproducing that research. No new model was trained.

Capture remains at least 600 ms / six observations. Its maximum is now **2.6 seconds**, up from 1.8; withdrawal can end it earlier. Two existing change training videos have visible-hand spans of about 2.34 and 2.42 seconds, motivating room for the complete motion. Release protection, short-occlusion masking, camera-gap rejection and pause/stop guards remain enabled. This timing adjustment is not a measured webcam accuracy improvement.

Validation-only inspection (no test read) found 10/13 active-word examples correctly classified; at 0.80, six were accepted, including one wrong prediction. The removed work validation example was rejected. The change validation example scores 0.7046 and is still rejected at 0.80. Of the two yes examples, one is confused with no at 0.8639; the other predicts yes at 0.5323 and is rejected. These small-sample limitations are not solved by lowering the threshold. The user should recheck change and yes with the longer live capture and actual camera conditions.

Regression coverage checks the threshold on both sides of 0.80, removal of work, rejection without substitution or score inflation, the unsupported-sign reason, capture through 2.6 seconds, early completion on withdrawal, and existing release/lifecycle behavior.
