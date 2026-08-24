import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY_URL = "ca_supabase_url";
const STORAGE_KEY_ANON = "ca_supabase_anon_key";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

let supabaseInstance: SupabaseClient | null = null;
let currentConfig: SupabaseConfig | null = null;

/**
 * 환경 변수 또는 LocalStorage에서 Supabase 설정을 읽어온다.
 */
export function getSavedSupabaseConfig(): SupabaseConfig | null {
  const envUrl = typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL
    ? String(import.meta.env.VITE_SUPABASE_URL).trim()
    : "";
  const envKey = typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY
    ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
    : "";

  const storageUrl = (localStorage.getItem(STORAGE_KEY_URL) || "").trim();
  const storageKey = (localStorage.getItem(STORAGE_KEY_ANON) || "").trim();

  const url = storageUrl || envUrl;
  const anonKey = storageKey || envKey;

  if (url && anonKey) {
    return { url, anonKey };
  }
  return null;
}

/**
 * Supabase 설정을 LocalStorage에 저장하고 클라이언트를 재초기화한다.
 */
export function saveSupabaseConfig(config: SupabaseConfig): SupabaseClient {
  localStorage.setItem(STORAGE_KEY_URL, config.url.trim());
  localStorage.setItem(STORAGE_KEY_ANON, config.anonKey.trim());
  currentConfig = { url: config.url.trim(), anonKey: config.anonKey.trim() };
  supabaseInstance = createClient(currentConfig.url, currentConfig.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  });
  return supabaseInstance;
}

/**
 * 저장된 설정을 지우고 클라이언트를 초기화 해제한다.
 */
export function clearSupabaseConfig(): void {
  localStorage.removeItem(STORAGE_KEY_URL);
  localStorage.removeItem(STORAGE_KEY_ANON);
  supabaseInstance = null;
  currentConfig = null;
}

/**
 * Supabase 싱글톤 클라이언트를 가져오거나 새로 초기화한다.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const config = getSavedSupabaseConfig();
  if (config) {
    currentConfig = config;
    supabaseInstance = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 20,
        },
      },
    });
    return supabaseInstance;
  }

  return null;
}
