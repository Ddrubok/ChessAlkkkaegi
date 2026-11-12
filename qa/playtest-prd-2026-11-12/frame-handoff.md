# PF-R02/03 frame and viewport pull handoff

## Changes

- `web/src/scene.ts`: board fit uses the actual canvas rect and reserves `R = 0.18 * min(width, height)` CSS px on each edge. The horizontal and vertical FOV tangents are reduced by `(1 - 2R / width)` and `(1 - 2R / height)` before fitting board corners. Existing camera direction, zoom intent, turn orientations, and selected-piece camera behavior remain on their existing paths.
- `web/src/power-controls.ts`: exports `computeViewportPullReserve(width, height)` and `computeViewportPowerDistance(preferred, width, height)`. The latter is `min(preferred, R * 0.8 / 1.5)`. Thus a 150% mouse pull uses no more than 80% of the framing reserve, independent of piece, position, or direction.
- `web/src/settings-modal.ts`: keeps 180/240/360 preferred choices. Each shows preferred → effective distance, and the selected effective distance and viewport limit are shown separately. Uses the actual `.game-canvas` bounding rect when present; updates on canvas/window resize. KO/EN follow existing fallback.
- `web/src/tools/playtest-frame-check.mjs`: focused helper and projected-board-corner assertions for 800×450, 1366×768, 390×844, 3840×2160 and three camera orientations.

## Checks run

- `node --disable-warning=ExperimentalWarning src/tools/playtest-frame-check.mjs` from `web`: passed.
- `git diff --check -- src/scene.ts src/power-controls.ts src/settings-modal.ts` from `web`: passed.
- `npx tsc --noEmit` from `web`: passed on the final run. An earlier run caught a transient `src/input.ts(519,59) TS2322` while another worker was editing that file.

## Integration and limits

- Input owner should use `computeViewportPowerDistance(getMousePowerDistance(), canvasRect.width, canvasRect.height)` for mouse 100% reference, and use the same actual canvas rect. Settings only displays the value until that integration is complete.
- At 800×450, `R=81px` and every preferred choice caps to `43.2px`; at 1366×768, every choice caps to `73.728px`. This follows the assigned conservative formula. Human comfort and real HUD/cancel-region clearance have not been verified.
- No baseline copy was needed; assigned production files were unchanged in `git status` before edits. No browser playtest was run.
