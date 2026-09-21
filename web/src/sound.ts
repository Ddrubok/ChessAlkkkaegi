import {
  SOUND_BGM_VOLUME,
  SOUND_HIT_GLOBAL_COOLDOWN_MS,
  SOUND_HIT_MIN_RELATIVE_SPEED,
  SOUND_HIT_PAIR_COOLDOWN_MS,
  SOUND_SFX_VOLUME,
} from "./config";
import type { PhysicsRuntime } from "./physics";
import { resolveRuntimeAssetUrl } from "./portable-assets";

type SoundEffectId =
  | "button"
  | "hit"
  | "wood"
  | "rock"
  | "iron"
  | "power10"
  | "power50"
  | "power90";

type CollisionSoundEffectId =
  | "hit"
  | "wood"
  | "rock"
  | "iron";

interface PowerThresholdState {
  // 10%를 아래에서 위로 지날 때 다시 한 번 재생할 수 있는지 나타낸다.
  power10Armed: boolean;
  // 50%를 아래에서 위로 지날 때 다시 한 번 재생할 수 있는지 나타낸다.
  power50Armed: boolean;
  // 90%를 아래에서 위로 지날 때 다시 한 번 재생할 수 있는지 나타낸다.
  power90Armed: boolean;
}

interface PieceHitSoundState {
  // 직전 fixed step에서 실제 solver contact 중이던 말·표면 쌍 키다.
  touchingPairs: Set<string>;
  // 같은 쌍의 빠른 재접촉음을 제한하는 마지막 재생 실제 시각이다.
  lastPlayedAtByPair: Map<string, number>;
  // 여러 쌍의 동시 충돌음을 하나로 제한하는 마지막 전체 재생 실제 시각이다.
  lastGlobalPlayAt: number;
}

interface SoundRuntime {
  // 저지연 효과음을 디코딩하고 재생하는 브라우저 오디오 컨텍스트다.
  context: AudioContext;
  // 화면 전환과 무관하게 하나만 유지하는 반복 배경음 요소다.
  bgm: HTMLAudioElement;
  // 파일별 디코딩이 끝난 효과음 버퍼다.
  buffers: Map<SoundEffectId, AudioBuffer>;
  // 최초 사용자 입력 이후에만 재생과 복귀 재시도를 허용한다.
  unlocked: boolean;
  // 중단된 효과음은 복귀 시 뒤늦게 재생하지 않는다. 볼륨은 공통 gain에서 제어한다.
  sources: Set<AudioBufferSourceNode>;
  sfxGain: GainNode;
  // 개별 파일 로딩 실패를 한 번만 알리기 위한 경고 키 집합이다.
  warningKeys: Set<string>;
  // 한 드래그 안에서 위쪽 임계 통과만 재생하는 세기 상태다.
  powerThresholds: PowerThresholdState;
  // live fixed step에서만 갱신하는 말·말과 말·맵 충돌음 접촉·제한 상태다.
  pieceHits: PieceHitSoundState;
}

// GitHub Pages 하위 경로 배포에서도 깨지지 않도록 에셋 로더와 같은 BASE_URL 기준으로 주소를 만든다.
const SOUND_EFFECT_URLS: Readonly<
  Record<SoundEffectId, string>
> = {
  button: resolveRuntimeAssetUrl("button"),
  hit: resolveRuntimeAssetUrl("hit"),
  wood: resolveRuntimeAssetUrl("wood"),
  rock: resolveRuntimeAssetUrl("rock"),
  iron: resolveRuntimeAssetUrl("iron"),
  power10: resolveRuntimeAssetUrl("power10"),
  power50: resolveRuntimeAssetUrl("power50"),
  power90: resolveRuntimeAssetUrl("power90"),
};

// BGM도 효과음과 같은 빌드별 주소 해석을 거쳐 화면 전환 동안 하나의 요소로 유지한다.
const BGM_URL = resolveRuntimeAssetUrl("bgm");

// 모듈 하나가 메뉴와 대국 전체에서 같은 BGM·버퍼·제한 상태를 공유한다.
let soundRuntime: SoundRuntime | null = null;
let adSoundMuted = false;
let pageInactive = false;

