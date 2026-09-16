import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTERY_KEYS, mergeMasteryValue, reconcileMasteryValues, validateMasteryValues } from "./mastery.ts";

export const PROGRESS_KEYS = [
  "chessAlkkagi.meta.maxStage", "chessAlkkagi.meta.points", "chessAlkkagi.meta.upgrades",
  "has_completed_tutorial", "has_completed_adv_tutorial",
  "ca_puzzle_cleared_v1", "ca_puzzle_medals_v1", "ca_puzzle_progress_v1",
  ...MASTERY_KEYS,
] as const;
type ProgressData = Record<string, string>;
type LocalStore = Pick<Storage, "getItem" | "setItem">;
type Snapshot = { data: ProgressData; revision: number; dirty: boolean; base?: ProgressData };
const CACHE_PREFIX = "ca_account_progress_v1:";
const MASTERY_CAPABILITY = "mastery-v1";
const CAPABILITY_REPROBE_MS = 5 * 60 * 1000;

function isMasteryKey(key: string): boolean {
  return (MASTERY_KEYS as readonly string[]).includes(key);
}

function legacyData(data: ProgressData): ProgressData {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !isMasteryKey(key)));
}

function masteryData(data: ProgressData): ProgressData {
  return Object.fromEntries(Object.entries(data).filter(([key]) => isMasteryKey(key)));
}

function isUnknownRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  const text = `${value.message ?? ""} ${value.details ?? ""}`.toLowerCase();
  return value.code === "PGRST202" || value.code === "42883" || text.includes("could not find the function") || text.includes("does not exist");
}

function browserStorage(): LocalStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

function readData(value: unknown): ProgressData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("진행도 형식 오류");
  const data: ProgressData = {};
  for (const [key, item] of Object.entries(value)) {
    if (!(PROGRESS_KEYS as readonly string[]).includes(key) || typeof item !== "string") throw new Error("진행도 키 오류");
    data[key] = item;
    if (key.endsWith(".points") || key.endsWith(".maxStage")) {
      const number = Number(item);
      if (!/^\d+$/.test(item) || !Number.isSafeInteger(number) || number < 0 || (key.endsWith(".maxStage") && number > 10)) throw new Error("진행도 숫자 오류");
    } else if (key.startsWith("has_completed_")) {
      if (!["true", "started", "skipped"].includes(item)) throw new Error("튜토리얼 기록 오류");
    } else {
      const parsed = JSON.parse(item);
      if (key === "ca_puzzle_cleared_v1") {
        if (!Array.isArray(parsed) || !parsed.every(id => typeof id === "string")) throw new Error("퍼즐 목록 오류");
      } else if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("진행도 객체 오류");
      const bytes = new TextEncoder().encode(item).length;
      if (key === "ca_mastery_progress_v1" && bytes > 24576) throw new Error("숙련 진행도 용량 초과");
      if (key === "ca_mastery_rewards_v1" && bytes > 8192) throw new Error("숙련 보상 용량 초과");
      if (key === "ca_mastery_preferences_v1" && bytes > 4096) throw new Error("숙련 설정 용량 초과");
    }
  }
  if ((data["chessAlkkagi.meta.points"] === undefined) !== (data["chessAlkkagi.meta.upgrades"] === undefined)) throw new Error("연구 기록 일부 누락");
  if (new TextEncoder().encode(JSON.stringify(data)).length > 262144) throw new Error("진행도 용량 초과");
  validateMasteryValues(data);
  return data;
}

