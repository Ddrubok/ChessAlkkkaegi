# 1.0.22 patch notes review draft

Status: **review draft**. Source comparison: `9745744..4be6cef` (`f601434` and `4be6cef`). The prior published main commit `29488ac` contains the Darius changes only; these notes describe the proposed 1.0.22 candidate, not an uploaded or published release. The 1.0.21 locale files and `Docs/체스 알까기 개발 반영 보고서_2026-11-15.md` were also consulted.

## Android / Play notes

The four standalone locale bodies use one bullet per source claim. Counts include bullet marks, spaces, and three internal line breaks; they exclude the final file newline. Count unit is Unicode code points.

| Locale | Characters | Bullets | Combined tag | Exact combined copy |
|---|---:|---:|---|---|
| ko | 166 | 4 | `ko-KR` | Yes |
| en | 307 | 4 | `en-US` | Yes |
| ja | 149 | 4 | `ja-JP` | Yes |
| fr | 332 | 4 | `fr-FR` | Yes |

All are below Play's 500-character limit.

| Bullet | Claim and source locator |
|---|---|
| 1 | Stage Knight AI evaluates obstacle contact and nominal landing safety when refining a selected Knight shot: `web/src/ai.ts` (`refineKnightDecision`, `prepareAiTelegraph`) and `web/src/knight-ai.ts` (`planKnightShot`). “Estimates” is deliberate: the planner reads fixed poses and does not guarantee a collision or safe landing. |
| 2 | Knight AI compares lower-power candidates: `web/src/knight-ai.ts` (`consider`, `offsetPower` values), then passes the selected power through `web/src/ai.ts` (`refineKnightDecision`). This is an AI change, not a player power rebalance. |
| 3 | The Knight preview and actual impulse use `computeLaunchKinematics`: `web/src/aim.ts` (`computeKnightTrajectoryPoints`), `web/src/loop.ts` (`knightPreviewLaunch`), `web/src/turn.ts` (`queueTurnLaunch`), and `web/src/launch.ts`. The guide describes initial flight; collisions, spin, and bounces can change the later path. |
| 4 | A result presentation version prevents old asynchronous action completions from changing a newer result presentation: `web/src/match.ts` (`presentationVersion` guards in restart/menu/result actions and version increments on presentation changes). |

The Android body deliberately omits the itch only retry, card, menu, and settlement flow. In `web/src/main.ts` these branches are guarded by `PLATFORM.id === "itch"`; the non-itch stage handling remains separate.

## itch notes

Each of the four language sections in `store-assets/itch-1.0.22/PATCH-NOTES-multilingual.md` has the same five claims.

| Bullet | Claim and source locator |
|---|---|
| 1 | On a regular itch stage loss or draw, preserve stage and run cards while retrying from the stage boundary: `web/src/main.ts` (`recordSoloRunResult`, `restoreSoloBoundary`, `prepareSoloRunBoard`) and `web/src/solo-run.ts` (`recordSoloRunResult`, `retrySoloRun`). The board is prepared again with the saved card state; it is not the losing board pose. |
| 2 | Menu suspension and explicit end/settlement are distinct: `web/src/main.ts` (`menuRuntime.onEndSoloRun`, `settleSoloRun`, stage menu handlers), `web/src/menu.ts` (`retryStage`, `endRun` controls), and `web/src/loop.ts` (`isMenuCovered`). The copy says settlement is attempted, without promising account payout. |
| 3 | Saved card offer and selected card govern reload and next stage preparation: `web/src/solo-run.ts` (`awaiting-card`, `chooseSoloRunCard`, `preparing-stage`, `saveSoloRun`) and `web/src/main.ts` (`resumeSoloRun`, `prepareSoloRunBoard`). |
| 4 | Unconfirmed storage or settlement remains pending; browser storage failure offers session-only play: `web/src/main.ts` (`commitSoloRun`, `soloSaved`, `settleSoloRun`, `resumeSoloRun`), `web/src/solo-run.ts` (`saveSoloRun`), and `web/src/progress-storage.ts` (`lookupSoloRunSettlement`, `settleSoloRun`, `unconfirmedPortalStore`). |
| 5 | Knight planning and preview changes are shared platform code: `web/src/ai.ts`, `web/src/knight-ai.ts`, `web/src/aim.ts`, `web/src/launch.ts`, and `web/src/turn.ts` as described above. |

## Review limits

The report's later strategy profiles (ground speed 8/9, Pawn, Rook, Queen, Bishop) are development experiments, not public defaults. King win conditions and card rules are not presented as changed. The three observed QA UI issues (portrait-to-landscape board framing, opening tip over the objective, and overlapping billiards labels) are not claimed as fixed.

`Docs/체스 알까기 개발 반영 보고서_2026-11-15.md`, section 5, says account settlement SQL was tested locally but actual Supabase application and live account payout/reconnect checks remain. These notes therefore make no live database success or guaranteed payout claim. No build, device, upload, or live service verification was performed for this notes-only task.
