# M01 readiness and M04 read-only baseline — 2026-10-26

This is the initial public-path baseline. Later installation and cross-device results are recorded in [CROSSPLAY.md](../marketing-crossplay-2026-10-26/CROSSPLAY.md); they do not retroactively verify the public Play build or different networks.

Checked **14:30–14:35 KST** from this Windows workspace with Edge Playwright fresh contexts and ADB device `10.8.4.105:41399` (`TB373FU`). Scope follows the 2026-10-26 revised marketing plan v1.1, M01 and M04. The 2026-10-12 fixes and 2026-10-22 public-test artifacts were workflow/history references, not current pass evidence. No product files, installed apps, device data, credentials, or settings were changed.

## M01 — current public paths

| Path | Live result | Entry fingerprint | Main asset and actual backend host |
|---|---|---|---|
| Dev `https://chessalkkagi-dev.pages.dev/` | HTTP 200, Edge entry/guest/practice opened | SHA-256 `eec14a8cd7f1a41f2c286b08bf9c77f7ff946f9255f869a2413eb2673eb71db0`, 5,811 bytes | `assets/index-PxZ32SYf.js`, SHA-256 `fe341b704100702ea5293bdaa0b8f39d8ba339e83662ad32cea7454a3ca853a1`; `eohasrpzjwtzexoogwdt.supabase.co` |
| Public `https://ddrubok.github.io/ChessAlkkkaegi/` | HTTP 200, Edge entry/guest/practice opened | SHA-256 `25b2dc1e4ee364eeef919469da6f7427988f30ef7b6d71afed6a7201bc5cabd6`, 4,997 bytes; HTTP Last-Modified `2026-10-12 02:14:32 GMT` | `assets/index-BbLoJ8gm.js`, SHA-256 `5b952a60cce941ef5c524e891d60543443029c07b14e0afa48e03aff2273b159`; `yoajmckkrpgvcljrffww.supabase.co` |

These are **different bundles and backend projects**. Last-Modified is an HTTP header, not verified deployment time. Neither served entry exposed a reliable commit/build ID; that mapping remains unknown. The asset host discovery excludes the bundled `xxxx.supabase.co` example placeholder. Full asset list and hashes: [probe.json](probe.json).

Both backend hosts answered unauthenticated `GET /auth/v1/health` with HTTP **401 “No API key found”**, which establishes gateway reachability but does not establish auth health. In live browser flows, each host returned HTTP **200** for `GET /auth/v1/settings` and `GET /rest/v1/profiles`, while `POST /auth/v1/signup` returned **422**. Guest lobby and practice still opened in fresh contexts; no credential login, match persistence, or complete game was tested. This is stronger current evidence than the October 23 pause email, but it does **not** justify a claim that either whole backend is restored or paused. Request paths/statuses only were saved, without keys or response tokens. [browser-smoke.json](browser-smoke.json).

Device `TB373FU` was online in `adb devices -l`; foreground was `com.zui.launcher/.drawer.DrawerLauncher`. At **14:36:41–14:36:42 KST**, `pm list packages -3`, `pm list packages -u`, and `dumpsys package` found neither `com.chessalkkagi.app` nor `com.chessalkkagi.app.publicqa`. Exact command times/results: [android-observation.json](android-observation.json). The repository build file says `com.chessalkkagi.app`, versionName `1.0.12`, versionCode `13`, but **that is source metadata, not an installed or Play-delivered version**. Android installed version, lastUpdateTime, gameplay, and actual Play Console track are therefore **unknown**. No install was attempted and user app data was preserved.

**M01 status: incomplete.** Live web entry, asset, backend host, and limited start smoke are recorded. Android public build/track and full start/login/match/save results are missing. This does not clear promotion or paid traffic gates in the revised plan.

## M04 — baseline, not a pass

- Fresh Edge guest contexts on both live web paths opened **온라인 친선전 → 친선전 (방 코드 / 친구 초대)**. [Dev friendly entry](screenshots/dev-friendly-open.png) · [Public friendly entry](screenshots/public-friendly-open.png).
- After **새 방 만들기**, the dev web path reached **“상대방이 참가하기를 기다리는 중입니다…”** after 20 seconds; a Supabase Realtime WebSocket was observed open. This checks only host entry, not peer connection.
- After the same action on public web, the UI showed **“P2P 네트워크 연결에 실패했습니다.”** by 20 seconds, although a Realtime WebSocket opened. This is a reproducible single-attempt failure on the current public path; the precise signaling/WebRTC cause is unproven. Its only visible recovery in the modal was **취소**, so the state tells the user that connection failed without an inline retry action. [friendly-entry.json](friendly-entry.json).
- No second physical Android game client was installed. Web↔Android join, both shots, turn transfer, result, rematch, three consecutive matches, disconnect/background/network changes, and reverse host roles were **not run**. Previous 2026-10-12 QA remains historical evidence only.

**M04 status: blocked for the required cross-device baseline by missing Android package; public web host creation also failed in one current attempt.** Do not label three games as passed. A usable next run needs an authorized installed public/QA Android build or a second compatible client, with its version and backend identified before pairing.

## Evidence and limits

- [probe.mjs](probe.mjs) and [probe.json](probe.json): live HTTP entry/assets, hashes, asset-embedded backend hosts, unauthenticated health response; run at `2026-10-26T05:30:54Z`.
- [browser-smoke.mjs](browser-smoke.mjs), [browser-smoke.json](browser-smoke.json), and `screenshots/{dev,public}-{entry,guest,practice}.png`: fresh Edge guest and first practice screen; run about 14:31–14:33 KST. Practice opened; no shot or tutorial completion occurred.
- [friendly-entry.mjs](friendly-entry.mjs), [friendly-entry.json](friendly-entry.json), and `screenshots/{dev,public}-friendly-{before,open}.png`: guest friendly entry and host creation; final repeated run about 14:34–14:35 KST. Ephemeral room codes were not logged or screenshotted.
- [android-observe.mjs](android-observe.mjs) and [android-observation.json](android-observation.json): read-only ADB package/model/foreground observation. No Play Console access was available, so track and store metadata were not verified.
