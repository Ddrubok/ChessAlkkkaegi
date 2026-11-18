# 1.0.23 publication preflight — independent source review

Reviewed 2026-11-18 against the staged index on `release/1.0.23-main`. This is a source and record review, not a publication result.

## Findings

- The staged Android Gradle configuration uses `versionName "1.0.23"` and `versionCode 24` in `web/android/app/build.gradle`. The release notes and verification record identify the same version.
- The eight staged runtime/test files `web/package.json`, `web/src/main.ts`, `web/src/online.ts`, `web/src/physics.ts`, `web/src/scene.ts`, `web/src/tools/online-check.mjs`, `web/src/tools/online-recovery-ui-check.mjs`, and `web/src/ui-text.ts` have no indexed diff from `bacf878` (the previously QA-verified source commit). The staged source delta from `origin/main` is the 1.0.23 release change.
- The three main-only files differing from `origin/develop`—`supabase/TUTORIAL_REWARDS_SETUP.md`, `web/src/tools/cosmetics-view-check.mjs`, and `web/src/tools/interstitial-menu-check.mjs`—have no indexed diff from `origin/main`. The staged merge retains those fixes and the older main release records. No new database migration is present in the staged release delta.
- The original 1.0.22 `publish/RESULT-ko.md` and `published.json` record the production solo-run migration as applied, and itch channel `ddurubok/chess-alkkagi:html` as uploaded at 1.0.22/build 2401810. Those records do not establish the current live 1.0.23 state.
- The 1.0.23 verification record says the original natural physics divergence did not recur in the live retest; missing-piece and terminal/stale/error paths used automated fault injection. It explicitly does not claim a root-cause fix or a real production account end-to-end test. The itch notes follow that scope.

## Checks and remaining publication work

- Actually run here: read-only staged comparisons with `git diff --cached` against `bacf878`, `origin/main`, and `origin/develop`; `git diff --cached --check` passed. No browser, build, runtime test, upload, or live-channel verification was run in this review.
- Relevant existing scripts for the release owner: from `web/`, `npm run check:online`, `npm run check:i18n`, `npm run check:regressions`, then `npm run build:itch` and `npm run check:itch` against the built artifact. Verify the final packaged HTML and live itch channel after upload. These are suggestions, not claimed results.
- Publication and live verification remain with the release owner. This review found no static source or migration blocker; it cannot establish that the final merged commit, itch artifact, or public channel has been published successfully.
