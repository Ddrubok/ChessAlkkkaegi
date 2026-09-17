import { isValidBannerAppearance, type BannerAppearance } from './banner-theme';
import { getSupabaseClient } from './supabase-client';

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
