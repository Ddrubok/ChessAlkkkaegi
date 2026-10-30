# Final web automation — 2026-10-30

Coordinator follow-up: the brittle lobby-order assertion was updated to check the actual entry order across platform conditionals. The full `npm.cmd run check:lobby-motion` command then passed. Added Host/Guest stale-polling regressions and the matching presence checks passed on both source trees. Later CSS fixes were browser-tested in 12 cases (10 viewport sizes, all 9 locales), including 180px launch and explicit cancellation. Final candidates are `*-candidate-dist`, superseding the build outputs listed below; current file hashes and IDs are in `final-web-receipt.json` and `final-crossplay-receipt.json`. Both were rebuilt with TypeScript and existing prescripts, then tested as packaged files. See [implementation](IMPLEMENTATION.md).

All commands below ran sequentially from `web/` on the current root workspace. Times are Asia/Seoul. Output is in the corresponding `final-*.log`. No physical Android device, live Supabase session, or live CrazyGames iframe was exercised.

| Command | Result |
| --- | --- |
| `node src/tools/stage-run-result-check.mjs` | Pass, exit 0 at 02:34:02. Covers 55 draw paths, duplicate settlement, loss/complete, reset failure/retry, nine languages. |
| `node src/tools/match-cancel-check.mjs` | Pass, exit 0 at 02:34:04. Covers late open, retry, stale cleanup/error, duplicate ready, ranked/friendly handoff with fakes. |
| `node src/tools/turn-clock-check.mjs` | Pass, exit 0 at 02:34:06. |
| `node src/tools/turn-timer-check.mjs` | Pass, exit 0 at 02:34:10. |
| `npm.cmd run check:regressions` | Pass, exit 0 at 02:35:10. Nonfatal Vite WebSocket port 24678 warnings appeared. |
| `npm.cmd run check:lobby` | Pass, exit 0 at 02:35:15. |
| `npm.cmd run check:auth-interaction` | Pass, exit 0 at 02:35:23. Fake storage `getItem` warnings appeared in classic cancel fixtures. |
| `npm.cmd run check:lobby-motion` | **Fail**, exit 1 at 02:35:27. First assertion in `lobby-motion-check.mjs:14` expects literal `renderQuestLobbyEntry(questStorage)}${renderWeeklyChallengeEntry()}${renderTutorialBar()}`. `menu.ts:669` now wraps quest/weekly entries in a CrazyGames conditional, so the source-text regular expression does not match. The test exits before its two later scripts. Parent owns game/test files. |
| `node src/tools/ui-motion-check.mjs` | Pass, exit 0; run separately after the chained lobby-motion failure. |
| `node src/tools/result-motion-check.mjs` | Pass, exit 0; run separately after the chained lobby-motion failure. |
| `npx.cmd tsc --noEmit --pretty false` | Pass, exit 0 at 02:35:49. |
| `npm.cmd run build -- --outDir ../qa/quality-2026-10-30/web-dist` | Pass, exit 0 at 02:35:53. Existing `prebuild` ran `check:chess` and `check:balance`; build ran `tsc --noEmit` and production Vite. Output is isolated in `web-dist`, not deployed `web/dist`. Vite reported a non-module script, large chunk, and ineffective dynamic import warnings. |

The initial PowerShell `& npm ... | Tee-Object` logging wrapper failed all four npm invocations with `Unknown command: "pm"` before invoking project scripts. Those failures remain at the start of the same logs; all four were rerun using `npm.cmd`. A direct `npm run check:lobby` also passed during diagnosis. The first vector-comparison attempt failed from a PowerShell array-wrapping mistake, also preserved in `final-vectors.log`.

The successful comparison at 02:36:17 parsed all `stage-fixed|start|drawAt|payout|nextAccepted` lines from `stage-lean-check.log` and compared the ordered objects field for field with `stage-fixed-vectors.json`: **55 Lean rows, 55 JSON rows, exact ordered equality true**. This is agreement between two recorded artifacts, not a new Lean run. `stage-model-historical.log` retains the prior failed historical proof; `stage-lean-check.log` reports the later passing 81-declaration check and `stage-lean-mutations.log` records 5/5 detected mutations. `matching-tlc.log` records 4/4 runs and 5/5 reaches; these model logs were read, not rerun.

The game files observed for this pass had modification times no later than 02:27:57 (`main.ts`); the production build finished at 02:35:53. If parent changes code or checks after these times, rerun only the checks affected by those changes before using this report as final evidence.
