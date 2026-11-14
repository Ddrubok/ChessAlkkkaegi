# Independent Knight AI review — 2026-11-14

## Findings

1. **Target reporting can disagree with the predicted first contact (moderate).** `knight-ai.ts:69-94` records the first intersected body, but `:96-102` awards any enemy contact the same 400 points and returns the candidate target's ID. `ai.ts:524-527` then publishes that ID as `AiDecision.targetPieceId`, and `:603` logs it. With two white pieces, a candidate aimed at A can first hit B while the telegraph/log says A. Return the contacted enemy's ID when claiming a predicted contact, or score the intended target distinctly. Add a two-enemy fixture where B lies on A's flight path and assert the reported target matches B. This is a reporting/selection consistency issue; it does not change the launched direction.

2. **The saved physics result is not a current-source verification (evidence limit).** `physics-after-01/result.json` records `ai.ts` SHA-256 `18301eec...`; the reviewed file now hashes `a982375e...` because shared work continued. The `launch.ts` and `knight-ai.ts` hashes match that result. Rerun the fixed 48-case comparison after integration before attaching its numbers to the final revision. The saved comparison improves hits 12→44, self-outs 45→28 and target-outs 3→31, with no forced settle or decision-time world mutation; p95 decision time is 0.36→1.11 ms. These are four stage bands × twelve fixed layouts, not live match statistics. The harness explicitly has no terrain gimmicks, and its tipped/raised starts are frozen artificial poses (`physics-comparison.mjs:18-43,62-64`).

## Verified contracts and heuristic limits

- `ai.ts:423-447,511-515` supplies the deterministic stage variation to the planner; `knight-ai.ts:52-56` includes it in **every** scored direction. `ai.ts:557-567,587-598` passes the chosen direction/power and frozen stage speed to telegraph and queue, and `turn.ts:768-799` uses the shared launch calculation once. There is no later AI-only jitter.
- Current body AABBs are built from physics translation/rotation and mesh scale (`aim.ts:1038-1057`); `ai.ts:486-510` includes both sides and static obstacle estimates. The planner clones boxes and does not step the world. Its search is fixed at at most 27 evaluated shots (two targets × nine plus nine inward shots), with work per shot proportional to bodies/obstacles. Difficulty bands and the non-Knight AI branch remain in `decideAiShot`; Knight refinement is gated at `ai.ts:485`. A no-contact Knight may fall back to another piece at `:517-523`.
- `knight-ai.ts:64-97` estimates a free ballistic flight against fixed-pose AABBs and checks only nominal landing. It does not model torque from the strike point, moving bodies, bounce, breakable walls after impact, or post-collision survival. Thus `predictedContact` and `nominalLandingSafe` are estimates, not hit/win/safety guarantees. The after-01 fixtures still lose the Knight in 28/48 shots despite 44/48 contacts; close, north, south, and far layouts each lose it in all four bands. This is the expected ceiling of the approximation, not proof of a new correctness bug.
- `loop.ts:356-364` supplies the preview with the frozen AI speed and read-only control-zone peek. `turn.ts:767-777` peeks before consuming the bonus on the real launch. `ai.ts:766-805` cancels the telegraph when the AI turn becomes ineligible; `resetAiMatch` clears it on restart. The shared directed telegraph is also used by online play (`online.ts:1208`), so retain its regression check when integrating.

## Checks run

- `web`: `npx tsc --noEmit` — passed.
- `web`: `node src/tools/launch-kinematics-check.mjs`, `node src/tools/knight-ai-check.mjs`, `node src/tools/ai-headless-check.mjs` — passed. Vite printed a port-in-use notice in the latter two, but their assertions completed successfully.
- `web`: `node --import ./src/tools/headless-browser-env.mjs src/tools/online-check.mjs` — exit 0. It intentionally emitted physics-revision mismatch errors during its rejection cases.
- Inspected both saved physics JSON summaries and each layout's hit/self-out counts. No production files changed in this review.
