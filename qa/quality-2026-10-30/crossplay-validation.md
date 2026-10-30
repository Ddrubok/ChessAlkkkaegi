# CrazyGames crossplay candidate validation — 2026-10-30 KST

Scope: `C:/Users/DooBokWie/orca/workspaces/ChessAlkkkaegi/crazygames-crossplay`, existing dirty candidate. This is local validation only. No source or environment file was edited, and no portal upload, live login, backend mutation, commit, or push was attempted.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | Pass, `npx tsc --noEmit` | `crossplay-tsc.log` (empty on success) |
| Source regression fixtures | Pass: SDK lifecycle, CrazyGames auth, invites, lobby recommendation, match cancel, turn clock | `crossplay-source-checks.log` |
| First visit SOLO tutorial and incoming invite precedence | Pass for contract and source order: first visit eligibility is captured before guest profile creation; SDK invite is prepared and starts online before the tutorial fallback; tutorial starts only with no incoming match. The invite fixture covers room and instant launch, and the recommendation fixture covers first visit and existing progress. | `crossplay-source-checks.log`, `crossplay-bootstrap-receipt.log` |
| CrazyGames production mode build | Pass. Used the **existing** root `web/.env` production public URL and `sb_publishable_` key as process environment only, after validating their shape without printing values. Ran `npm run build:crazygames -- --outDir ../qa/quality-2026-10-30/crossplay-dist`. No guard changes. | `crossplay-build.log`, `crossplay-dist/` |
| Packaged artifact | Pass: 109 files, 6,949,384 bytes; no findings from the repository artifact checker on the isolated output path. The original checker also passes `node --check`. | `crossplay-artifact-check.log`, `crossplay-build-receipt.json` |

Build manifest SHA-256: `58e45ece5797c1c908006416e528af92a74c1e67a61d433ae5a8ee25a848f593`. The receipt contains per-file SHA-256 values and build provenance. The build reports large chunk warnings, with no build failure.

## Limits and follow-up

- All SDK and auth checks used **synthetic local mocks**. They validate the source bridge and state handling, not live CrazyGames login, portal invite delivery, or Android crossplay. Android was absent from this worker's validation.
- The turn-clock fixture reported `WebSocket server error: Port 24678 is already in use` while continuing to print PASS and exit 0. Its assertions passed; the port conflict should be considered when interpreting that fixture's output.
- Browser/HTTP preview on port 5286 was not run. Automatic command review rejected the hidden background preview launch; the rejection gave no detailed reason. No process was started by that attempt, and the parent's existing port 5283 server was not touched.
- The first disposable artifact checker copy became syntactically invalid due to PowerShell text decoding. It was regenerated from the original UTF-8 bytes with only its output root changed, then `node --check` and the complete artifact check passed. The repository checker itself is valid and was not edited.
