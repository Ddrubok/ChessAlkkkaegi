# Stage draw and fresh run model

The current callback settles a stage draw with `winner !== "white"` (main.ts:1965-1969). `settleStageRunPoints` credits the successful stages before the draw and clears the temporary record (meta.ts:741-752). The result UI stores the winner (match.ts:445), so a delayed second callback is ignored (main.ts:1845). Returning to the menu and starting a new run uses the mode switch transaction, which resets the point state and rolls it back if board reset fails (main.ts:1621-1650, 1999-2003).

The [historical model](stage-model-historical.lean), [frozen declarations](stage-model-historical.statements), and [failed check](stage-model-historical.log) preserve the 2026-10-29 bug investigation. The production fix changed the lifecycle, so `StageDrawRestart.statements` was intentionally re-frozen. The old `RestartClearSafe(start,target)` was an existential statement about the obsolete restart button. The new `RestartClearSafe(s)` quantifies every terminal state and requires the actual menu → fresh run → stage 1 win path to accept the win. It is stronger at the new boundary: an unreachable restart path cannot satisfy it.

The model uses natural numbers for validated JavaScript integer stages 1–10 and nonnegative points, with point totals assumed within JavaScript's exact safe-integer range. The payout unit is 1. Cards and successful board resets are phase transitions; board reset failure is represented explicitly. Physics, storage errors, and concurrent callbacks are outside this sequential model.

## Checks

- Setup: `bash /mnt/c/Users/DooBokWie/.codex/skills/agent-formal-verify/scripts/setup.sh lean /mnt/c/Users/DooBokWie/Desktop/Project/nhnChess/ChessAlkkkaegi/lean` → `READY Lean leanprover/lean4:v4.34.1`.
- Freeze: `bash /mnt/c/Users/DooBokWie/.codex/skills/agent-formal-verify/scripts/lean-check.sh /mnt/c/Users/DooBokWie/Desktop/Project/nhnChess/ChessAlkkkaegi/lean --freeze Model/StageDrawRestart.lean` → `FROZEN`.
- Whole project: `bash /mnt/c/Users/DooBokWie/.codex/skills/agent-formal-verify/scripts/lean-check.sh /mnt/c/Users/DooBokWie/Desktop/Project/nhnChess/ChessAlkkkaegi/lean` → `PASS`, 81 declarations, no `sorry` or added axiom. See [check log](stage-lean-check.log).
- Mutations: `python3 /mnt/c/Users/DooBokWie/.codex/skills/agent-formal-verify/scripts/mutate.py /mnt/c/Users/DooBokWie/Desktop/Project/nhnChess/ChessAlkkkaegi/lean/Model/StageDrawRestart.mutations` → 5/5 detected. See [mutation log](stage-lean-mutations.log).

The 55 bounded pairs cover `1 ≤ start ≤ drawAt ≤ 10`. The reach checks include (1,1), (1,10), and (10,10), and every trace visits draw terminal, menu, failed-reset rollback, fresh stage 1, and its accepted win. `badCases.isEmpty` checks payout equals the sum of stages `start..drawAt-1`, permanent points increase once, and the duplicate result has no effect. The unbounded Lean theorems prove duplicate draw idempotence, rollback on a failed fresh run, payout transfer, and accepted stage 1 clear from every terminal state.

The [check log](stage-lean-check.log) emits 55 `stage-fixed|START|DRAW_AT|PAYOUT|NEXT_ACCEPTED` lines. Lean model vectors are ready for comparison with the parent's native source-level test; that comparison was not run in this worker task, so no production agreement count is claimed here.