/** Mute advertising breaks without changing saved player preferences. */
export function setAdSoundMuted(muted: boolean): void {
  adSoundMuted = muted;
  applySoundSettings();
}

/**
 * 효과음이나 자동재생 실패가 게임 진행을 막지 않도록 같은 경고는 한 번만 남긴다.
 */
function warnSoundOnce(
  runtime: SoundRuntime,
  key: string,
  message: string,
  error: unknown,
): void {
  if (runtime.warningKeys.has(key)) {
    return;
  }
  runtime.warningKeys.add(key);
  console.warn(
    `[사운드] ${message}`,
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * 한 MP3를 가져와 현재 컨텍스트의 저지연 재생 버퍼로 디코딩한다.
 */
async function preloadSoundEffect(
  runtime: SoundRuntime,
  id: SoundEffectId,
  url: string,
): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const encoded = await response.arrayBuffer();
    const decoded = await runtime.context.decodeAudioData(encoded);
    runtime.buffers.set(id, decoded);
  } catch (error: unknown) {
    warnSoundOnce(
      runtime,
      `preload:${id}`,
      `${id} 효과음을 불러오지 못했습니다.`,
      error,
    );
  }
}

export interface SoundSettings {
  masterVolume: number; // 0.0 ~ 1.0
  bgmVolume: number;    // 0.0 ~ 1.0
  sfxVolume: number;    // 0.0 ~ 1.0
  muted: boolean;
}

const SOUND_SETTINGS_STORAGE_KEY = "chessAlkkagi.soundSettings";

let currentSoundSettings: SoundSettings = loadSoundSettings();

function loadSoundSettings(): SoundSettings {
  const defaults: SoundSettings = {
    masterVolume: 1.0,
    bgmVolume: 0.6,
    sfxVolume: 0.8,
    muted: false,
  };
  if (typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(SOUND_SETTINGS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      masterVolume: typeof parsed.masterVolume === "number" ? Math.max(0, Math.min(1, parsed.masterVolume)) : 1.0,
      bgmVolume: typeof parsed.bgmVolume === "number" ? Math.max(0, Math.min(1, parsed.bgmVolume)) : 0.6,
      sfxVolume: typeof parsed.sfxVolume === "number" ? Math.max(0, Math.min(1, parsed.sfxVolume)) : 0.8,
      muted: Boolean(parsed.muted),
    };
  } catch {
    return defaults;
  }
}

export function getSoundSettings(): SoundSettings {
  return { ...currentSoundSettings };
}

export function updateSoundSettings(patch: Partial<SoundSettings>): SoundSettings {
  currentSoundSettings = {
    ...currentSoundSettings,
    ...patch,
  };
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(SOUND_SETTINGS_STORAGE_KEY, JSON.stringify(currentSoundSettings));
    } catch {}
  }
  applySoundSettings();
  return { ...currentSoundSettings };
}

function canPlaySound(): boolean {
  return !currentSoundSettings.muted && !adSoundMuted && !pageInactive && !document.hidden;
}

async function syncSoundPlayback(runtime: SoundRuntime): Promise<void> {
  if (runtime.context.state === "closed") return;
  if (!runtime.unlocked || !canPlaySound()) {
    runtime.bgm.pause();
    for (const source of runtime.sources) source.stop();
    runtime.sources.clear();
    if (runtime.context.state === "running") await runtime.context.suspend().catch(() => {});
    return;
  }
  try {
    if (runtime.context.state !== "running") await runtime.context.resume();
    // A mute/background transition can happen while resume is pending.
    if (!canPlaySound()) return;
    if (runtime.bgm.volume > 0 && runtime.bgm.paused) {
      void runtime.bgm.play().catch(error => warnSoundOnce(runtime, "bgm", "BGM playback failed.", error));
    } else if (runtime.bgm.volume === 0) runtime.bgm.pause();
  } catch (error) {
    warnSoundOnce(runtime, "unlock", "Audio resume failed.", error);
  }
}

