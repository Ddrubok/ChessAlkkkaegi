import { isValidBannerAppearance, type BannerAppearance } from './banner-theme';
import { getSupabaseClient } from './supabase-client';
import { DEFAULT_COSMETICS, GUEST_COSMETICS, normalizePublicCosmetics, type CosmeticLoadout } from './cosmetics';

export async function readOpponentCosmetics(userId: string | undefined, canReadAccount: boolean): Promise<CosmeticLoadout> {
  if (!userId || !canReadAccount) return { ...GUEST_COSMETICS };
  const client = getSupabaseClient();
  if (!client) return { ...DEFAULT_COSMETICS };
  try {
    const { data, error } = await client.rpc('get_player_cosmetics', { p_user_id: userId }).abortSignal(AbortSignal.timeout(4000));
    if (!error) return normalizePublicCosmetics(data) ?? { ...DEFAULT_COSMETICS };
    // Only older servers need the legacy query. A network error must not create repeated requests.
    if (error.code !== 'PGRST202' && error.code !== '42883') return { ...DEFAULT_COSMETICS };
    return { ...DEFAULT_COSMETICS, banner: await readOpponentBanner(userId, canReadAccount) };
  } catch { return { ...DEFAULT_COSMETICS }; }
}

// Only the selected public cosmetic is read, never another player's private progress.
export async function readOpponentBanner(userId: string | undefined, canReadAccount: boolean): Promise<BannerAppearance> {
  if (!userId || !canReadAccount) return 'plain';
  const client = getSupabaseClient();
  if (!client) return 'classic';
  try {
    const { data, error } = await client.rpc('get_player_banner', { p_user_id: userId }).abortSignal(AbortSignal.timeout(4000));
    return !error && isValidBannerAppearance(data) ? data : 'classic';
  } catch { return 'classic'; }
}
