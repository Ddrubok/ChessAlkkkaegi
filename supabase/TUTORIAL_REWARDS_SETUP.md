# Tutorial first-completion rewards

Basic and advanced tutorials each grant 100P on first completion. Replays are free and grant no additional points. Existing balances are not recalculated or reclaimed; an existing completion flag counts as already rewarded.

## Deployment

Apply `migrations/202610300001_tutorial_first_rewards.sql` once to a project that already has the account-progress schema, before releasing the updated client. It creates the reward ledger, the authenticated claim RPC and the completion-preservation trigger. This is not a reset script and is not intended to be rerun after successful installation.

- Development `chessalkkagi-dev` (`eohasrpzjwtzexoogwdt`): applied on 2026-10-30. Checked table RLS, RPC permissions, first/repeated basic and advanced claims, wrong-account rejection and anonymous-role rejection. The claim test used transaction-scoped fixture data and rolled it back. Existing progress was unchanged.
- Production `chessalkkagi` (`yoajmckkrpgvcljrffww`): applied on 2026-10-30 before the 1.0.16 client release. Checked table RLS, authenticated-only RPC access, SECURITY DEFINER ownership and the completion trigger. All 5 existing progress records retained the same aggregate fingerprint; 4 basic and 2 advanced completions were backfilled, with no duplicate or orphan grants. Production verification was read-only after migration; no test accounts or reward claims were created there. First/repeated claim behavior was previously checked in development and locally.

The client displays a pending/retry state if the RPC is absent or its response cannot be confirmed. It does not show an unconfirmed reward as granted.

Guest points and completion flags are saved in one local-storage record. Clearing browser storage is outside the guest persistence guarantee. The account RPC prevents duplicate claims through this RPC; the pre-existing client-authored progress API and old-client reward behavior are not converted into a server-authoritative economy by this migration.

## Local checks

From the repository root, using the existing SQL-test dependency convention:

```powershell
npm install --prefix .orca/sql-check --no-save --package-lock=false @electric-sql/pglite@0.5.8
node supabase/tests/tutorial-reward-check.mjs
```

From `web` after installing its locked dependencies:

```powershell
node src/tools/tutorial-reward-check.mjs
node src/tools/new-client-reward-check.mjs
```

The SQL check uses PGlite with a minimal authentication fixture. The client checks cover repeat completion, atomic guest storage, retries, account changes and late responses. They do not replace live browser login or two-device compatibility tests.