export function applySoundSettings(): void {
  const runtime = soundRuntime;
  if (runtime === null) return;
  const master = canPlaySound() ? currentSoundSettings.masterVolume : 0;
  runtime.bgm.volume = Math.max(0, Math.min(1, SOUND_BGM_VOLUME * master * currentSoundSettings.bgmVolume));
  runtime.sfxGain.gain.value = Math.max(0, Math.min(1, SOUND_SFX_VOLUME * master * currentSoundSettings.sfxVolume));
  void syncSoundPlayback(runtime);
}

/**
 * 준비된 효과음 버퍼를 독립 소스로 재생해 겹치는 UI 반응도 서로 끊지 않게 한다.
 */
export function playSoundEffect(id: SoundEffectId): void {
  const runtime = soundRuntime;
  if (
    runtime === null ||
    !runtime.unlocked ||
    !canPlaySound() || runtime.sfxGain.gain.value === 0 ||
    runtime.context.state !== "running"
  ) {
    return;
  }
  const buffer = runtime.buffers.get(id);
  if (buffer === undefined) {
    return;
  }
  try {
    const source = runtime.context.createBufferSource();
    source.buffer = buffer;
    source.connect(runtime.sfxGain);
    runtime.sources.add(source);
    source.onended = () => { runtime.sources.delete(source); source.disconnect(); };
    source.start();
  } catch (error: unknown) {
    warnSoundOnce(
      runtime,
      `play:${id}`,
      `${id} 효과음을 재생하지 못했습니다.`,
      error,
    );
  }
}

/**
 * 최초 포인터·키 입력에서 Web Audio와 지속 BGM을 함께 시작한다.
 */
function unlockSound(runtime: SoundRuntime): Promise<void> {
  runtime.unlocked = true;
  return syncSoundPlayback(runtime);
}

/**
 * 브라우저에서만 지속 BGM과 효과음 디코딩·버튼 위임을 한 번 초기화한다.
 */
export function initializeSound(): void {
  if (
    soundRuntime !== null ||
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof window.AudioContext === "undefined"
  ) {
    return;
  }
  const context = new window.AudioContext();
  const sfxGain = context.createGain();
  sfxGain.connect(context.destination);
  const bgm = new Audio(BGM_URL);
  bgm.loop = true;
  bgm.preload = "auto";
  bgm.volume = SOUND_BGM_VOLUME;
  const runtime: SoundRuntime = {
    context,
    bgm,
    buffers: new Map(),
    unlocked: false,
    sources: new Set(),
    sfxGain,
    warningKeys: new Set(),
    powerThresholds: {
      power10Armed: true,
      power50Armed: true,
      power90Armed: true,
    },
    pieceHits: {
      touchingPairs: new Set(),
      lastPlayedAtByPair: new Map(),
      lastGlobalPlayAt: Number.NEGATIVE_INFINITY,
    },
  };
  soundRuntime = runtime;
  // Reconcile late suspend/resume completions against the latest mute/visibility state.
  context.addEventListener("statechange", applySoundSettings);
  applySoundSettings();
  for (const [id, url] of Object.entries(
    SOUND_EFFECT_URLS,
  ) as Array<[SoundEffectId, string]>) {
    void preloadSoundEffect(runtime, id, url);
  }

  // Keep gesture retries available after browser/OS interruptions.
  const unlockOnGesture = (): void => { void unlockSound(runtime); };
  document.addEventListener("pointerdown", unlockOnGesture, true);
  document.addEventListener("keydown", unlockOnGesture, true);
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button") !== null
    ) {
      void unlockSound(runtime).then(() => {
        playSoundEffect("button");
      });
    }
  });

  document.addEventListener("visibilitychange", applySoundSettings);
  window.addEventListener("pagehide", () => { pageInactive = true; applySoundSettings(); });
  window.addEventListener("pageshow", () => { pageInactive = false; applySoundSettings(); });
}

/**
 * 캔버스에서 유효한 말을 눌렀을 때 버튼과 같은 클릭 반응음을 한 번 재생한다.
 */
