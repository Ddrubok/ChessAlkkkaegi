# Online turn clock repair (2026-10-30)

Coordinator follow-up: `main.ts` now supplies `onlineRuntime.active` to `turn-hud.ts`. The HUD preserves remaining time while connecting/rejoining and drops the accumulated wait on resume. The extended timer check passes: initial 40-second connection wait retains 20 seconds; after spending 5 seconds, a reconnect wait resumes at 15 seconds; timeout fires once. This was integrated into both workspaces. Live Android/portal background testing remains unperformed.

## Finding and change

The prior `loop.ts` callback passed the physics delta, capped at 0.25 seconds, to `turnHud.update()` through `main.ts`. A throttled CrazyGames iframe could therefore consume less than one turn second per real second. The separate crossplay `qa/crazygames-crossplay-2026-10-29/background-review.md` documents this source path as a plausible explanation, without live-device proof.

`loop.ts` now passes uncapped monotonic elapsed time to its callback only in online mode. Physics still uses the capped delta and fixed-step budget. `turn-clock.ts` discards time when a new turn, board, or ready phase begins. `turn.ts` increments a board-reset serial so a new board starting on the same side and turn number cannot inherit elapsed time. Existing HUD ownership and one-shot guards still decide who may send the timeout launch.

## Checks actually run

- `cd web; node src/tools/turn-clock-check.mjs` — pass: long frame gap, settlement/pause, next turn, same-side new board.
- `cd web; node src/tools/turn-timer-check.mjs` — pass: existing cases plus one late-frame timeout, no duplicate shot, remote side cannot send, local black can send. Vite printed a nonfatal WebSocket port-in-use warning.
- `cd web; npx tsc --noEmit` — pass.
- `cd web; node --import ./src/tools/headless-browser-env.mjs src/tools/online-check.mjs` — exit 0. Expected protocol-error fixtures printed errors; Vite printed a nonfatal WebSocket port-in-use warning.
- `cd web; node src/tools/gameplay-regression-check.mjs` — pass.

## Integration and limits

No live server, iframe, or Android device check was performed. A suspended browser cannot fire a timeout until JavaScript resumes. `main.ts` owns the callback and `turn-hud.ts` owns menu, tutorial, and online-session gating; neither was assigned here. Before shipping, the coordinator should verify the local online owner returns from a backgrounded iframe after >20 seconds and emits exactly one existing `queueLocalLaunch(..., "timeout")`, while the Android peer advances once. Also check an online session that is still connecting or rejoining: `turn-hud.ts` currently consumes time whenever phase is `ready` and can mark timeout before `onlineRuntime.active`; the rejected launch would not retry. The minimal parent-owned fix is to pass active/rejoining state from `main.ts` to `turn-hud.ts` and suspend/reset its timer before an active session, plus preserve its menu pause on resume.
