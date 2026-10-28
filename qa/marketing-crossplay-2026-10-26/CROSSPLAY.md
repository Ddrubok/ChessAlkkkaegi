# Marketing QA crossplay — 2026-10-26

## Build and scope

- Local staging web bundle: `assets/public/build-info.json` reports build `0a1cd04f0d32-dirty-20261026054120`, built 2026-10-26 05:41:20 UTC.
- Installed Android QA package: `com.chessalkkagi.app.marketingqa`, versionName `1.0.12`, versionCode `13`, target SDK `36`. The isolated QA manifest labels it `Chess Marketing QA` and requests Internet permission.
- Endpoints: local staging preview and one physical Android device. This does not establish behavior across different networks or a network change during a match.

## Verified from completed artifacts

| Case | Result | Evidence |
| --- | --- | --- |
| Web guest and Android guest entry | Passed | `web-host.json`, `android-host.json`; lobby screenshots |
| Web creates room; Android joins | Passed | `web-host.json`; `screenshots/web-host-*-connected.png` |
| Android creates room; web joins | Passed | `android-host.json`; `screenshots/android-host-*-connected.png` |
| Web mouse shot and native Android touch shot, in both host directions | Passed with launch acceptance and speed | [manual-input-results.json](../marketing-measurement-2026-10-26/manual-input-results.json): four accepted gestures, actual initial speed 3.83–3.94. Android uses ADB touchscreen tap/swipe |
| Android app backgrounded for three seconds, then returned to active connected game | Observed | `web-host.json`, `screenshots/web-host-android-background-return.png` |
| Exit confirmation, cancel, then exit and remote victory | Observed | `web-host.json`, `screenshots/web-host-menu-confirmation.png`, `web-host-remote-after-menu-exit.png` |
| Web host: three consecutive full-board results through legal physics input | Passed for terminal flow | `normal-matches.json`; `screenshots/normal-match-{1,2,3}-native-final.png` |
| Android host: three consecutive full-board results through legal physics input | Passed for terminal flow | `android-host-normal-matches.json`; `screenshots/android-host-normal-match-{1,2,3}-native-final.png` |
| Rematch request, remote acceptance, and new match ready at turn 0 on both clients | Passed four times, twice per host direction | Both normal-match JSON files (`rematchAccepted`, `rematchNewMatchTurnZero` on matches 1 and 2) |
| Different networks / network change | Unverified | Not tested; device Wi-Fi left unchanged |

The earlier `web-host.json` / `android-host.json` gesture cases only recorded a gesture and turn transfer. They did not establish accepted launch or distinguish a timeout turn. Their old `passed` field is **not sufficient launch evidence**. The coordinator reran both directions using actual input and an observation-only wrapper around the normal launch policy. All four requests were accepted with nonzero initial speed; this stronger evidence is in `manual-input-results.json`. Early CDP gesture attempts could not select the intended Android pawn; the final run uses a clear pawn and native ADB input, without a product-code change.

The three completed web-host games used 31 accepted QA autoplay shots each through `inputRuntime.policy.queueLaunch`, with zero rejected requests. Each shot aimed an actual piece outward using its rendered position and body center; ring-out and result came from normal physics and game rules. Both clients reached `match-over` with one piece remaining and showed opposite outcomes (web loss, Android win). This is rule-valid terminal-flow QA, **not evidence of player skill, competitive play, or game enjoyment**. No match-result callback, winner, board state, physics body, or clock was written directly.

The first and second result screens were followed by clicking the visible web rematch button and the Android accept button. On each occasion both clients entered `ready` at turn 0. The third native result screenshot is an actual device screenshot captured with ADB. The test script closed its own preview and browser sessions; the QA app remains installed.

The coordinator repeated the same three-game sequence with Android hosting, finishing at 2026-10-26 06:14:58 UTC (15:14:58 KST). Each game had 31 accepted shots, zero rejections, matching terminal states and opposite results (web win, Android loss). Android requested each rematch and web accepted. Both restarted at turn 0 twice. Total coverage is six completed games and four accepted rematches across the two host directions, on the existing connected network setup. Both third-game native result screenshots were visually inspected. The test ports and ADB forwards were closed after completion.

## Reproduce

Run from the repository root with the QA app installed and the recorded ADB device available:

```powershell
node qa/marketing-measurement-2026-10-26/manual-input-check.mjs
node qa/marketing-crossplay-2026-10-26/normal-matches.mjs
node qa/marketing-crossplay-2026-10-26/normal-matches.mjs --android-host
```

The scripts operate the separate QA package and staging backend. They are not production Play-app or different-network checks. Do not run the device scripts concurrently.