export function playPieceClickSound(): void {
  playSoundEffect("button");
}

/**
 * 새 로컬 드래그가 시작되거나 끝날 때 세 임계값을 모두 다시 무장한다.
 */
export function resetAimPowerSounds(): void {
  const thresholds = soundRuntime?.powerThresholds;
  if (thresholds === undefined) {
    return;
  }
  thresholds.power10Armed = true;
  thresholds.power50Armed = true;
  thresholds.power90Armed = true;
}

/**
 * 한 갱신에서는 가장 높은 단계음만 재생하고 3% 아래로 내려간 뒤 재무장한다.
 */
export function updateAimPowerSounds(normalizedPower: number): void {
  const thresholds = soundRuntime?.powerThresholds;
  if (
    thresholds === undefined ||
    !Number.isFinite(normalizedPower)
  ) {
    return;
  }
  const clampedPower = Math.min(Math.max(normalizedPower, 0), 1);
  const definitions = [
    ["power10Armed", 0.1, "power10"],
    ["power50Armed", 0.5, "power50"],
    ["power90Armed", 0.9, "power90"],
  ] as const;
  let cue: SoundEffectId | undefined;
  for (const [armedKey, threshold, soundId] of definitions) {
    if (clampedPower < threshold - 0.03) {
      thresholds[armedKey] = true;
    } else if (clampedPower >= threshold && thresholds[armedKey]) {
      thresholds[armedKey] = false;
      cue = soundId;
    }
  }
  if (cue) playSoundEffect(cue);
}

/**
 * 새 보드의 사전 정착 접촉이 live 충돌로 이어지지 않도록 접촉 이력만 초기화한다.
 */
export function resetPieceHitSoundTracking(): void {
  const hitState = soundRuntime?.pieceHits;
  if (hitState === undefined) {
    return;
  }
  hitState.touchingPairs.clear();
  hitState.lastPlayedAtByPair.clear();
  hitState.lastGlobalPlayAt = Number.NEGATIVE_INFINITY;
}

/**
 * 두 콜라이더 사이에 실제 solver contact가 하나라도 있는지 상태를 바꾸지 않고 조회한다.
 */
function hasSolverContact(
  physicsRuntime: PhysicsRuntime,
  leftCollider: PhysicsRuntime["boardCollider"],
  rightCollider: PhysicsRuntime["boardCollider"],
): boolean {
  let touching = false;
  physicsRuntime.world.contactPair(
    leftCollider,
    rightCollider,
    (manifold) => {
      if (manifold.numSolverContacts() > 0) {
        touching = true;
      }
    },
  );
  return touching;
}

/**
 * live fixed step 직후 말·말과 말·맵 접촉을 읽기만 해 표면에 맞는 가장 강한 새 충돌음을 재생한다.
 */
