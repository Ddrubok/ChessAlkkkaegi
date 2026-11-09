# CrazyGames ranked account bridge

This function exchanges a signed CrazyGames `IN_GAME_AUTH` token for a normal Supabase Auth session in the production project shared with Android. It creates a stable account and profile when missing. It does not merge existing Google/Android accounts or change rankings, RLS, or matchmaking.

## Configuration and deployment

Originally deployed on 2026-10-29 to production project `yoajmckkrpgvcljrffww`. On 2026-11-09 the authorized new `chessalkkagi` submission changed the authentication target to game ID `166345` (submission `bdeba597-0be4-42c4-bb55-cace4e00cd96`). The numeric game ID and submission UUID are different identifiers. The function requires:

- `CRAZYGAMES_GAME_ID`: `166345`, matching the `gameId` claim in the current portal token. Missing or mismatched values fail closed.
- `CRAZYGAMES_ALLOWED_ORIGINS`: comma-separated, exact HTTPS origins, including `https://chessalkkagi.game-files.crazygames.com`. The submission update added that origin while retaining the previous four entries. Preserve the configured list when adding an origin; do not use a wildcard.

```sh
supabase functions deploy crazygames-auth --no-verify-jwt --project-ref yoajmckkrpgvcljrffww
```

Supabase supplies `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` to Edge Functions. Confirm they belong to the existing project. The service role key stays on the server. `SUPABASE_ANON_KEY` is the legacy anon JWT used only for the isolated `verifyOtp` session client; it does not need to equal the browser's public `sb_publishable_...` key. Email Auth must be enabled because `admin.generateLink({ type: 'magiclink' })` and `verifyOtp` obtain a normal session without sending email. Deployment uses `--no-verify-jwt` so the CrazyGames token reaches this function; this repository does not contain a Supabase CLI config file. The gateway receives the browser's public `apikey`, while this function authorizes account creation only after verifying the CrazyGames JWT against the official JWKS.

The client calls `window.CrazyGames.SDK.user.getUserToken({ signingKeyType: 'IN_GAME_AUTH' })`, then invokes `crazygames-auth` with `{ "token": "<returned JWT>" }` through Supabase JS. A successful response is `{ "session": { "access_token": "...", "refresh_token": "..." } }`; pass both values to `auth.setSession`. The client obtains the displayed username through the SDK. The stored profile nickname is a stable `CG_` plus 16 hex characters. All responses carry `Cache-Control: no-store`.

Account binding is `auth.users.app_metadata.crazygames = { game_id, user_id }` on a deterministic namespaced UUID. Synthetic email derives from that UUID under `.invalid`. The request cannot choose the ID or email. An existing account must carry the exact binding before receiving a session.

## Local checks

From the repository root:

```sh
npx --yes deno check supabase/functions/crazygames-auth/index.ts
npx --yes deno test --allow-net --allow-env supabase/tests/crazygames-auth.test.mjs
```

Tests use generated RSA keys and mocked Supabase calls; they do not create a live user. Seven tests and Deno type checking passed. Live deployment checks returned 204 for the permitted game origin, 403 for an unrelated origin, and 401 for an invalid token. The actual CrazyGames preview account then authenticated, displayed its username and ranks, and matched an Android 1.0.15 player through the existing ranked queue. See `qa/crazygames-crossplay-2026-10-29/` for separate live QA evidence and remaining checks. This function does not require a SQL migration or an Android rebuild.

References: [CrazyGames user tokens](https://docs.crazygames.com/sdk/user/), [Supabase admin generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [Supabase verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp).