function readSnapshot(value: unknown): Snapshot {
  const snapshot = value as Partial<Snapshot> | null;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || Object.keys(snapshot).some(key => !["data", "revision", "dirty", "base", "capabilities"].includes(key))
    || !Number.isSafeInteger(snapshot.revision) || snapshot.revision! < 0
    || (snapshot.dirty !== undefined && typeof snapshot.dirty !== "boolean")) throw new Error("진행도 버전 오류");
  const data = readData(snapshot.data);
  let base: ProgressData | undefined;
  if (snapshot.base !== undefined) base = readData(snapshot.base);
  if (snapshot.dirty === true && base === undefined) throw new Error("진행도 기준 기록 누락");
  return { data, revision: snapshot.revision!, dirty: snapshot.dirty === true, base: base ?? (snapshot.dirty ? undefined : { ...data }) };
}

function equalData(a: ProgressData, b: ProgressData): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value);
}

function mergeLegacyPerKey(local: ProgressData, base: ProgressData, remote: ProgressData): { data: ProgressData; conflicts: string[] } {
  const data: ProgressData = {};
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(local), ...Object.keys(base), ...Object.keys(remote)].filter(key => !isMasteryKey(key)));
  for (const key of keys) {
    const localChanged = local[key] !== base[key];
    const remoteChanged = remote[key] !== base[key];
    if (localChanged && remoteChanged && local[key] !== remote[key]) { conflicts.push(key); continue; }
    const value = localChanged ? local[key] : remote[key];
    if (value !== undefined) data[key] = value;
  }
  return { data, conflicts };
}

function mergeMasteryDomains(local: ProgressData, remote: ProgressData): ProgressData {
  const merged: ProgressData = {};
  for (const key of MASTERY_KEYS) {
    try {
      const value = mergeMasteryValue(key, local[key], remote[key]);
      if (value !== undefined) merged[key] = value;
    } catch {
      throw new Error(`숙련 기록 ${key} 병합 실패`);
    }
  }
  return reconcileMasteryValues(merged);
}

/** One atomic snapshot keeps research point spending and upgrades together. */
export class AccountProgressStorage {
  owner: string | null = null;
  ready = true;
  status = "게스트 진행도는 이 기기에 저장됩니다.";
  conflict = false;
  saveFailed = false;
  masterySupported: boolean | null = null;
  masteryPending = false;
  unsafeData = false;
  private retryCount = 0;
  private snapshot: Snapshot = { data: {}, revision: 0, dirty: false };
  private client: SupabaseClient | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<boolean> | null = null;
  private unsafeCacheRaw: string | null = null;
  private lastCapabilityProbe = 0;
  private listeners = new Set<(reset: boolean) => void>();

  private local: () => LocalStore | null;
  constructor(local: () => LocalStore | null = browserStorage) {
    this.local = local;
    if (typeof window !== "undefined") window.addEventListener("online", () => {
      if (this.owner && (this.masterySupported !== false || Date.now() - this.lastCapabilityProbe >= CAPABILITY_REPROBE_MS)) void this.retry(true);
    });
  }

