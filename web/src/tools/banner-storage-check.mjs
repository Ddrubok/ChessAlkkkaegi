import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false }
});

try {
  const {
    MASTERY_PROGRESS_KEY,
    MASTERY_REWARDS_KEY,
    MASTERY_PREFERENCES_KEY,
  } = await vite.ssrLoadModule('/src/mastery.ts');

  const {
    equipBanner,
    getEquippedBanner,
    recordBannerShot,
    getBannerProgress,
  } = await vite.ssrLoadModule('/src/banner-progress.ts');

  const { AccountProgressStorage } = await vite.ssrLoadModule('/src/progress-storage.ts');

  console.log('--- TEST 1: Strict v2 Mock Fallback & Banner Extension Strip ---');
  const values = new Map();
  const local = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  const rows = new Map();
  let v3Enabled = false;
  let auth = 'user-test-1';

  // Strict Mock: V2 endpoint REJECTS any payload containing banner fields
  function assertNoBannerFields(data) {
    if (!data) return;
    if (data[MASTERY_PROGRESS_KEY]) {
      const p = JSON.parse(data[MASTERY_PROGRESS_KEY]);
      if (p && typeof p === 'object' && ('banners' in p)) {
        throw new Error('Strict V2 Mock Error: banners field found in ca_mastery_progress_v1');
      }
    }
    if (data[MASTERY_REWARDS_KEY]) {
      const r = JSON.parse(data[MASTERY_REWARDS_KEY]);
      if (r && typeof r === 'object') {
        if (r.grants && Object.keys(r.grants).some(k => k.startsWith('banner:'))) {
          throw new Error('Strict V2 Mock Error: banner grant found in ca_mastery_rewards_v1');
        }
        if (r.items && Object.keys(r.items).some(k => k.startsWith('banner:'))) {
          throw new Error('Strict V2 Mock Error: banner item found in ca_mastery_rewards_v1');
        }
      }
    }
    if (data[MASTERY_PREFERENCES_KEY]) {
      const f = JSON.parse(data[MASTERY_PREFERENCES_KEY]);
      if (f && typeof f === 'object' && f.equipped && ('banner' in f.equipped)) {
        throw new Error('Strict V2 Mock Error: banner slot found in ca_mastery_preferences_v1 equipped');
      }
    }
  }

  const client = {
    rpc: async (name, args) => {
      if (name === "get_account_progress_v4") return { error: { code: "PGRST202" } };
      const targetUser = args.p_expected_user_id;
      if (targetUser !== auth) return { error: { code: '42501' } };

      if (name === 'get_account_progress_v3') {
        if (!v3Enabled) return { error: { code: 'PGRST202' } };
        const row = rows.get(targetUser) ?? { data: {}, revision: 0 };
        return {
          data: {
            data: structuredClone(row.data),
            revision: row.revision,
            capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1']
          }
        };
      }

      if (name === 'save_account_progress_v3') {
        if (!v3Enabled) return { error: { code: 'PGRST202' } };
        const row = rows.get(targetUser) ?? { data: {}, revision: 0 };
        if (row.revision !== args.p_expected_revision) return { error: { code: '40001' } };
        const next = { data: structuredClone(args.p_data), revision: row.revision + 1 };
        rows.set(targetUser, next);
        return {
          data: {
            data: structuredClone(next.data),
            revision: next.revision,
            capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1']
          }
        };
      }

      if (name === 'get_account_progress_v2') {
        const row = rows.get(targetUser) ?? { data: {}, revision: 0 };
        return {
          data: {
            data: structuredClone(row.data),
            revision: row.revision,
            capabilities: ['account-progress-v1', 'mastery-v1']
          }
        };
      }

      if (name === 'save_account_progress_v2') {
        assertNoBannerFields(args.p_data);
        const row = rows.get(targetUser) ?? { data: {}, revision: 0 };
        if (row.revision !== args.p_expected_revision) return { error: { code: '40001' } };
        const next = { data: structuredClone(args.p_data), revision: row.revision + 1 };
        rows.set(targetUser, next);
        return {
          data: {
            data: structuredClone(next.data),
            revision: next.revision,
            capabilities: ['account-progress-v1', 'mastery-v1']
          }
        };
      }

      return { error: { code: 'PGRST202' } };
    }
  };

  const store = new AccountProgressStorage(() => local);
  await store.activate(client, auth);

  assert.equal(store.bannersSupported, false, 'bannersSupported must be false on v2 fallback');
  assert.equal(store.masterySupported, true, 'masterySupported must be true on v2 fallback');
  assert.equal(store.bannersPending, false, 'bannersPending initially false');

  // 1a. Standard non-banner mastery write
  store.setItem('ca_mastery_preferences_v1', JSON.stringify({
    schemaVersion: 1,
    tracked: { medalId: 'M01', updatedAt: '2026-09-17T12:00:00.000Z', deviceId: 'dev1' },
    equipped: {}
  }));
  await store.flush();
  assert.equal(store.bannersPending, false, 'no banner extensions, so bannersPending remains false');
  assert.equal(store.status, '서버에 저장되었습니다.');

  // 1b. Add banner extension (equip banner)
  assert.equal(equipBanner(store, 'slate'), true);
  assert.equal(store.bannersPending, true, 'bannersPending is true when banner extension is retained locally on v2');

  // Flush to strict v2 server -> must strip banner fields and succeed
  const flushed = await store.flush();
  assert.equal(flushed, true, 'flush to v2 with banner extensions must succeed');
  assert.equal(store.bannersPending, true, 'bannersPending remains true while retained locally on v2');
  assert.equal(store.masteryPending, false, 'masteryPending false because v2 mastery is supported');
  assert.equal(store.status, '기존 진행도는 서버에 저장되었습니다. 새 숙련 기록은 서버 업데이트 전까지 이 기기에 보관됩니다.');
  assert.equal(getEquippedBanner(store), 'slate', 'equipped banner preserved in local store');

  // 1c. Record banner progress
  for (let i = 1; i <= 5; i++) {
    recordBannerShot(store, {
      eventId: `shot-${i}`,
      pieceType: 'Knight',
      enemyPieceIds: [`enemy-${i}`],
      at: `2026-09-17T12:0${i}:00.000Z`
    });
  }
  assert.equal(getBannerProgress(store, 'banner_cosmic_knight').current, 5);
  await store.flush();
  assert.equal(store.bannersPending, true);
  assert.equal(store.saveFailed, false);

  assert.ok(values.has('ca_account_progress_v4:' + auth), 'new client must use separate cache namespace');
  assert.equal(values.has('ca_account_progress_v1:' + auth), false, 'old strict parser cache must not receive new fields');
  console.log('--- TEST 2: Preservation Through Reload ---');
  const reloaded = new AccountProgressStorage(() => local);
  await reloaded.activate(client, auth);
  assert.equal(reloaded.bannersSupported, false);
  assert.equal(reloaded.bannersPending, true, 'bannersPending restored on reload');
  assert.equal(getEquippedBanner(reloaded), 'slate', 'equipped banner preserved after reload');
  assert.equal(getBannerProgress(reloaded, 'banner_cosmic_knight').current, 5, 'banner progress preserved after reload');
  assert.equal(reloaded.status, '계정 진행도를 불러왔습니다. 새 숙련 기록은 서버 업데이트 전까지 이 기기에 보관됩니다.');

  console.log('--- TEST 3: V3 Later Available Retry ---');
  // Enable V3 on the server
  v3Enabled = true;
  await reloaded.retry(true);
  assert.equal(reloaded.bannersSupported, true, 'bannersSupported becomes true after v3 upgrade');
  assert.equal(reloaded.bannersPending, false, 'bannersPending resets to false after v3 sync');
  assert.equal(reloaded.status, '서버에 저장되었습니다.');

  const serverRow = rows.get(auth);
  const serverPref = JSON.parse(serverRow.data[MASTERY_PREFERENCES_KEY]);
  assert.equal(serverPref.equipped.banner.itemId, 'banner:slate', 'v3 server now contains banner equipment');
  const serverProg = JSON.parse(serverRow.data[MASTERY_PROGRESS_KEY]);
  assert.equal(Object.keys(serverProg.banners.banner_cosmic_knight.fallenEnemies).length, 5, 'v3 server now contains banner progress');

  console.log('--- TEST 4: Account-Switch Stale Async Capability Probe ---');
  let releaseLateV3Probe;
  const lateProbePromise = new Promise(resolve => { releaseLateV3Probe = resolve; });

  const staleProbeClient = {
    rpc: async (name, args) => {
      if (name === "get_account_progress_v4") return { error: { code: "PGRST202" } };
      if (args.p_expected_user_id === 'account-slow-a') {
        if (name === 'get_account_progress_v3') {
          await lateProbePromise;
          return {
            data: {
              data: {},
              revision: 0,
              capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1']
            }
          };
        }
      }
      if (args.p_expected_user_id === 'account-fast-b') {
        if (name === 'get_account_progress_v3') {
          return { error: { code: 'PGRST202' } };
        }
        if (name === 'get_account_progress_v2') {
          return {
            data: {
              data: {},
              revision: 0,
              capabilities: ['account-progress-v1', 'mastery-v1']
            }
          };
        }
      }
      return { error: { code: 'PGRST202' } };
    }
  };

  const switchStore = new AccountProgressStorage(() => local);
  // Start slow probe for account-slow-a
  const slowActivate = switchStore.activate(staleProbeClient, 'account-slow-a');

  // Immediately switch to account-fast-b
  await switchStore.activate(staleProbeClient, 'account-fast-b');
  assert.equal(switchStore.owner, 'account-fast-b');
  assert.equal(switchStore.bannersSupported, false, 'account-fast-b probed v2 fallback');

  // Now let the late probe for account-slow-a resolve
  releaseLateV3Probe();
  await slowActivate;

  // Verify account-slow-a probe did NOT overwrite account-fast-b's flags!
  assert.equal(switchStore.owner, 'account-fast-b');
  assert.equal(switchStore.bannersSupported, false, 'late probe must not mutate active account flags');

  console.log('--- TEST 5: Reject Successful V3 Response Lacking Capabilities ---');
  const invalidV3Client = {
    rpc: async (name) => {
      if (name === "get_account_progress_v4") return { error: { code: "PGRST202" } };
      if (name === 'get_account_progress_v3') {
        return {
          data: {
            data: {},
            revision: 0,
            capabilities: ['some-unrelated-capability']
          }
        };
      }
      return { error: { code: 'PGRST202' } };
    }
  };

  const rejectStore = new AccountProgressStorage(() => local);
  await rejectStore.activate(invalidV3Client, 'account-invalid');
  assert.equal(rejectStore.ready, false, 'storage must not be ready when required capabilities are missing');
  assert.equal(rejectStore.saveFailed, true);
  assert.equal(rejectStore.bannersSupported, null);

  console.log('--- TEST 6: Locked/Unsafe Writes Guarded ---');
  assert.throws(() => {
    rejectStore.setItem('chessAlkkagi.meta.maxStage', '1');
  }, /계정 진행도를 먼저 불러와 주세요/);

  // Corrupted cache safety test
  local.setItem('ca_account_progress_v1:corrupt-user', '{invalid json');
  const corruptStore = new AccountProgressStorage(() => local);
  await corruptStore.activate(client, 'corrupt-user');
  assert.equal(corruptStore.ready, false);
  assert.equal(corruptStore.unsafeData, true);
  assert.equal(corruptStore.conflict, true);
  assert.equal(corruptStore.status, '기기 캐시가 손상되어 원본을 보존하고 계정 저장을 멈췄습니다. 복구 후 서버 기록 사용을 선택해 주세요.');
  assert.throws(() => {
    corruptStore.setItem('chessAlkkagi.meta.maxStage', '1');
  }, /계정 진행도를 먼저 불러와 주세요/);

  console.log('--- TEST 7: Concurrent Dirty Edits During Flush ---');
  let holdFlush;
  const flushGate = new Promise(resolve => { holdFlush = resolve; });

  const concurrentClient = {
    rpc: async (name, args) => {
      if (name === "get_account_progress_v4") return { error: { code: "PGRST202" } };
      if (name === 'get_account_progress_v3') {
        return {
          data: {
            data: {},
            revision: 0,
            capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1']
          }
        };
      }
      if (name === 'save_account_progress_v3') {
        await flushGate;
        const row = rows.get(args.p_expected_user_id) ?? { data: {}, revision: 0 };
        const next = { data: structuredClone(args.p_data), revision: row.revision + 1 };
        rows.set(args.p_expected_user_id, next);
        return {
          data: {
            data: structuredClone(next.data),
            revision: next.revision,
            capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1']
          }
        };
      }
      return { error: { code: 'PGRST202' } };
    }
  };

  const concurrentStore = new AccountProgressStorage(() => local);
  await concurrentStore.activate(concurrentClient, 'concurrent-user');

  // Trigger first write and flush
  concurrentStore.setItem('chessAlkkagi.meta.maxStage', '2');
  const inFlightFlush = concurrentStore.flush();

  // Make concurrent edit while flush is in-flight
  concurrentStore.setItem('chessAlkkagi.meta.points', '50');
  concurrentStore.setItem('chessAlkkagi.meta.upgrades', '{}');

  // Release the flush gate and wait for completion
  holdFlush();
  await inFlightFlush;

  assert.equal(rows.get('concurrent-user').data['chessAlkkagi.meta.maxStage'], '2');
  assert.equal(rows.get('concurrent-user').data['chessAlkkagi.meta.points'], '50');
  assert.equal(concurrentStore.getItem('chessAlkkagi.meta.points'), '50');

  // Cleanup
  store.suspend();
  reloaded.suspend();
  switchStore.suspend();
  rejectStore.suspend();
  corruptStore.suspend();
  concurrentStore.suspend();

  console.log('PASS ALL BANNER STORAGE TESTS: v3 missing / v2 fallback, strict v2 banner rejection, reload preservation, v3 retry upgrade, account-switch stale probe race condition guard, invalid capabilities rejection, locked writes guard, and concurrent dirty edits.');
} finally {
  await vite.close();
}
