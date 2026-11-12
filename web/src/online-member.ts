import type { SupabaseClient } from "@supabase/supabase-js";
import { progressStorage } from "./progress-storage";
import type { UserProfile } from "./supabase-auth";

/** A cached profile alone must never grant access to the ranked queue. */
export async function isCurrentRankedMember(client: SupabaseClient | null, profile: UserProfile | null): Promise<boolean> {
  if (!client || !profile || progressStorage.owner !== profile.id) return false;
  try {
    const { data, error } = await client.auth.getSession();
    if (error || data.session?.user.id !== profile.id || data.session.user.is_anonymous === true) return false;
    const verified = await client.auth.getUser();
    return !verified.error && verified.data.user?.id === profile.id && verified.data.user.is_anonymous !== true;
  } catch {
    return false;
  }
}
