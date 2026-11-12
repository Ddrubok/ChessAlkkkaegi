# PF-R01/02/03 input handoff — 2026-11-12

Baseline copies: `.orca/tasks/playtest-input-baseline/input.ts` and `tutorial.ts` were saved before edits.

Changed only assigned production files `web/src/input.ts`, `web/src/tutorial.ts`, plus assigned check `web/src/tools/itch-power-controls-check.mjs`. No commit, push, publish, settings, or other production files changed by this worker. `web/src/power-controls.ts` was edited by the other owner during this work.

- Runtime snapshots `computeViewportPowerDistance` at pointer down using the canvas rectangle; touch retains its 80–180px preferred range. Existing two-argument `computeEffectiveMaxDragPixels` behavior remains available for legacy callers; runtime and tutorial pass width for the cap.
- Classic and red-dot power drags arm after maximum displacement exceeds 4 mouse / 8 touch CSS pixels. Release samples final coordinates; a pull back to a tiny positive shot still fires, zero release does not. Cancel area and outside-release checks remain first.
- Keyboard integration, transition progression, and adaptive camera fitting pause during power drag. Window resize, canvas fit callback, power preset, and input mode changes cancel the gesture.
- Tutorial cue uses the effective canvas distance for its pull length.

Checks run from `web`:
- `node src/tools/itch-power-controls-check.mjs` PASS, including new jitter/pull-back/up-only and existing duplicate/preset/outside cases.
- `node src/tools/touch-input-headless-check.mjs` PASS (legacy two-argument behavior).
- `node src/tools/tutorial-input-check.mjs` PASS.
- `npx tsc --noEmit` PASS.
- `git diff --check` PASS.

Remaining: no interactive browser drag/resize walkthrough in this worker task. The headless power check logs existing mock storage warnings. Its concurrent run once reported Vite HMR port contention but exited successfully; the final standalone run passed without that contention.
