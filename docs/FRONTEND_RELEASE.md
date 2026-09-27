# Frontend release and backend closeout — 2026-09-27

The browser recognition backend is frozen for the hackathon prototype. This is a software milestone, not a certification of recognition accuracy. The recognition contract, capture policy, deployed model and research metadata are unchanged by this frontend release.

## Delivered interface

- English main app, status guidance, rejection explanations, mock messages and legacy collector.
- Responsive cream-and-green layout with a dark camera stage and an original local SVG hand mark/favicon.
- Three-step instructions, visible local-processing notice and model-confidence caveat.
- Accepted words with undo/clear; session diagnostics available in a disclosure instead of dominating the result.
- Vocabulary comes from the loaded engine. Before startup the UI explains that setup is needed, instead of implying the model supports zero words.
- Keyboard skip link, focus indicators, text-plus-icon statuses and reduced-motion support. Historical research reports retain their original language and findings.

## Verification

Application suite: 178 tests passed. Research suite: 20 checks passed. Production build passed. Browser review covered desktop and narrow layouts, the labeled mock flow, pause/resume/stop, accepted output and undo/clear. Mock tests are interface verification only, not real webcam recognition evidence.

## Remaining model limits

Twelve active words, 0.80 live confidence threshold, no live work output, and up to 2.6 seconds per capture. Yes/no confusion and rejection of change remain documented in the [live policy](LIVE_POLICY_12_WORDS.md). Live webcam accuracy has not been measured. Larger-vocabulary models remain experimental and are not enabled.

Before a presentation, perform a short manual check on the actual camera and laptop. No additional personal training recording is required.
