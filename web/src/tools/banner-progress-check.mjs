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
    BANNER_IDS,
    BASIC_BANNER_IDS,
    ACHIEVEMENT_BANNER_IDS,
    getEquippedBanner,
    ownsBanner,
    equipBanner,
    getBannerProgress,
    recordBannerShot,
    recordBannerVictory,
  } = await vite.ssrLoadModule('/src/banner-progress.ts');

  const {
    MASTERY_PROGRESS_KEY,
    MASTERY_REWARDS_KEY,
    MASTERY_PREFERENCES_KEY,
    mergeMasteryValue,
    validateMasteryValues,
  } = await vite.ssrLoadModule('/src/mastery.ts');

  const { AccountProgressStorage } = await vite.ssrLoadModule('/src/progress-storage.ts');

  // --- 1. Verify exact exported constants and types ---
  assert.equal(BANNER_IDS.length, 6);
  assert.deepEqual([...BANNER_IDS], [
    'classic',
    'slate',
    'forest',
    'banner_cosmic_knight',
    'banner_crimson_sun',
    'banner_hidden_myeongnyang'
  ]);
  assert.deepEqual([...BASIC_BANNER_IDS], ['classic', 'slate', 'forest']);
  assert.deepEqual([...ACHIEVEMENT_BANNER_IDS], [
    'banner_cosmic_knight',
    'banner_crimson_sun',
    'banner_hidden_myeongnyang'
  ]);

  // Helper storage mock
  function createStorage(owner = null) {
    const store = new Map();
    return {
      owner,
      getItem(key) { return store.get(key) ?? null; },
      setItem(key, value) { store.set(key, value); },
      setItems(values) {
        for (const [k, v] of Object.entries(values)) store.set(k, v);
      }
    };
  }

  // --- 2. Guest restriction tests ---
  const guestStorage = createStorage(null);
  assert.equal(getEquippedBanner(guestStorage), 'classic', 'guest defaults to classic');
  assert.equal(ownsBanner(guestStorage, 'classic'), false, 'guest cannot own member banner');
  assert.equal(ownsBanner(guestStorage, 'banner_cosmic_knight'), false);
  assert.equal(equipBanner(guestStorage, 'forest'), false, 'guest cannot equip banner');

  // Guest shot / victory records must be no-ops
  recordBannerShot(guestStorage, {
    eventId: 'guest-shot-1',
    pieceType: 'Knight',
    enemyPieceIds: ['e-1', 'e-2', 'e-3'],
    at: '2026-09-17T10:00:00Z'
  });
  recordBannerVictory(guestStorage, {
    eventId: 'guest-win-1',
    stage: 5,
    comebackEligible: true,
    at: '2026-09-17T10:00:00Z'
  });
  assert.equal(guestStorage.getItem(MASTERY_PROGRESS_KEY), null, 'guest writes must not pollute storage');

  // --- 3. Member basic banners & initial state ---
  const memberStorage = createStorage('user-alpha');
  assert.equal(getEquippedBanner(memberStorage), 'classic', 'member defaults to classic without device migration');
  assert.equal(ownsBanner(memberStorage, 'classic'), true);
  assert.equal(ownsBanner(memberStorage, 'slate'), true);
  assert.equal(ownsBanner(memberStorage, 'forest'), true);
  assert.equal(ownsBanner(memberStorage, 'banner_cosmic_knight'), false);

  // Equip basic banner
  assert.equal(equipBanner(memberStorage, 'forest'), true);
  assert.equal(getEquippedBanner(memberStorage), 'forest');

  // Try equipping locked achievement banner -> rejected
  assert.equal(equipBanner(memberStorage, 'banner_cosmic_knight'), false);
  assert.equal(getEquippedBanner(memberStorage), 'forest', 'equipped banner remains unchanged on failed equip');

  // --- 4. Cosmic Knight progression (50 unique fallen enemy IDs) ---
  // Non-knight shot does not count toward cosmic knight
  recordBannerShot(memberStorage, {
    eventId: 'shot-pawn-1',
    pieceType: 'Pawn',
    enemyPieceIds: ['enemy-pawn-1'],
    at: '2026-09-17T10:01:00Z'
  });
  assert.equal(getBannerProgress(memberStorage, 'banner_cosmic_knight').current, 0);

  // Record 49 unique enemy pieces with Knight
  for (let i = 1; i <= 49; i++) {
    recordBannerShot(memberStorage, {
      eventId: `shot-k-${i}`,
      pieceType: 'Knight',
      enemyPieceIds: [`enemy-${i}`],
      at: `2026-09-17T10:02:${String(i).padStart(2, '0')}.000Z`
    });
  }
  const prog49 = getBannerProgress(memberStorage, 'banner_cosmic_knight');
  assert.equal(prog49.current, 49);
  assert.equal(prog49.target, 50);
  assert.equal(prog49.earned, false);
  assert.equal(ownsBanner(memberStorage, 'banner_cosmic_knight'), false);

  // Idempotence: repeating already recorded enemy IDs must NOT advance progress
  recordBannerShot(memberStorage, {
    eventId: 'shot-k-repeat',
    pieceType: 'Knight',
    enemyPieceIds: ['enemy-1', 'enemy-2'],
    at: '2026-09-17T10:03:00Z'
  });
  assert.equal(getBannerProgress(memberStorage, 'banner_cosmic_knight').current, 49);

  // Record 50th unique enemy piece
  recordBannerShot(memberStorage, {
    eventId: 'shot-k-50',
    pieceType: 'Knight',
    enemyPieceIds: ['enemy-50'],
    at: '2026-09-17T10:04:00Z'
  });
  const prog50 = getBannerProgress(memberStorage, 'banner_cosmic_knight');
  assert.equal(prog50.current, 50);
  assert.equal(prog50.target, 50);
  assert.equal(prog50.earned, true);
  assert.equal(ownsBanner(memberStorage, 'banner_cosmic_knight'), true);

  // Rewards store must have grant and item
  const rewardsJson = JSON.parse(memberStorage.getItem(MASTERY_REWARDS_KEY));
  assert.ok(rewardsJson.grants['banner:banner_cosmic_knight:v1']);
  assert.ok(rewardsJson.items['banner:banner_cosmic_knight']);

  // Now equipping cosmic knight succeeds
  assert.equal(equipBanner(memberStorage, 'banner_cosmic_knight'), true);
  assert.equal(getEquippedBanner(memberStorage), 'banner_cosmic_knight');

  // --- 5. Crimson Sun progression (Triple out in one shot) ---
  const memberStorage2 = createStorage('user-beta');
  // Two shots of 2 and 1 fallen enemies must NOT satisfy triple out
  recordBannerShot(memberStorage2, {
    eventId: 'shot-double-1',
    pieceType: 'Rook',
    enemyPieceIds: ['e-1', 'e-2'],
    at: '2026-09-17T10:10:00Z'
  });
  assert.equal(getBannerProgress(memberStorage2, 'banner_crimson_sun').current, 0);
  assert.equal(getBannerProgress(memberStorage2, 'banner_crimson_sun').earned, false);

  recordBannerShot(memberStorage2, {
    eventId: 'shot-single-2',
    pieceType: 'Bishop',
    enemyPieceIds: ['e-3'],
    at: '2026-09-17T10:11:00Z'
  });
  assert.equal(getBannerProgress(memberStorage2, 'banner_crimson_sun').current, 0);
  assert.equal(getBannerProgress(memberStorage2, 'banner_crimson_sun').earned, false);

  // Single shot with 3 fallen enemies
  recordBannerShot(memberStorage2, {
    eventId: 'shot-triple-1',
    pieceType: 'Queen',
    enemyPieceIds: ['e-4', 'e-5', 'e-6'],
    at: '2026-09-17T10:12:00Z'
  });
  const crimsonProg = getBannerProgress(memberStorage2, 'banner_crimson_sun');
  assert.equal(crimsonProg.current, 3);
  assert.equal(crimsonProg.target, 3);
  assert.equal(crimsonProg.earned, true);
  assert.equal(ownsBanner(memberStorage2, 'banner_crimson_sun'), true);
  assert.equal(equipBanner(memberStorage2, 'banner_crimson_sun'), true);
  assert.equal(getEquippedBanner(memberStorage2), 'banner_crimson_sun');

  // --- 6. Hidden Myeongnyang progression (Comeback victory) ---
  const memberStorage3 = createStorage('user-gamma');
  // Stage 4 with comeback -> stage < 5 -> rejected
  recordBannerVictory(memberStorage3, {
    eventId: 'win-st4',
    stage: 4,
    comebackEligible: true,
    at: '2026-09-17T10:20:00Z'
  });
  assert.equal(getBannerProgress(memberStorage3, 'banner_hidden_myeongnyang').earned, false);

  // Stage 5 without comeback -> rejected
  recordBannerVictory(memberStorage3, {
    eventId: 'win-st5-nocomeback',
    stage: 5,
    comebackEligible: false,
    at: '2026-09-17T10:21:00Z'
  });
  assert.equal(getBannerProgress(memberStorage3, 'banner_hidden_myeongnyang').earned, false);

  // Stage 5 with comeback -> earned
  recordBannerVictory(memberStorage3, {
    eventId: 'win-st5-comeback',
    stage: 5,
    comebackEligible: true,
    at: '2026-09-17T10:22:00Z'
  });
  const myeongProg = getBannerProgress(memberStorage3, 'banner_hidden_myeongnyang');
  assert.equal(myeongProg.current, 1);
  assert.equal(myeongProg.target, 1);
  assert.equal(myeongProg.earned, true);
  assert.equal(ownsBanner(memberStorage3, 'banner_hidden_myeongnyang'), true);
  assert.equal(equipBanner(memberStorage3, 'banner_hidden_myeongnyang'), true);
  assert.equal(getEquippedBanner(memberStorage3), 'banner_hidden_myeongnyang');

  const orphan = { 'ca_mastery_rewards_v1': memberStorage3.getItem('ca_mastery_rewards_v1') };
  assert.throws(() => validateMasteryValues(orphan), /without-progress/);
  // --- 7. Deterministic union merge between two devices ---
  const devA = createStorage('user-merge');
  const devB = createStorage('user-merge');

  for (let i = 1; i <= 30; i++) {
    recordBannerShot(devA, {
      eventId: `shot-a-${i}`,
      pieceType: 'Knight',
      enemyPieceIds: [`enemy-${i}`],
      at: '2026-09-17T11:00:00Z'
    });
  }

  for (let i = 20; i <= 49; i++) {
    recordBannerShot(devB, {
      eventId: `shot-b-${i}`,
      pieceType: 'Knight',
      enemyPieceIds: [`enemy-${i}`],
      at: '2026-09-17T11:05:00Z'
    });
  }

  const mergedProgressRaw = mergeMasteryValue(
    MASTERY_PROGRESS_KEY,
    devA.getItem(MASTERY_PROGRESS_KEY),
    devB.getItem(MASTERY_PROGRESS_KEY)
  );
  const mergedProg = JSON.parse(mergedProgressRaw);
  const mergedKnightCount = Object.keys(mergedProg.banners.banner_cosmic_knight.fallenEnemies).length;
  assert.equal(mergedKnightCount, 49, 'union of 1..30 and 20..49 must equal 49');
  assert.equal(mergedProg.banners.banner_cosmic_knight.firstAchievedAt, null);

  // Now merge with a store that reached 50
  const devC = createStorage('user-merge');
  recordBannerShot(devC, {
    eventId: 'shot-c-50',
    pieceType: 'Knight',
    enemyPieceIds: ['enemy-50'],
    at: '2026-09-17T11:10:00Z'
  });

  const mergedProgress50Raw = mergeMasteryValue(
    MASTERY_PROGRESS_KEY,
    mergedProgressRaw,
    devC.getItem(MASTERY_PROGRESS_KEY)
  );
  const mergedProg50 = JSON.parse(mergedProgress50Raw);
  assert.equal(Object.keys(mergedProg50.banners.banner_cosmic_knight.fallenEnemies).length, 50);
  assert.ok(mergedProg50.banners.banner_cosmic_knight.firstAchievedAt);

  // Preference slot merging
  const prefA = JSON.stringify({
    schemaVersion: 1,
    tracked: { medalId: null, updatedAt: '2026-09-17T10:00:00Z', deviceId: 'dev-a' },
    equipped: { banner: { itemId: 'banner:classic', updatedAt: '2026-09-17T10:00:00Z', deviceId: 'dev-a' } }
  });
  const prefB = JSON.stringify({
    schemaVersion: 1,
    tracked: { medalId: null, updatedAt: '2026-09-17T10:00:00Z', deviceId: 'dev-b' },
    equipped: { banner: { itemId: 'banner:forest', updatedAt: '2026-09-17T10:05:00Z', deviceId: 'dev-b' } }
  });
  const mergedPref = JSON.parse(mergeMasteryValue(MASTERY_PREFERENCES_KEY, prefA, prefB));
  assert.equal(mergedPref.equipped.banner.itemId, 'banner:forest', 'later preference updatedAt wins');

  // --- 8. AccountProgressStorage client integration test ---
  const values = new Map();
  const localStore = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const rows = new Map();
  let currentAuth = 'user-test';

  const mockClient = {
    rpc: async (name, args) => {
      if (args.p_expected_user_id !== currentAuth) return { error: { code: '42501' } };
      if (name === 'get_account_progress_v3') {
        const row = rows.get(currentAuth) ?? { data: {}, revision: 0 };
        return { data: { data: structuredClone(row.data), revision: row.revision, capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1'] } };
      }
      if (name === 'save_account_progress_v3') {
        const row = rows.get(currentAuth) ?? { data: {}, revision: 0 };
        if (row.revision !== args.p_expected_revision) return { error: { code: '40001' } };
        const next = { data: structuredClone(args.p_data), revision: row.revision + 1 };
        rows.set(currentAuth, next);
        return { data: { data: structuredClone(next.data), revision: next.revision, capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1'] } };
      }
      return { error: { code: 'PGRST202' } };
    }
  };

  const accountStore = new AccountProgressStorage(() => localStore);
  await accountStore.activate(mockClient, currentAuth);
  assert.equal(accountStore.bannersSupported, true);
  assert.equal(accountStore.masterySupported, true);

  // Equip and record through AccountProgressStorage
  assert.equal(equipBanner(accountStore, 'slate'), true);
  await accountStore.flush();
  assert.equal(getEquippedBanner(accountStore), 'slate');
  assert.ok(rows.get(currentAuth).data[MASTERY_PREFERENCES_KEY].includes('banner:slate'));

  console.log('PASS BANNER PROGRESS: exact exports, guest restrictions, 49->50 cosmic knight, triple out single-shot, comeback victory, deterministic union merging, preference resolution, and AccountProgressStorage integration');
} finally {
  await vite.close();
}
