import type { SupabaseClient } from "@supabase/supabase-js";

export const PROGRESS_KEYS = [
  "chessAlkkagi.meta.maxStage", "chessAlkkagi.meta.points", "chessAlkkagi.meta.upgrades",
  "has_completed_tutorial", "has_completed_adv_tutorial",
  "ca_puzzle_cleared_v1", "ca_puzzle_medals_v1", "ca_puzzle_progress_v1",
] as const;
type ProgressData = Record<string, string>;
type LocalStore = Pick<Storage, "getItem" | "setItem">;
type Snapshot = { data: ProgressData; revision: number; dirty: boolean };
const CACHE_PREFIX = "ca_account_progress_v1:";

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
    }
  }
  if ((data["chessAlkkagi.meta.points"] === undefined) !== (data["chessAlkkagi.meta.upgrades"] === undefined)) throw new Error("연구 기록 일부 누락");
  if (new TextEncoder().encode(JSON.stringify(data)).length > 262144) throw new Error("진행도 용량 초과");
  return data;
}

function readSnapshot(value: unknown): Snapshot {
  const snapshot = value as Partial<Snapshot> | null;
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision! < 0) throw new Error("진행도 버전 오류");
  return { data: readData(snapshot.data), revision: snapshot.revision!, dirty: snapshot.dirty === true };
}

function equalData(a: ProgressData, b: ProgressData): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value);
}

/** One atomic snapshot keeps research point spending and upgrades together. */
export class AccountProgressStorage {
  owner: string | null = null;
  ready = true;
  status = "게스트 진행도는 이 기기에 저장됩니다.";
  conflict = false;
  saveFailed = false;
  private retryCount = 0;
  private snapshot: Snapshot = { data: {}, revision: 0, dirty: false };
  private client: SupabaseClient | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<boolean> | null = null;
  private listeners = new Set<(reset: boolean) => void>();

  private local: () => LocalStore | null;
  constructor(local: () => LocalStore | null = browserStorage) { this.local = local; }

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
    if (!this.owner) { for (const [key, value] of Object.entries(values)) this.local()?.setItem(key, value); return; }
    this.snapshot.data = { ...this.snapshot.data, ...values };
    this.snapshot.dirty = true;
    this.retryCount = 0;
    this.status = "진행도를 저장하는 중입니다…";
    this.persist();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 200);
    this.notify();
  }

  suspend(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.ready = false;
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
    this.retryCount = 0;
    this.snapshot = { data: {}, revision: 0, dirty: false };
    this.ready = owner === null;
    this.status = owner ? "계정 진행도를 불러오는 중입니다…" : "게스트 진행도는 이 기기에 저장됩니다.";
    this.notify(true);
    if (!owner) return;
    let cached: Snapshot | null = null;
    try { const raw = this.readLocal(CACHE_PREFIX + owner); if (raw) cached = readSnapshot(JSON.parse(raw)); } catch { /* Preserve malformed cache for recovery. */ }
    try {
      if (!client) throw new Error("서버 설정 없음");
      const { data, error } = await this.request(client, "get_account_progress", { p_expected_user_id: owner });
      if (generation !== this.generation) return;
      if (error) throw error;
      const remote = readSnapshot(data);
      if (cached?.dirty && !equalData(cached.data, remote.data)) {
        this.snapshot = cached;
        if (cached.revision !== remote.revision) {
          this.conflict = true;
          this.status = "다른 기기에서 기록이 변경되었습니다. 기기 기록을 백업한 뒤 서버 기록을 불러와 주세요.";
          this.notify(true);
          return;
        }
      } else this.snapshot = remote;
      this.ready = true;
      this.status = "계정 진행도를 불러왔습니다.";
      this.persist();
      this.notify(true);
      if (this.snapshot.dirty) await this.flush();
    } catch {
      if (generation !== this.generation) return;
      // A failed read must never create a blank replacement on the server.
      this.status = "계정 진행도를 불러오지 못했습니다. 연결과 서버 설정을 확인한 뒤 다시 시도해 주세요.";
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
      while (this.snapshot.dirty && generation === this.generation) {
        const sent = { ...this.snapshot.data };
        try {
          const { data, error } = await this.request(client, "save_account_progress", {
            p_data: sent, p_expected_revision: this.snapshot.revision, p_expected_user_id: owner,
          });
          if (generation !== this.generation) return false;
          if (error) {
            if (error.code === "40001") {
              this.conflict = true;
              this.ready = false;
              this.status = "다른 기기에서 기록이 변경되어 저장을 중단했습니다. 서버 기록을 다시 불러와 주세요.";
            }
            throw error;
          }
          const remote = readSnapshot(data);
          this.snapshot.revision = remote.revision;
          this.snapshot.dirty = !equalData(sent, this.snapshot.data);
          this.saveFailed = false;
          this.retryCount = 0;
          this.status = "서버에 저장되었습니다.";
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
      return true;
    };
    this.saving = save().finally(() => { if (generation === this.generation) this.saving = null; });
    return this.saving;
  }

  async retry(): Promise<void> {
    if (this.conflict) return;
    if (!this.ready) await this.activate(this.client, this.owner);
    else await this.flush();
  }

  /** Explicit conflict recovery retains a separate backup before using the server. */
  async useServer(): Promise<void> {
    if (!this.owner) return;
    try {
      const local = this.local();
      if (!local) throw new Error("저장소 없음");
      local.setItem(`${CACHE_PREFIX}${this.owner}:backup:${Date.now()}`, JSON.stringify(this.snapshot));
      local.setItem(CACHE_PREFIX + this.owner, JSON.stringify({ ...this.snapshot, dirty: false }));
    } catch {
      this.status = "기기 기록을 백업하지 못했습니다. 서버 기록으로 교체하지 않았습니다.";
      this.notify();
      return;
    }
    await this.activate(this.client, this.owner);
  }


}

export const progressStorage = new AccountProgressStorage();
