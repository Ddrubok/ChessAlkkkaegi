import type { PieceType } from "./config";
import {
  deriveRewards,
  loadMasterySnapshot,
  saveSnapshot,
  setEquippedMastery,
  type MasteryStorage,
} from "./mastery";

export type BannerId =
  | "classic"
  | "slate"
  | "forest"
  | "banner_cosmic_knight"
  | "banner_crimson_sun"
  | "banner_hidden_myeongnyang";

export const BANNER_IDS = [
  "classic",
  "slate",
  "forest",
  "banner_cosmic_knight",
  "banner_crimson_sun",
  "banner_hidden_myeongnyang",
] as const;

export const BASIC_BANNER_IDS: readonly BannerId[] = [
  "classic",
  "slate",
  "forest",
] as const;

export const ACHIEVEMENT_BANNER_IDS: readonly BannerId[] = [
  "banner_cosmic_knight",
  "banner_crimson_sun",
  "banner_hidden_myeongnyang",
] as const;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ID_RE = /^[\x21-\x7e]{1,96}$/;

function validIso(value: unknown): value is string {
  return typeof value === "string" && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

function nowIso(value?: string): string {
  return validIso(value) ? value : new Date().toISOString();
}

function isBannerId(value: unknown): value is BannerId {
  return typeof value === "string" && (BANNER_IDS as readonly string[]).includes(value);
}

function isStorageSafe(storage: MasteryStorage): boolean {
  if (!storage) return false;
  const owner = (storage as { owner?: string | null }).owner;
  const unsafe = (storage as { unsafeData?: boolean }).unsafeData;
  return owner !== null && owner !== undefined && unsafe !== true
    && (storage as { ready?: boolean }).ready !== false && (storage as { conflict?: boolean }).conflict !== true;
}

export function ownsBanner(storage: MasteryStorage, id: BannerId): boolean {
  if (!isBannerId(id)) return false;
  if (!storage || (storage as { unsafeData?: boolean }).unsafeData === true) return false;
  const owner = (storage as { owner?: string | null }).owner;

  // Guest accounts cannot own or equip any member banners.
  if (owner === null || owner === undefined) return false;

  // Basic banners are implicitly owned by any authenticated member.
  if (BASIC_BANNER_IDS.includes(id)) {
    return owner !== undefined;
  }

  // Achievement banners require grant record in rewards or verified progress.
  const snapshot = loadMasterySnapshot(storage);
  if (snapshot.malformed) return false;

  if (snapshot.rewards.items[`banner:${id}`] || snapshot.rewards.items[id]) return true;

  if (id === "banner_cosmic_knight") {
    const enemies = snapshot.progress.banners?.banner_cosmic_knight?.fallenEnemies;
    return Object.keys(enemies ?? {}).length >= 50;
  }
  if (id === "banner_crimson_sun") {
    const fallCount = snapshot.progress.banners?.banner_crimson_sun?.bestTripleOut?.fallCount ?? 0;
    return fallCount >= 3;
  }
  if (id === "banner_hidden_myeongnyang") {
    const events = snapshot.progress.banners?.banner_hidden_myeongnyang?.eventIds;
    return Object.keys(events ?? {}).length >= 1;
  }
  return false;
}

export function getEquippedBanner(storage: MasteryStorage): BannerId {
  if (!storage || (storage as { owner?: string | null }).owner === null) {
    return "classic";
  }
  const snapshot = loadMasterySnapshot(storage);
  if (snapshot.malformed) return "classic";

  const equippedItem = snapshot.preferences.equipped.banner?.itemId;
  if (!equippedItem) return "classic";

  const bannerId = equippedItem.startsWith("banner:") ? equippedItem.slice(7) : equippedItem;
  if (isBannerId(bannerId) && ownsBanner(storage, bannerId)) {
    return bannerId;
  }
  return "classic";
}

export function equipBanner(storage: MasteryStorage, id: BannerId): boolean {
  if (!isBannerId(id)) return false;
  if (!isStorageSafe(storage)) return false;
  if (!ownsBanner(storage, id)) return false;
  return setEquippedMastery(storage, "banner", `banner:${id}`);
}

export function getBannerProgress(
  storage: MasteryStorage,
  id: BannerId,
): { current: number; target: number; earned: boolean } {
  if (BASIC_BANNER_IDS.includes(id)) {
    const earned = ownsBanner(storage, id);
    return { current: 1, target: 1, earned };
  }
  if (!storage || (storage as { unsafeData?: boolean }).unsafeData === true) {
    return {
      current: 0,
      target: id === "banner_cosmic_knight" ? 50 : id === "banner_crimson_sun" ? 3 : 1,
      earned: false,
    };
  }
  const snapshot = loadMasterySnapshot(storage);
  if (snapshot.malformed) {
    return {
      current: 0,
      target: id === "banner_cosmic_knight" ? 50 : id === "banner_crimson_sun" ? 3 : 1,
      earned: false,
    };
  }

  if (id === "banner_cosmic_knight") {
    const count = Object.keys(snapshot.progress.banners?.banner_cosmic_knight?.fallenEnemies ?? {}).length;
    const earned = count >= 50 || Boolean(snapshot.rewards.items["banner:banner_cosmic_knight"]);
    return { current: Math.min(50, count), target: 50, earned };
  }
  if (id === "banner_crimson_sun") {
    const fallCount = snapshot.progress.banners?.banner_crimson_sun?.bestTripleOut?.fallCount ?? 0;
    const earned = fallCount >= 3 || Boolean(snapshot.rewards.items["banner:banner_crimson_sun"]);
    return { current: Math.min(3, fallCount), target: 3, earned };
  }
  if (id === "banner_hidden_myeongnyang") {
    const count = Object.keys(snapshot.progress.banners?.banner_hidden_myeongnyang?.eventIds ?? {}).length;
    const earned = count >= 1 || Boolean(snapshot.rewards.items["banner:banner_hidden_myeongnyang"]);
    return { current: Math.min(1, count), target: 1, earned };
  }
  return { current: 0, target: 1, earned: false };
}

export function recordBannerShot(
  storage: MasteryStorage,
  input: { eventId: string; pieceType: PieceType; enemyPieceIds: string[]; at?: string },
): void {
  if (!isStorageSafe(storage)) return;
  if (!validId(input.eventId)) return;

  const snapshot = loadMasterySnapshot(storage);
  if (snapshot.malformed) return;

  const validEnemies = [...new Set((input.enemyPieceIds ?? []).filter(validId))].sort();
  const at = nowIso(input.at);
  const before = JSON.stringify(snapshot.progress.banners ?? {});

  snapshot.progress.banners ??= {};

  if (input.pieceType === "Knight" && validEnemies.length > 0) {
    const knight = (snapshot.progress.banners.banner_cosmic_knight ??= {
      fallenEnemies: {},
      firstAchievedAt: null,
    });
    for (const enemyId of validEnemies) {
      if (!knight.fallenEnemies[enemyId] && Object.keys(knight.fallenEnemies).length < 50) {
        knight.fallenEnemies[enemyId] = { eventId: input.eventId, at };
      }
    }
    const totalEnemies = Object.keys(knight.fallenEnemies).length;
    if (totalEnemies >= 50 && !knight.firstAchievedAt) {
      knight.firstAchievedAt = at;
    }
  }

  if (validEnemies.length >= 3) {
    const crimson = (snapshot.progress.banners.banner_crimson_sun ??= {
      bestTripleOut: null,
      firstAchievedAt: null,
    });
    const currentBest = crimson.bestTripleOut?.fallCount ?? 0;
    if (validEnemies.length > currentBest) {
      crimson.bestTripleOut = {
        eventId: input.eventId,
        enemyPieceIds: validEnemies.slice(0, 3) as [string, string, string],
        fallCount: Math.min(128, validEnemies.length),
        at,
      };
      if (!crimson.firstAchievedAt) {
        crimson.firstAchievedAt = at;
      }
    }
  }

  if (JSON.stringify(snapshot.progress.banners ?? {}) === before) return;
  deriveRewards(snapshot, at);
  saveSnapshot(storage, snapshot);
}

export function recordBannerVictory(
  storage: MasteryStorage,
  input: { eventId: string; stage: number; comebackEligible: boolean; at?: string },
): void {
  if (!isStorageSafe(storage)) return;
  if (!validId(input.eventId)) return;
  if (!Number.isInteger(input.stage) || input.stage < 5 || input.comebackEligible !== true) return;

  const snapshot = loadMasterySnapshot(storage);
  if (snapshot.malformed) return;

  const at = nowIso(input.at);
  const before = JSON.stringify(snapshot.progress.banners ?? {});
  snapshot.progress.banners ??= {};

  const comeback = (snapshot.progress.banners.banner_hidden_myeongnyang ??= {
    eventIds: {},
    firstAchievedAt: null,
  });

  if (Object.keys(comeback.eventIds).length === 0) {
    comeback.eventIds[input.eventId] = { at, stage: input.stage };
    if (!comeback.firstAchievedAt) {
      comeback.firstAchievedAt = at;
    }
  }

  if (JSON.stringify(snapshot.progress.banners ?? {}) === before) return;
  deriveRewards(snapshot, at);
  saveSnapshot(storage, snapshot);
}