export function scanLivePieceHitSounds(
  physicsRuntime: PhysicsRuntime,
  now: number,
): void {
  const runtime = soundRuntime;
  if (runtime === null || !Number.isFinite(now)) {
    return;
  }
  const pieces = [...physicsRuntime.pieces.values()].sort(
    (left, right) =>
      left.instance.id < right.instance.id
        ? -1
        : left.instance.id > right.instance.id
          ? 1
          : 0,
  );
  const currentTouchingPairs = new Set<string>();
  const candidateState: {
    // 중첩 접촉 등록 함수가 갱신해도 마지막 선택부에서 타입을 정확히 좁히는 공유 상자다.
    strongest:
      | {
        // 충돌 제한과 추적에 쓰는 결정적 말·표면 쌍 키다.
        pairKey: string;
        // 같은 step의 여러 접촉 중 실제로 재생할 가장 큰 상대 선속도다.
        relativeSpeed: number;
        // 말·말, 목재 벽, 석재 벽, 철제 장애물을 구분하는 효과음이다.
        soundId: CollisionSoundEffectId;
      }
      | null;
  } = { strongest: null };
  const considerContact = (
    pairKey: string,
    relativeSpeed: number,
    soundId: CollisionSoundEffectId,
  ): void => {
    currentTouchingPairs.add(pairKey);
    if (runtime.pieceHits.touchingPairs.has(pairKey)) {
      return;
    }
    const lastPairPlay =
      runtime.pieceHits.lastPlayedAtByPair.get(pairKey) ??
      Number.NEGATIVE_INFINITY;
    if (
      relativeSpeed < SOUND_HIT_MIN_RELATIVE_SPEED ||
      now - lastPairPlay < SOUND_HIT_PAIR_COOLDOWN_MS
    ) {
      return;
    }
    if (
      candidateState.strongest === null ||
      relativeSpeed > candidateState.strongest.relativeSpeed
    ) {
      candidateState.strongest = {
        pairKey,
        relativeSpeed,
        soundId,
      };
    }
  };

  for (let leftIndex = 0; leftIndex < pieces.length; leftIndex += 1) {
    const left = pieces[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < pieces.length;
      rightIndex += 1
    ) {
      const right = pieces[rightIndex];
      if (
        !hasSolverContact(
          physicsRuntime,
          left.collider,
          right.collider,
        )
      ) {
        continue;
      }
      const leftVelocity = left.body.linvel();
      const rightVelocity = right.body.linvel();
      const isDefendedKing =
        (left.instance.type === "King" && left.body.isFixed()) ||
        (right.instance.type === "King" && right.body.isFixed());
      considerContact(
        `piece:${left.instance.id}|piece:${right.instance.id}`,
        Math.hypot(
          leftVelocity.x - rightVelocity.x,
          leftVelocity.y - rightVelocity.y,
          leftVelocity.z - rightVelocity.z,
        ),
        isDefendedKing ? "rock" : "hit",
      );
    }
  }

  const walls = [...physicsRuntime.breakableWalls.values()].sort(
    (left, right) =>
      left.definition.id < right.definition.id
        ? -1
        : left.definition.id > right.definition.id
          ? 1
          : 0,
  );
  for (const piece of pieces) {
    const velocity = piece.body.linvel();
    const speed = Math.hypot(
      velocity.x,
      velocity.y,
      velocity.z,
    );
    for (const wall of walls) {
      if (
        !hasSolverContact(
          physicsRuntime,
          piece.collider,
          wall.collider,
        )
      ) {
        continue;
      }
      considerContact(
        `piece:${piece.instance.id}|wall:${wall.definition.id}`,
        speed,
        wall.definition.variant === "breakable"
          ? "wood"
          : "rock",
      );
    }
  }

  const obstacles = [
    ...physicsRuntime.pinballObstacles.values(),
  ].sort((left, right) =>
    left.definition.id < right.definition.id
      ? -1
      : left.definition.id > right.definition.id
        ? 1
        : 0,
  );
  for (const piece of pieces) {
    const velocity = piece.body.linvel();
    const speed = Math.hypot(
      velocity.x,
      velocity.y,
      velocity.z,
    );
    for (const obstacle of obstacles) {
      if (
        !hasSolverContact(
          physicsRuntime,
          piece.collider,
          obstacle.collider,
        )
      ) {
        continue;
      }
      considerContact(
        `piece:${piece.instance.id}|obstacle:${obstacle.definition.id}`,
        speed,
        "iron",
      );
    }
  }

  runtime.pieceHits.touchingPairs = currentTouchingPairs;
  const strongestCandidate = candidateState.strongest;
  if (
    strongestCandidate === null ||
    now - runtime.pieceHits.lastGlobalPlayAt <
      SOUND_HIT_GLOBAL_COOLDOWN_MS
  ) {
    return;
  }
  runtime.pieceHits.lastGlobalPlayAt = now;
  runtime.pieceHits.lastPlayedAtByPair.set(
    strongestCandidate.pairKey,
    now,
  );
  playSoundEffect(strongestCandidate.soundId);
}

/**
 * 소리 볼륨 조절 및 음소거 설정 팝업 모달을 띄운다.
 */
