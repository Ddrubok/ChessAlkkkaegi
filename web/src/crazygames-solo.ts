import type { RunCardState } from "./cards";
import type { StageRunPointState } from "./meta";
import { I18nManager } from "./i18n";
import { reportPortalStorageUnavailable } from "./portal-browser-guards";
import { PLATFORM } from "./platform";

// This browser's stage-boundary checkpoint. Account snapshots and old progress
// keys stay untouched; cards are not advertised as cross-device cloud saves.
export interface SoloCheckpoint {
  stage: number;
  metaPoints: number;
  cards: RunCardState;
  points: StageRunPointState;
}
interface SoloState { intro: "complete" | "skipped" | null; run: SoloCheckpoint | null }
type Store = Pick<Storage, "getItem" | "setItem">;
const key = (owner: string | null) => `${PLATFORM.id === "itch" ? "ca_itch_opening_v2" : "ca_cg_opening_v2"}:${owner ?? "guest"}`;

export function readSoloState(owner: string | null, storage: Store = localStorage): SoloState {
  const empty: SoloState = { intro: null, run: null };
  try {
    const raw = storage.getItem(key(owner));
    if (!raw) return empty;
    const value = JSON.parse(raw);
    if (!value || ![null, "complete", "skipped"].includes(value.intro)) return empty;
    const run = value.run;
    if (run !== null) {
      const c = run?.cards, p = run?.points;
      if (!Number.isInteger(run?.stage) || run.stage < 1 || run.stage > 10 || !Number.isFinite(run.metaPoints) || run.metaPoints < 0 || !c || !p ||
        ![c.sizeGrade, c.weightGrade, c.forceGrade].every(n => Number.isInteger(n) && n >= 0 && n <= 5) ||
        typeof c.giantPawn !== "boolean" || typeof c.proneStart !== "boolean" ||
        !Number.isInteger(c.picksSoFar) || c.picksSoFar < 0 || c.picksSoFar !== run.stage - (p.startedAtStage ?? 1) ||
        c.sizeGrade + c.weightGrade + c.forceGrade + Number(c.giantPawn) + Number(c.proneStart) !== c.picksSoFar ||
        !Number.isInteger(p.lastClearedStage) || p.lastClearedStage !== run.stage - 1 ||
        !Number.isInteger(p.startedAtStage ?? 1) || (p.startedAtStage ?? 1) < 1 || (p.startedAtStage ?? 1) > run.stage) return { intro: value.intro, run: null };
    }
    return { intro: value.intro, run };
  } catch (error) {
    if (!(error instanceof SyntaxError)) reportPortalStorageUnavailable();
    return empty;
  }
}

export function writeSoloIntro(owner: string | null, intro: "complete" | "skipped", storage: Store = localStorage): void {
  try { storage.setItem(key(owner), JSON.stringify({ ...readSoloState(owner, storage), intro })); }
  catch { reportPortalStorageUnavailable(); }
}

export function writeSoloCheckpoint(owner: string | null, run: SoloCheckpoint | null, storage: Store = localStorage): void {
  try { storage.setItem(key(owner), JSON.stringify({ ...readSoloState(owner, storage), run })); }
  catch { reportPortalStorageUnavailable(); }
}

export const soloCopy = () => I18nManager.getLanguage() === "ko" ? {
  quick: "첫 샷 연습", goal: "상대 말을 모두 판 밖으로 밀어내세요.",
  remaining: "남은 상대", stage: "단계", skip: "바로 경기 시작", pull: "뒤로 당기고, 놓아서 발사하세요.",
  saved: "단계 시작과 선택한 강화는 이 브라우저에서 이어집니다.",
  noSave: "브라우저 저장소를 사용할 수 없습니다. 창을 닫으면 이번 진행이 사라집니다.",
  revision: "입문 경기 개편 · 1~3단계의 배치가 바뀌었습니다. 기존 연구와 해금은 유지됩니다.",
  privacy: PLATFORM.id === "itch" ? "진행과 강화는 이 브라우저에 저장됩니다." : "계정 진행은 CrazyGames ID에 연결됩니다. 경기 중 강화는 이 브라우저에 저장됩니다.",
  accountUnavailable: "계정 연결에 실패해 별도의 게스트 진행으로 시작합니다. 기존 계정 기록은 보존됩니다. 연결 후 새로고침하세요.",
} : {
  quick: "First flick", goal: "Knock all rival pieces off the board.",
  remaining: "Rivals left", stage: "Stage", skip: "Start the match", pull: "Pull back. Release to flick.",
  saved: "Resume from the start of this stage with your upgrades in this browser.",
  noSave: "Browser storage is unavailable. This session's progress will be lost when you close it.",
  revision: "New opening layouts for stages 1–3. Your research and unlocked stages are preserved.",
  privacy: PLATFORM.id === "itch" ? "Progress and stage upgrades are saved in this browser." : "Account progress uses your CrazyGames ID. Run upgrades are saved in this browser.",
  accountUnavailable: "Account connection failed. You are playing a separate guest save; account progress is preserved. Refresh after reconnecting.",
};
