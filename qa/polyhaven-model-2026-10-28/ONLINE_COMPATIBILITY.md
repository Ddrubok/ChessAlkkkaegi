# Online physics compatibility — 2026-10-28

The old and new colliders can produce the same initial pose-only `stateHash`. A pose snapshot cannot replace collider geometry. Online `ready` and `resume` messages now carry `physicsRevision`. Production builds derive it from the current `chess-set.meta.json` bytes through `__CHESS_PHYSICS_REVISION__`; Vite SSR headless checks use the runtime fallback `polyhaven-2026-10-28`.

The parser preserves a missing revision as `undefined` for legacy peers and rejects malformed values. Both handshake paths compare revisions before activating a match or replaying/resolving state. A missing or unequal revision rejects readiness, closes the transport, blocks input, and gives update/reload guidance. Matching revisions continue through state-hash comparison and snapshot recovery. Rematches use the same `ready` path.

The initial direct `node src/tools/online-check.mjs` run failed with Rapier WASM `RuntimeError: unreachable` in `preSettlePhysics`. The existing `check:regressions` command loads `headless-browser-env.mjs` before this harness; that setup also let the complete online check reach its final rematch scenario. The harness now imports the same shared preload itself instead of using its own incomplete DOM stub. Temporary mismatch peers are closed after each assertion so their timers do not keep Node alive. No production physics code changed for this harness failure.

Checks from `web` after the harness fix:

- `node src/tools/online-check.mjs` — passed with exit code 0. This includes malformed/legacy/unequal revision rejection, matching-version play and hashes, intentional desync recovery, reconnect, full resume and four subsequent turns, and rematch accept/decline/simultaneous/disconnected cases.
- `node --import ./src/tools/headless-browser-env.mjs src/tools/online-check.mjs` — passed through the final rematch scenario (the package's existing invocation).
- `node src/tools/online-check.mjs --compat-only` — passed with exit code 0.
- `npm exec tsc -- --noEmit` — passed with exit code 0.
- `git diff --check -- web/src/tools/online-check.mjs` — passed.

The deliberate mismatch fixtures emit protocol errors to the console; these are expected rejection evidence.