export function openSoundSettingsModal(parentContainer?: HTMLElement): void {
  const container = parentContainer ?? document.body;
  const existing = document.querySelector(".sound-settings-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "sound-settings-modal";
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.95);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  const settings = getSoundSettings();

  const card = document.createElement("div");
  card.style.cssText = `
    width: 100%;
    max-width: 380px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    color: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 18px;
  `;

  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:12px;">
      <h3 style="margin:0; font-size:17px; font-weight:700; color:#f8fafc;">사운드 설정</h3>
      <button id="sound-modal-close" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer; padding:4px 8px;">✕</button>
    </div>

    <!-- 전체 음소거 토글 -->
    <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:12px 14px; border-radius:10px; border:1px solid #334155;">
      <div>
        <div style="font-size:14px; font-weight:700; color:#f8fafc;">전체 음소거</div>
        <div style="font-size:12px; color:#94a3b8;">모든 BGM과 효과음을 끕니다</div>
      </div>
      <input type="checkbox" id="sound-mute-toggle" ${settings.muted ? "checked" : ""} style="width:20px; height:20px; cursor:pointer; accent-color:#3b82f6;" />
    </div>

    <!-- 마스터 볼륨 -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
        <span>마스터 볼륨</span>
        <span id="master-val" style="color:#38bdf8;">${Math.round(settings.masterVolume * 100)}%</span>
      </div>
      <input type="range" id="sound-master-slider" min="0" max="100" value="${Math.round(settings.masterVolume * 100)}" style="width:100%; accent-color:#3b82f6; cursor:pointer;" />
    </div>

    <!-- BGM 볼륨 -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
        <span>배경음악 (BGM)</span>
        <span id="bgm-val" style="color:#38bdf8;">${Math.round(settings.bgmVolume * 100)}%</span>
      </div>
      <input type="range" id="sound-bgm-slider" min="0" max="100" value="${Math.round(settings.bgmVolume * 100)}" style="width:100%; accent-color:#3b82f6; cursor:pointer;" />
    </div>

    <!-- SFX 볼륨 -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
        <span>효과음 (SFX)</span>
        <span id="sfx-val" style="color:#38bdf8;">${Math.round(settings.sfxVolume * 100)}%</span>
      </div>
      <input type="range" id="sound-sfx-slider" min="0" max="100" value="${Math.round(settings.sfxVolume * 100)}" style="width:100%; accent-color:#3b82f6; cursor:pointer;" />
    </div>

    <button id="sound-modal-confirm" style="background:#2563eb; color:white; border:none; border-radius:8px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; margin-top:4px;">
      설정 완료
    </button>
  `;

  modal.appendChild(card);
  container.appendChild(modal);

  const muteToggle = card.querySelector("#sound-mute-toggle") as HTMLInputElement;
  const masterSlider = card.querySelector("#sound-master-slider") as HTMLInputElement;
  const bgmSlider = card.querySelector("#sound-bgm-slider") as HTMLInputElement;
  const sfxSlider = card.querySelector("#sound-sfx-slider") as HTMLInputElement;

  const masterVal = card.querySelector("#master-val") as HTMLElement;
  const bgmVal = card.querySelector("#bgm-val") as HTMLElement;
  const sfxVal = card.querySelector("#sfx-val") as HTMLElement;

  muteToggle.addEventListener("change", () => {
    updateSoundSettings({ muted: muteToggle.checked });
  });

  masterSlider.addEventListener("input", () => {
    const val = Number(masterSlider.value) / 100;
    masterVal.textContent = `${masterSlider.value}%`;
    updateSoundSettings({ masterVolume: val });
  });

  bgmSlider.addEventListener("input", () => {
    const val = Number(bgmSlider.value) / 100;
    bgmVal.textContent = `${bgmSlider.value}%`;
    updateSoundSettings({ bgmVolume: val });
  });

  sfxSlider.addEventListener("input", () => {
    const val = Number(sfxSlider.value) / 100;
    sfxVal.textContent = `${sfxSlider.value}%`;
    updateSoundSettings({ sfxVolume: val });
  });

  const closeModal = () => modal.remove();
  card.querySelector("#sound-modal-close")?.addEventListener("click", closeModal);
  card.querySelector("#sound-modal-confirm")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
}