  subscribe(listener: (reset: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(reset = false): void { for (const listener of this.listeners) listener(reset); }

  private async request(client: SupabaseClient, name: string, args: Record<string, unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(client.rpc(name, args)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("진행도 요청 시간 초과")), 15000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  private readLocal(key: string): string | null {
    try { return this.local()?.getItem(key) ?? null; } catch { return null; }
  }

  private persist(): void {
    if (!this.owner) return;
    try {
      const local = this.local();
      if (!local) throw new Error("저장소 없음");
      local.setItem(CACHE_PREFIX + this.owner, JSON.stringify(this.snapshot));
    } catch {
      this.status = "기기 임시 저장에 실패했습니다. 서버 저장 완료 전에는 창을 닫지 마세요.";
    }
  }

  getItem(key: string): string | null {
    if (!(PROGRESS_KEYS as readonly string[]).includes(key)) throw new Error("지원하지 않는 진행도 키");
    return this.owner ? this.snapshot.data[key] ?? null : this.readLocal(key);
  }

  setItem(key: string, value: string): void {
    this.setItems({ [key]: value });
  }

  setItems(values: ProgressData): void {
    if (Object.keys(values).some(key => !(PROGRESS_KEYS as readonly string[]).includes(key))) throw new Error("지원하지 않는 진행도 키");
    if (!this.ready) throw new Error("계정 진행도를 먼저 불러와 주세요.");
    if (!this.owner) {
      const candidate = Object.fromEntries(MASTERY_KEYS.map(key => [key, values[key] ?? this.readLocal(key)])
        .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== undefined));
      validateMasteryValues(candidate);
      for (const [key, value] of Object.entries(values)) this.local()?.setItem(key, value);
      return;
    }
    const nextData = { ...this.snapshot.data, ...values };
    validateMasteryValues(masteryData(nextData));
    this.snapshot.data = nextData;
    const includesLegacy = Object.keys(values).some(key => !isMasteryKey(key));
    const includesMastery = Object.keys(values).some(isMasteryKey);
    if (includesLegacy || (includesMastery && this.masterySupported === true)) this.snapshot.dirty = true;
    if (includesMastery && this.masterySupported !== true) this.masteryPending = true;
    this.retryCount = 0;
    this.status = this.masteryPending && !includesLegacy
      ? "새 숙련 기록은 서버 업데이트 전까지 이 계정의 기기 캐시에 보관됩니다."
      : "진행도를 저장하는 중입니다…";
    this.persist();
    clearTimeout(this.timer);
    if (this.snapshot.dirty) this.timer = setTimeout(() => { void this.flush(); }, 200);
    this.notify();
  }

  suspend(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.ready = false;
    this.masterySupported = null;
    this.masteryPending = false;
    this.unsafeData = false;
    this.unsafeCacheRaw = null;
    this.status = "계정이 변경되어 진행도를 다시 불러옵니다…";
    this.notify();
  }

  async activate(client: SupabaseClient | null, owner: string | null): Promise<void> {
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.saving = null;
    this.client = client;
    this.owner = owner;
    this.conflict = false;
    this.saveFailed = false;
    this.masterySupported = null;
    this.masteryPending = false;
    this.unsafeData = false;
    this.unsafeCacheRaw = null;
    this.retryCount = 0;
    this.snapshot = { data: {}, revision: 0, dirty: false };
    this.ready = owner === null;
    this.status = owner ? "계정 진행도를 불러오는 중입니다…" : "게스트 진행도는 이 기기에 저장됩니다.";
    this.notify(true);
    if (!owner) return;
    let cached: Snapshot | null = null;
    const cachedRaw = this.readLocal(CACHE_PREFIX + owner);
    if (cachedRaw) {
      try { cached = readSnapshot(JSON.parse(cachedRaw)); }
      catch {
        this.unsafeCacheRaw = cachedRaw;
        this.unsafeData = true;
        this.conflict = true;
        this.saveFailed = true;
        this.status = "기기 캐시가 손상되어 원본을 보존하고 계정 저장을 멈췄습니다. 복구 후 서버 기록 사용을 선택해 주세요.";
        this.notify(true);
        return;
      }
    }
    try {
      if (!client) throw new Error("서버 설정 없음");
      let response: { data: unknown; error: any } | null = null;
      this.lastCapabilityProbe = Date.now();
      const probe = await this.request(client, "get_account_progress_v2", {
        p_expected_user_id: owner, p_client_capability: MASTERY_CAPABILITY,
      });
      if (!probe.error) {
        response = probe;
        const capabilities = (probe.data as { capabilities?: unknown } | null)?.capabilities;
        this.masterySupported = Array.isArray(capabilities) && capabilities.includes(MASTERY_CAPABILITY);
        if (!this.masterySupported) throw new Error("서버 숙련 기능 응답 오류");
      } else if (isUnknownRpc(probe.error) || probe.error?.code === "40001") {
        // A read-only capability probe cannot legitimately produce our save-CAS code;
        // older verification adapters route unknown RPC names through their save stub.
        this.masterySupported = false;
      }
      else throw probe.error;
      if (!response) {
        const legacy = await this.request(client, "get_account_progress", { p_expected_user_id: owner });
        response = legacy;
      }
      const { data, error } = response;
      if (generation !== this.generation) return;
      if (error) throw error;
      const remote = readSnapshot(data);
      const remoteLegacy = legacyData(remote.data);
      const cachedLegacy = legacyData(cached?.data ?? {});
      const legacyMerge = cached?.dirty
        ? mergeLegacyPerKey(cachedLegacy, legacyData(cached.base ?? {}), remoteLegacy)
        : { data: remoteLegacy, conflicts: [] as string[] };
      let mergedMastery: ProgressData = {};
      if (this.masterySupported) mergedMastery = mergeMasteryDomains(cached?.data ?? {}, remote.data);
      else {
        mergedMastery = masteryData(cached?.data ?? {});
        this.masteryPending = Object.keys(mergedMastery).length > 0;
      }
      if (legacyMerge.conflicts.length) {
        if (!cachedRaw || !this.archive(cachedRaw)) {
          this.conflict = true;
          this.status = "충돌한 기기 기록을 백업하지 못해 서버 기록으로 교체하지 않았습니다.";
          this.notify(true);
          return;
        }
        this.snapshot = {
          data: { ...remoteLegacy, ...mergedMastery },
          revision: remote.revision,
          dirty: this.masterySupported === true && !equalData(mergedMastery, masteryData(remote.data)),
          base: { ...remote.data },
        };
        this.conflict = true;
        this.status = `다른 기기와 충돌한 기록(${legacyMerge.conflicts.join(", ")})을 백업했습니다. 어느 기록을 사용할지 선택해 주세요.`;
        this.persist();
        this.notify(true);
        return;
      }
      const chosenLegacy = legacyMerge.data;
      const legacyDirty = !equalData(chosenLegacy, remoteLegacy);
      this.snapshot = { data: { ...chosenLegacy, ...mergedMastery }, revision: remote.revision, dirty: legacyDirty || (this.masterySupported === true && !equalData(mergedMastery, masteryData(remote.data))), base: { ...remote.data } };
      this.ready = true;
      this.status = this.masteryPending
        ? "계정 진행도를 불러왔습니다. 새 숙련 기록은 서버 업데이트 전까지 이 기기에 보관됩니다."
        : "계정 진행도를 불러왔습니다.";
      this.persist();
      this.notify(true);
      if (this.snapshot.dirty) await this.flush();
    } catch (error) {
      if (generation !== this.generation) return;
      // A failed read must never create a blank replacement on the server.
      this.saveFailed = true;
      const message = error instanceof Error ? error.message : "";
      if (message.includes("mastery-opaque-version-conflict")) {
        this.unsafeCacheRaw = cachedRaw;
        this.unsafeData = true;
        this.conflict = true;
        this.status = "서로 다른 과거 숙련 조건 기록을 자동 병합하지 않고 원본을 보존했습니다. 복구할 기록을 선택해 주세요.";
      } else if (message.includes("mastery") || message.includes("JSON")) {
        this.unsafeData = true;
        this.status = "숙련 기록 형식이 안전하지 않아 원본을 보존하고 계정 저장을 멈췄습니다. 복구 후 다시 시도해 주세요.";
      } else this.status = "계정 진행도를 불러오지 못했습니다. 연결과 서버 설정을 확인한 뒤 다시 시도해 주세요.";
      this.notify();
    }
  }

  flush(): Promise<boolean> {
    if (this.saving) return this.saving;
    if (!this.owner || !this.snapshot.dirty) return Promise.resolve(this.ready);
    if (!this.client || !this.ready || this.conflict) return Promise.resolve(false);
    clearTimeout(this.timer);
    const generation = this.generation;
    const owner = this.owner;
    const client = this.client;
    const save = async (): Promise<boolean> => {
      let casRetries = 0;
      while (this.snapshot.dirty && generation === this.generation) {
        const sentFull = { ...this.snapshot.data };
        const sent = this.masterySupported === true ? sentFull : legacyData(sentFull);
        const sentRevision = this.snapshot.revision;
        try {
          const rpc = this.masterySupported === true ? "save_account_progress_v2" : "save_account_progress";
          const args: Record<string, unknown> = { p_data: sent, p_expected_revision: sentRevision, p_expected_user_id: owner };
          if (this.masterySupported === true) args.p_client_capability = MASTERY_CAPABILITY;
          const { data, error } = await this.request(client, rpc, args);
          if (generation !== this.generation) return false;
          if (error) {
            if (error.code === "40001") {
              if (casRetries++ >= 3) throw new Error("진행도 동시 저장 재시도 한도 초과");
              const getRpc = this.masterySupported === true ? "get_account_progress_v2" : "get_account_progress";
              const getArgs: Record<string, unknown> = { p_expected_user_id: owner };
              if (this.masterySupported === true) getArgs.p_client_capability = MASTERY_CAPABILITY;
              const latestResponse = await this.request(client, getRpc, getArgs);
              if (generation !== this.generation) return false;
              if (latestResponse.error) throw latestResponse.error;
              const latest = readSnapshot(latestResponse.data);
              const current = { ...this.snapshot.data };
              const legacyMerge = mergeLegacyPerKey(legacyData(current), legacyData(this.snapshot.base ?? {}), legacyData(latest.data));
              const mergedMastery = this.masterySupported === true
                ? mergeMasteryDomains(current, latest.data)
                : masteryData(current);
              if (legacyMerge.conflicts.length) {
                if (!this.archive(JSON.stringify(this.snapshot))) {
                  this.conflict = true;
                  this.ready = false;
                  this.status = "충돌한 기기 기록을 백업하지 못해 서버 기록으로 교체하지 않았습니다.";
                  this.notify(true);
                  return false;
                }
                const latestLegacy = legacyData(latest.data);
                this.conflict = true;
                this.ready = false;
                this.snapshot = {
                  data: { ...latestLegacy, ...mergedMastery },
                  revision: latest.revision,
                  dirty: this.masterySupported === true && !equalData(mergedMastery, masteryData(latest.data)),
                  base: { ...latest.data },
                };
                this.status = `다른 기기와 충돌한 기록(${legacyMerge.conflicts.join(", ")})을 백업했습니다. 어느 기록을 사용할지 선택해 주세요.`;
                this.persist();
                this.notify(true);
                if (this.snapshot.dirty) continue;
                return false;
              }
              this.snapshot = {
                data: { ...legacyMerge.data, ...mergedMastery }, revision: latest.revision,
                dirty: !equalData(legacyMerge.data, legacyData(latest.data)) || (this.masterySupported === true && !equalData(mergedMastery, masteryData(latest.data))),
                base: { ...latest.data },
              };
              this.persist();
              this.notify();
              continue;
            }
            throw error;
          }
          const remote = readSnapshot(data);
          const currentAfterSave = { ...this.snapshot.data };
          const pendingMastery = masteryData(currentAfterSave);
          const nextData = this.masterySupported === true ? { ...remote.data } : { ...remote.data, ...pendingMastery };
          for (const [key, value] of Object.entries(currentAfterSave)) if (value !== sentFull[key]) nextData[key] = value;
          readData(nextData);
          this.snapshot.data = nextData;
          this.snapshot.revision = remote.revision;
          this.snapshot.base = { ...remote.data };
          this.snapshot.dirty = this.masterySupported === true
            ? !equalData(remote.data, this.snapshot.data)
            : !equalData(remote.data, legacyData(this.snapshot.data));
          this.saveFailed = false;
          this.retryCount = 0;
          this.masteryPending = this.masterySupported !== true && Object.keys(pendingMastery).length > 0;
          this.status = this.masteryPending
            ? "기존 진행도는 서버에 저장되었습니다. 새 숙련 기록은 서버 업데이트 전까지 이 기기에 보관됩니다."
            : this.conflict
              ? "충돌한 기존 기록은 백업했고 숙련 기록은 서버와 병합했습니다. 서버 기록을 사용해 계속해 주세요."
              : "서버에 저장되었습니다.";
          this.persist();
          this.notify();
        } catch {
          if (generation !== this.generation) return false;
          this.saveFailed = true;
          if (!this.conflict) {
            this.status = "연결 문제로 저장이 지연되고 있습니다. 자동으로 다시 시도합니다.";
            if (this.retryCount++ < 3) {
              this.timer = setTimeout(() => { void this.flush(); }, 10000);
            } else {
              this.status = "서버 저장이 지연되고 있습니다. 연결을 확인한 뒤 다시 시도해 주세요.";
            }
          }
          this.persist();
          this.notify();
          return false;
        }
      }
      return !this.conflict;
    };
    this.saving = save().finally(() => { if (generation === this.generation) this.saving = null; });
    return this.saving;
  }

  async retry(reprobe = true): Promise<void> {
    if (this.conflict) return;
    if (!this.ready || (reprobe && this.owner && this.masterySupported === false)) await this.activate(this.client, this.owner);
    else await this.flush();
  }

  private archive(raw: string): boolean {
    if (!this.owner) return false;
    try {
      const local = this.local();
      if (!local) return false;
      local.setItem(`${CACHE_PREFIX}${this.owner}:backup:${Date.now()}`, raw);
      return true;
    } catch { return false; }
  }

  /** Explicit conflict recovery retains a separate backup before using the server. */
  async useServer(): Promise<void> {
    if (!this.owner) return;
    const owner = this.owner;
    try {
      const recoverable = this.unsafeCacheRaw ?? this.readLocal(CACHE_PREFIX + this.owner) ?? JSON.stringify(this.snapshot);
      if (!this.archive(recoverable)) throw new Error("백업 실패");
    } catch {
      this.status = "기기 기록을 백업하지 못했습니다. 서버 기록으로 교체하지 않았습니다.";
      this.notify();
      return;
    }
    if (this.unsafeData || this.unsafeCacheRaw) {
      try {
        const local = this.local();
        if (!local) throw new Error("저장소 없음");
        local.setItem(CACHE_PREFIX + owner, JSON.stringify({ data: {}, revision: 0, dirty: false, base: {} }));
      } catch {
        this.status = "서버 기록으로 전환할 안전한 기기 캐시를 만들지 못했습니다.";
        this.notify();
        return;
      }
      this.unsafeCacheRaw = null;
      this.unsafeData = false;
      this.conflict = false;
      await this.activate(this.client, owner);
      return;
    }

    const retainedMastery = masteryData(this.snapshot.data);
    const serverBase = { ...(this.snapshot.base ?? {}) };
    this.snapshot = {
      data: { ...legacyData(serverBase), ...retainedMastery },
      revision: this.snapshot.revision,
      dirty: this.masterySupported === true && !equalData(retainedMastery, masteryData(serverBase)),
      base: serverBase,
    };
    this.conflict = false;
    this.ready = true;
    this.saveFailed = false;
    this.masteryPending = this.masterySupported !== true && Object.keys(retainedMastery).length > 0;
    this.status = this.masteryPending
      ? "서버의 기존 진행도를 사용합니다. 숙련 기록은 서버 업데이트 전까지 이 계정의 기기 캐시에 보관됩니다."
      : this.snapshot.dirty ? "서버의 기존 진행도를 사용하고 숙련 기록을 병합하는 중입니다…" : "서버 기록을 사용합니다.";
    this.persist();
    this.notify(true);
    if (this.snapshot.dirty) await this.flush();
  }


}

export const progressStorage = new AccountProgressStorage();
