import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  plugins: [{
    name: 'banner-network-mock',
    load(id) {
      if (id.includes('supabase-client')) {
        return 'export function getSupabaseClient(){return globalThis.__bannerClient;}';
      }
    }
  }]
});

try {
  const { getPlayerBannerModels } = await vite.ssrLoadModule('/src/player-banner.ts');
  const theme = await vite.ssrLoadModule('/src/banner-theme.ts');
  const collection = await vite.ssrLoadModule('/src/banner-collection.ts');
  const bannerCopyModule = await vite.ssrLoadModule('/src/banner-copy.ts');
  const { I18nManager, SUPPORTED_LANGUAGES } = await vite.ssrLoadModule('/src/i18n.ts');
  const { progressStorage } = await vite.ssrLoadModule('/src/progress-storage.ts');

  // 1. Player banner models test
  const profile = { id: 'me', nickname: 'Tester', classicMmr: 1500, strategyMmr: 2300 };
  const state = {
    visible: true,
    mode: 'online',
    stage: 4,
    currentSide: 'black',
    mySide: 'black',
    profile,
    opponent: { id: 'other', nickname: 'name_%', mmr: 1800 },
    rankedMode: 'classic',
    loggedIn: true,
  };

  let models = getPlayerBannerModels(state);
  assert.equal(models.self.side, 'black');
  assert.equal(models.opponent.side, 'white');
  assert.equal(models.canAddFriend, true);

  const classic = models.self.detail;
  models = getPlayerBannerModels({ ...state, rankedMode: 'strategy' });
  assert.notEqual(models.self.detail, classic);

  models = getPlayerBannerModels({ ...state, mode: 'stage' });
  assert.equal(models.opponent.name, 'AI');
  assert.ok(models.opponent.detail.includes('4'));
  assert.equal(models.canAddFriend, false);

  assert.equal(getPlayerBannerModels({ ...state, loggedIn: false }).canAddFriend, false);
  assert.equal(getPlayerBannerModels({ ...state, opponent: null }).canAddFriend, false);
  assert.equal(getPlayerBannerModels({ ...state, opponent: { ...state.opponent, id: 'me' } }).canAddFriend, false);
  assert.equal(getPlayerBannerModels({ ...state, mode: 'hotseat' }).canAddFriend, false);
  assert.equal(getPlayerBannerModels({ ...state, mode: 'hotseat' }).opponent.detail, I18nManager.t('lobby.mode_2p_short'));

  // 2. Banner Theme & IDs validation (6 total)
  assert.equal(theme.BANNER_THEMES.length, 6);
  assert.equal(collection.BANNER_IDS.length, 6);
  const expectedIds = ['classic', 'slate', 'forest', 'banner_cosmic_knight', 'banner_crimson_sun', 'banner_hidden_myeongnyang'];
  for (const id of expectedIds) {
    assert.ok(theme.BANNER_THEMES.includes(id), `BANNER_THEMES must include ${id}`);
    assert.equal(theme.isValidTheme(id), true);
    assert.equal(theme.isValidBannerAppearance(id), true);
  }
  assert.equal(theme.isValidBannerAppearance('plain'), true);
  assert.equal(theme.isValidTheme('plain'), false);
  assert.equal(theme.isValidTheme('invalid_theme_id'), false);

  // 3. Guest vs Member Theme logic & subscription
  let changes = 0;
  const unsubscribe = theme.subscribeBannerTheme(() => changes++);

  // Guest receives 'plain'
  assert.equal(theme.getPlayerBannerTheme(false), 'plain');

  // Change theme
  theme.setBannerTheme('forest');
  assert.equal(theme.getBannerTheme(), 'classic');
  assert.equal(theme.getPlayerBannerTheme(true), 'classic');
  assert.equal(changes, 0);

  // Setting the same theme should not duplicate or error
  theme.setBannerTheme('forest');
  // Setting invalid theme should be ignored
  theme.setBannerTheme('non_existent_banner');
  assert.equal(theme.getBannerTheme(), 'classic');
  unsubscribe();

  // 4. Progress and ownership logic
  const mockGuestStorage = { owner: null, getItem: () => null };
  assert.equal(collection.ownsBanner(mockGuestStorage, 'classic'), false);
  assert.equal(collection.ownsBanner(mockGuestStorage, 'banner_cosmic_knight'), false);

  const fallenEnemies = {};
  for (let i = 1; i <= 50; i++) {
    fallenEnemies[`enemy-${i}`] = { eventId: `shot-${i}`, at: '2026-01-01T00:00:00.000Z' };
  }

  const mockMemberStorage = {
    owner: 'user-123',
    getItem: (key) => {
      if (key === 'ca_mastery_rewards_v1') {
        return JSON.stringify({
          schemaVersion: 1,
          grants: { 'banner:banner_cosmic_knight:v1': { grantedAt: '2026-01-01T00:00:00.000Z', itemIds: ['banner:banner_cosmic_knight'] } },
          items: { 'banner:banner_cosmic_knight': { grantId: 'banner:banner_cosmic_knight:v1', grantedAt: '2026-01-01T00:00:00.000Z' } },
        });
      }
      if (key === 'ca_mastery_progress_v1') {
        return JSON.stringify({
          schemaVersion: 1,
          records: {},
          banners: {
            banner_cosmic_knight: {
              fallenEnemies,
              firstAchievedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        });
      }
      return null;
    }
  };
  assert.equal(collection.ownsBanner(mockMemberStorage, 'classic'), true);
  assert.equal(collection.ownsBanner(mockMemberStorage, 'banner_cosmic_knight'), true);
  assert.equal(collection.ownsBanner(mockMemberStorage, 'banner_crimson_sun'), false);

  const progCosmic = collection.getBannerProgress(mockMemberStorage, 'banner_cosmic_knight');
  assert.equal(progCosmic.target, 50);
  assert.equal(progCosmic.earned, true);
  assert.equal(progCosmic.current, 50);

  const progCrimson = collection.getBannerProgress(mockMemberStorage, 'banner_crimson_sun');
  assert.equal(progCrimson.target, 3);
  assert.equal(progCrimson.earned, false);
  assert.equal(progCrimson.current, 0);

  // 5. 9 Languages Localization verification
  for (const { code } of SUPPORTED_LANGUAGES) {
    I18nManager.setLanguage(code);
    for (const name of theme.BANNER_THEMES) {
      const label = theme.bannerThemeLabel(name);
      assert.ok(label, `Missing label for ${name} in ${code}`);
      if (code !== 'ko') {
        assert.ok(!/[가-힣]/.test(label), `Language ${code} label '${label}' should not have Korean`);
      }
    }
    const tabText = theme.bannerSettingsText('tab');
    const hintText = theme.bannerSettingsText('hint');
    assert.ok(tabText, `Missing tab text for ${code}`);
    assert.ok(hintText, `Missing hint text for ${code}`);
    if (code !== 'ko') {
      assert.ok(!/[가-힣]/.test(tabText), `Language ${code} tab '${tabText}' should not have Korean`);
      assert.ok(!/[가-힣]/.test(hintText), `Language ${code} hint '${hintText}' should not have Korean`);
    }

    const dict = bannerCopyModule.bannerCopy(code);
    for (const id of expectedIds) {
      assert.ok(dict.names[id], `Missing dict.names[${id}] for ${code}`);
      assert.ok(dict.descriptions[id], `Missing dict.descriptions[${id}] for ${code}`);
      assert.ok(dict.conditions[id], `Missing dict.conditions[${id}] for ${code}`);
      assert.ok(dict.tips[id], `Missing dict.tips[${id}] for ${code}`);
      assert.ok(dict.modes[id], `Missing dict.modes[${id}] for ${code}`);
    }
    assert.ok(dict.guestNotice, `Missing dict.guestNotice for ${code}`);
    assert.ok(dict.bannerObjectives, `Missing dict.bannerObjectives for ${code}`);
  }

  // 6. Social friend request target safety
  const { SocialService } = await vite.ssrLoadModule('/src/social-service.ts');
  let target = 'other', existing = null;
  const filters = [], writes = [];
  globalThis.__bannerClient = {
    from(table) {
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        ilike() { throw new Error('Banner must target the known user ID, not a nickname pattern'); },
        or() { return query; },
        single: async () => ({ data: { id: target, nickname: 'name_%' } }),
        maybeSingle: async () => ({ data: existing }),
        insert: async (value) => { writes.push(value); return { error: null }; }
      };
      return query;
    }
  };

  assert.equal((await SocialService.sendFriendRequest('me', 'name_%', 'other')).success, true);
  assert.deepEqual(filters, [['id', 'other']]);
  assert.equal(writes[0].addressee_id, 'other');

  existing = { id: 'friendship', status: 'pending' };
  assert.equal((await SocialService.sendFriendRequest('me', 'name_%', 'other')).error, 'request_already_sent');
  assert.equal(writes.length, 1);

  target = 'me';
  assert.equal((await SocialService.sendFriendRequest('me', 'name_%', 'me')).error, 'cannot_add_self');
  assert.equal(writes.length, 1);

  console.log('PASS banner: sides, mode ratings, bot/guest/manual restrictions, 6 banner themes, progress & ownership, 9 languages and exact friend target');
} finally {
  delete globalThis.__bannerClient;
  await vite.close();
}
