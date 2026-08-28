/**
 * Metered TURN/STUN 릴레이 서버 연동 및 동적 크리덴셜 관리 모듈
 * (https://www.metered.ca/ 무료 50GB 플랜 지원)
 */

export interface MeteredCredentialsResponse {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// 기본 고속 STUN 서버 목록 (Google 3중화)
export const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

let cachedIceServers: RTCIceServer[] | null = null;
let cacheExpireTime = 0;

export const DEFAULT_METERED_APP_NAME = "chessalkkagi";
export const DEFAULT_METERED_API_KEY = "ee6b69bf97699b897c7b29bbcdc2620a4c04";

/**
 * Metered 설정값 가져오기 (환경 변수, LocalStorage, 또는 기본 설정)
 */
export function getMeteredConfig(): { appName: string; apiKey: string } {
  const envAppName = (import.meta as any).env?.VITE_METERED_APP_NAME || "";
  const envApiKey = (import.meta as any).env?.VITE_METERED_API_KEY || "";

  const storageAppName = localStorage.getItem("ca_metered_app_name") || "";
  const storageApiKey = localStorage.getItem("ca_metered_api_key") || "";

  return {
    appName: storageAppName || envAppName || DEFAULT_METERED_APP_NAME,
    apiKey: storageApiKey || envApiKey || DEFAULT_METERED_API_KEY,
  };
}

/**
 * Metered REST API를 통해 동적 TURN/STUN ICE 서버 목록을 조회하고 캐싱한다.
 */
export async function getUnifiedIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cachedIceServers && now < cacheExpireTime) {
    return cachedIceServers;
  }

  const { appName, apiKey } = getMeteredConfig();

  if (!appName || !apiKey) {
    // 키가 설정되지 않은 경우 기본 STUN 서버 반환
    return DEFAULT_STUN_SERVERS;
  }

  try {
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Metered API 응답 실패: ${response.status}`);
    }

    const data: MeteredCredentialsResponse[] = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const servers: RTCIceServer[] = [
        ...DEFAULT_STUN_SERVERS,
        ...data.map((item) => ({
          urls: item.urls,
          username: item.username,
          credential: item.credential,
        })),
      ];

      // 30분간 캐싱
      cachedIceServers = servers;
      cacheExpireTime = now + 30 * 60 * 1000;
      console.log(`[Metered TURN] ${servers.length}개의 ICE 서버가 성공적으로 로드되었습니다.`);
      return servers;
    }
  } catch (err) {
    console.warn("[Metered TURN] 크리덴셜 로드 예외 (기본 STUN으로 폴백):", err);
  }

  return DEFAULT_STUN_SERVERS;
}
