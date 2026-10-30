# Match cancellation repair (2026-10-30)

Coordinator follow-up: the shared matcher and guarded UI callbacks were subsequently merged into the crossplay workspace, retaining its account-version checks. Both source paths passed the new cancellation check. A further failing test found stale 80ms polling after immediate retry; Host and Guest polling now stop on attempt/peer mismatch. Late Guest-ready signals are also gated. This final runtime check includes explicit Guest handoff and stale data channel rejection. Refer to [final implementation](IMPLEMENTATION.md) and the candidate receipts for the latest files; the worker results below record the earlier point in time.

## Scope and intent

Player action: cancel ranked search or a direct friendly connection, then optionally search again. The UI must remain on the chosen screen and must not start a game from the cancelled attempt. Existing WebRTC play and the transport handed to the game must continue normally. This applies to Android/Google Play and the CrazyGames browser path; device behavior was not measured here.

## Root cause and change

`cancel()` marked the attempt cancelled, but `cleanup()` awaited `channel.untrack()` and `removeChannel()` before closing the peer and data channel. A WebRTC open event during those awaits entered `onConnectionEstablished()`, which checked only `isConnectionEstablished` and emitted ready. The old cleanup could then close a new retry's peer.

`supabase-matchmaker.ts` now increments an attempt token at start, cancel and error; detaches and closes locally owned peer resources before the first Supabase await; and checks cancellation, attempt, match ID and peer/data channel identity before ready. It transfers peer ownership to the transport before invoking ready, so a later matcher cleanup cannot close the game connection. Old channel callbacks and resumed setup/signaling work are gated. `supabase-match-ui.ts` also checks its active matcher before status, ready and error callbacks; a rejected stale ready closes its transport.

The separate read-only `crazygames-crossplay` checkout still has the old `onConnectionEstablished()` guard and await-first `cleanup()` (same regions around lines 785 and 920). Parent integration should transplant this matcher and UI change into that checkout after reconciling its other edits; do not copy generated assets or overwrite its independent work. The direct friendly caller in `main.ts` uses the same matcher class, so its early cancel and successful handoff are covered by the focused check.

## Checks actually run

| Check | Result | Evidence |
| --- | --- | --- |
| `node web/src/tools/match-cancel-check.mjs` | Pass. Covers cancel during initial setup; late open during untrack/remove waits; cancel and immediate retry; stale cleanup/error; duplicate open; reentrant connected-status cancellation; ranked and friendly handoff. Deterministic fakes, no network. | [matching-runtime.log](matching-runtime.log) |
| `node src/tools/matchmaking-presence-check.mjs` from `web/` | Pass. Existing queue presence/cancel/re-entry regression. | Console output; not separately logged. |
| `npx tsc --noEmit --pretty false` from `web/` | Pass, no TypeScript errors. | Console output; not separately logged. |
| WSL `tlc-matrix.sh tla/MatchCancel.matrix` | 4/4 runs and 5/5 reaches pass, 186 total distinct states across runs. `NoLateReady` unchanged in meaning. | [matching-tlc.log](matching-tlc.log) |
| WSL `mutate.py tla/MatchCancel.mutations` | 5/5 mutations detected across type, ownership, late ready, ready once and cleanup liveness. | [matching-mutations.log](matching-mutations.log) |

TLC scope: one matcher and at most two attempts, abstract WebRTC event delivery, and eventual settlement of awaited Supabase calls for liveness. The runtime check uses the production class with fake browser/WebRTC/Supabase objects. No Android device, live Supabase, or CrazyGames preview was run in this worker scope. Existing 2026-10-29 failure logs were left unchanged.
