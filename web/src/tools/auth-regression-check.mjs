/**
 * auth-regression-check.mjs
 * Mocked regression tests for account isolation, server-owned ratings,
 * non-rating profile writes, and safe sign-up error handling.
 *
 * Covers web-review-2026-09-14 findings 4, 5, 7.
 * Headless environment, Vite SSR, zero external network.
 */
import { MemoryStorage } from "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

globalThis.sessionStorage = new MemoryStorage();
if (!globalThis.window.location) {
  globalThis.window.location = { search: "", hostname: "localhost" };
}

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

let passes = 0;
let failures = 0;

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passes++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    failures++;
  }
}

try {
  const auth = await vite.ssrLoadModule("/src/supabase-auth.ts");

  console.log("=== Running Supabase Auth Regression Suite ===");
  await runAsyncTest("Late profile responses cannot overwrite the next account", async () => {
    let account = "first";
    localStorage.setItem("ca_local_mmr", "1800");
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: account } } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
        account = "second";
        return { data: { id: "first", mmr: 1200, referral_code: "FIRST" }, error: null };
      } }) }) }),
    };
    await assert.rejects(auth.getOrCreateUserProfile(client), /계정이 변경/);
    assert.equal(localStorage.getItem("ca_local_mmr"), "1800");
  });
  await runAsyncTest("Profile read failures do not create a replacement profile", async () => {
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "first" } } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("read failed") }) }) }) }),
    };
    await assert.rejects(auth.getOrCreateUserProfile(client), /read failed/);
  });

  // --------------------------------------------------------------------------
  // Finding 5: Account switching and server ratings precedence
  // --------------------------------------------------------------------------
  await runAsyncTest("Finding 5: signOutUser clears local account ratings", async () => {
    localStorage.setItem("ca_local_classic_mmr", "2000");
    localStorage.setItem("ca_local_strategy_mmr", "1900");
    localStorage.setItem("ca_local_classic_wins", "42");
    localStorage.setItem("ca_local_wins", "42");
    localStorage.setItem("ca_guest_user_uuid", "dummy-uuid");

    const mockClient = { auth: { signOut: async () => ({ error: null }) } };
    await auth.signOutUser(mockClient);

    assert.equal(localStorage.getItem("ca_local_classic_mmr"), null);
    assert.equal(localStorage.getItem("ca_local_strategy_mmr"), null);
    assert.equal(localStorage.getItem("ca_local_classic_wins"), null);
    assert.equal(localStorage.getItem("ca_local_wins"), null);
    assert.equal(localStorage.getItem("ca_guest_user_uuid"), null);
  });

  await runAsyncTest("Finding 5: Authenticated profile uses server ratings over stale local storage", async () => {
    // Inject leftover local cache from another user
    localStorage.setItem("ca_local_classic_mmr", "2400");
    localStorage.setItem("ca_local_classic_wins", "99");

    const mockClient = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: "user-beta", email: "beta@test.com" } } },
        }),
      },
      from: (table) => {
        assert.equal(table, "profiles");
        return {
          select: () => ({
            eq: (_col, val) => {
              assert.equal(val, "user-beta");
              return {
                maybeSingle: async () => ({
                  data: {
                    id: "user-beta",
                    nickname: "BetaPlayer",
                    classic_mmr: 1200,
                    strategy_mmr: 1200,
                    classic_wins: 3,
                    referral_code: "BETA123",
                  },
                  error: null,
                }),
              };
            },
          }),
        };
      },
    };

    const profile = await auth.getOrCreateUserProfile(mockClient);
    assert.equal(profile.id, "user-beta");
    assert.equal(profile.classicMmr, 1200, "Must be server MMR 1200, never 2400 from local storage");
    assert.equal(profile.classicWins, 3, "Must be server wins 3, never 99 from local storage");
    assert.equal(localStorage.getItem("ca_local_classic_mmr"), "1200", "Local storage updated with authoritative server MMR");
  });

  // --------------------------------------------------------------------------
  // Finding 4: Background upsert of rating stats removed
  // --------------------------------------------------------------------------
  await runAsyncTest("Finding 4: getOrCreateUserProfile does not upsert rating stats", async () => {
    let upsertCalled = false;
    let updateCalled = false;
    let updatePayload = null;

    const mockClient = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: "user-gamma" } } },
        }),
      },
      from: (table) => {
        assert.equal(table, "profiles");
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "user-gamma",
                  nickname: "Gamma",
                  classic_mmr: 1500,
                  referral_code: null, // trigger referral generation
                },
                error: null,
              }),
            }),
          }),
          update: (payload) => {
            updateCalled = true;
            updatePayload = payload;
            return {
              eq: async () => ({ error: null }),
            };
          },
          upsert: () => {
            upsertCalled = true;
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    await auth.getOrCreateUserProfile(mockClient);
    assert.equal(upsertCalled, false, "Server owns rating stats; no background upsert should occur");
    assert.equal(updateCalled, true, "Missing referral code should trigger targeted update");
    assert.ok(updatePayload?.referral_code, "Only referral code and updated_at are modified");
    assert.equal(updatePayload?.mmr, undefined, "Rating columns must not be touched");
    assert.equal(updatePayload?.classic_mmr, undefined, "Rating columns must not be touched");
  });

  // --------------------------------------------------------------------------
  // Finding 7: Sign-up without session (email confirmation required)
  // --------------------------------------------------------------------------
  await runAsyncTest("Finding 7: signUpWithEmail returns failure and notice when session is absent", async () => {
    let profileUpsertAttempted = false;

    const mockClient = {
      auth: {
        signUp: async () => ({
          data: {
            user: { id: "pending-user" },
            session: null, // Email verification pending
          },
          error: null,
        }),
      },
      from: () => ({
        upsert: async () => {
          profileUpsertAttempted = true;
          return { error: null };
        },
      }),
    };

    const res = await auth.signUpWithEmail(mockClient, "pending@test.com", "password123", "PendingUser");
    assert.equal(res.success, false, "Must not report success when session is absent");
    assert.equal(res.needsEmailConfirmation, true, "Must flag needsEmailConfirmation");
    assert.ok(res.error?.includes("이메일"), "Must return helpful email confirmation error");
    assert.equal(profileUpsertAttempted, false, "Client without session must not attempt profile DB write");
  });

  // --------------------------------------------------------------------------
  // Finding 7: Sign-up profile write error handling and non-rating DB payload
  // --------------------------------------------------------------------------
  await runAsyncTest("Finding 7: signUpWithEmail surfaces profile write error", async () => {
    const mockClient = {
      auth: {
        signUp: async () => ({
          data: {
            user: { id: "valid-user" },
            session: { access_token: "mock-token" },
          },
          error: null,
        }),
      },
      from: (table) => {
        assert.equal(table, "profiles");
        return {
          upsert: async () => ({
            error: { message: "permission denied for table profiles" },
          }),
        };
      },
    };

    const res = await auth.signUpWithEmail(mockClient, "valid@test.com", "password123", "ValidUser");
    assert.equal(res.success, false, "Must report failure when profile write errors out");
    assert.equal(res.error, auth.formatAuthError("permission denied for table profiles"));
    assert.notEqual(res.error, "permission denied for table profiles", "Backend details must be localized for players");
  });

  await runAsyncTest("Finding 7: signUpWithEmail writes only non-rating snake_case columns", async () => {
    let capturedPayload = null;

    const mockClient = {
      auth: {
        signUp: async () => ({
          data: {
            user: { id: "new-user-123" },
            session: { access_token: "token" },
          },
          error: null,
        }),
      },
      from: (table) => {
        assert.equal(table, "profiles");
        return {
          upsert: async (payload) => {
            capturedPayload = payload;
            return { error: null };
          },
        };
      },
    };

    const res = await auth.signUpWithEmail(mockClient, "fresh@test.com", "password123", "FreshPlayer");
    assert.equal(res.success, true);
    assert.ok(capturedPayload, "Profile write payload must be sent");
    assert.equal(capturedPayload.id, "new-user-123");
    assert.equal(capturedPayload.nickname, "FreshPlayer");
    assert.ok(capturedPayload.referral_code, "Referral code generated");

    // Must NOT contain camelCase or rating columns
    assert.equal("classicMmr" in capturedPayload, false, "Must not contain camelCase classicMmr");
    assert.equal("strategyMmr" in capturedPayload, false, "Must not contain camelCase strategyMmr");
    assert.equal("classicWins" in capturedPayload, false, "Must not contain camelCase classicWins");
    assert.equal("mmr" in capturedPayload, false, "Must not attempt client write to rating column mmr");
    assert.equal("wins" in capturedPayload, false, "Must not attempt client write to rating column wins");
    assert.equal("losses" in capturedPayload, false, "Must not attempt client write to rating column losses");
  });

  // --------------------------------------------------------------------------
  // Finding 5 & Guest: Guest offline progress preserved and isolated
  // --------------------------------------------------------------------------
  await runAsyncTest("Guest offline progress is preserved and never pollutes new authenticated user", async () => {
    // Clear storage and simulate guest offline progress
    localStorage.removeItem("ca_local_classic_mmr");
    localStorage.removeItem("ca_local_classic_wins");
    localStorage.setItem("ca_guest_classic_mmr", "1350");
    localStorage.setItem("ca_guest_classic_wins", "7");

    const guestClient = {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        signInAnonymously: async () => ({ data: null, error: { message: "disabled" } }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    };

    const guestProfile = await auth.getOrCreateUserProfile(guestClient);
    assert.equal(guestProfile.classicMmr, 1350, "Guest uses guest offline rating");
    assert.equal(guestProfile.classicWins, 7, "Guest uses guest offline wins");

    // Now a new authenticated user signs up in the same browser
    const newAuthClient = {
      auth: {
        signUp: async () => ({
          data: {
            user: { id: "brand-new-user" },
            session: { access_token: "token" },
          },
          error: null,
        }),
      },
      from: () => ({ upsert: async () => ({ error: null }) }),
    };

    const signupRes = await auth.signUpWithEmail(newAuthClient, "newauth@test.com", "secret999", "NewAuthPlayer");
    assert.equal(signupRes.success, true);
    assert.equal(signupRes.user.classicMmr, 1200, "New authenticated user must start at 1200, never inheriting guest 1350");
    assert.equal(signupRes.user.classicWins, 0, "New authenticated user must start at 0 wins, never inheriting guest 7");
  });

  console.log("==========================================");
  console.log(`Test Summary: ${passes} passed, ${failures} failed.`);
  console.log("==========================================");

  if (failures > 0) {
    process.exit(1);
  }
} finally {
  await vite.close();
}
