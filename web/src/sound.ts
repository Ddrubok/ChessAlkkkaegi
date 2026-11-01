import {
  SOUND_BGM_VOLUME,
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
  limit: number;
  overdriveArmed: boolean;
  maxArmed: boolean;
  lastPower: number;
  tension?: { oscillator: OscillatorNode; gain: GainNode; timer: ReturnType<typeof setTimeout> | null };
}

interface PieceHitSoundState {
  touchingPairs: Set<string>;
  lastPlayedAtByPair: Map<string, number>;
  preStep: Map<number, BodyMotion>;
  candidates: ImpactCandidate[];
  primed: boolean;
}

type Vec3 = { x: number; y: number; z: number };
type BodyMotion = { position: Vec3; linear: Vec3; angular: Vec3 };
export type ImpactFeedbackEvent = { pairKey: string; point: Vec3; direction: Vec3; strength: number };
type ImpactCandidate = { event: ImpactFeedbackEvent; soundId: CollisionSoundEffectId; score: number; now: number; order: number };

const hitState: PieceHitSoundState = {
  touchingPairs: new Set(), lastPlayedAtByPair: new Map(), preStep: new Map(), candidates: [], primed: false,
};

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
  duckUntil: number;
  ringOutVoices: number;
  synthSources: Set<OscillatorNode>;
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
    for (const source of runtime.synthSources) source.stop();
    runtime.synthSources.clear();
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
  if (!canPlaySound() || currentSoundSettings.sfxVolume === 0 || currentSoundSettings.masterVolume === 0) {
    resetAimPowerSounds();
    runtime.duckUntil = 0;
  }
  const master = canPlaySound() ? currentSoundSettings.masterVolume : 0;
  runtime.bgm.volume = Math.max(0, Math.min(1, SOUND_BGM_VOLUME * master * currentSoundSettings.bgmVolume * (performance.now() < runtime.duckUntil ? 0.708 : 1)));
  runtime.sfxGain.gain.value = Math.max(0, Math.min(1, SOUND_SFX_VOLUME * master * currentSoundSettings.sfxVolume));
  void syncSoundPlayback(runtime);
}

/**
 * 준비된 효과음 버퍼를 독립 소스로 재생해 겹치는 UI 반응도 서로 끊지 않게 한다.
 */
export function playSoundEffect(id: SoundEffectId, volume = 1, pitch = 1): void {
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
    const gain = runtime.context.createGain();
    gain.gain.value = Math.min(1, Math.max(0, volume));
    source.playbackRate.value = pitch;
    source.connect(gain);
    gain.connect(runtime.sfxGain);
    runtime.sources.add(source);
    source.onended = () => { runtime.sources.delete(source); source.disconnect(); gain.disconnect(); };
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
    powerThresholds: { limit: 1, overdriveArmed: true, maxArmed: true, lastPower: 0 },
    pieceHits: hitState,
    duckUntil: 0,
    ringOutVoices: 0,
    synthSources: new Set(),
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

/** A new gesture, cap change, or cancellation clears the live tension voice. */
export function resetAimPowerSounds(): void {
  const state = soundRuntime?.powerThresholds;
  if (!state) return;
  if (state.tension) {
    clearTimeout(state.tension.timer ?? undefined);
    state.tension.gain.gain.setTargetAtTime(0, soundRuntime!.context.currentTime, 0.015);
    state.tension.oscillator.stop(soundRuntime!.context.currentTime + 0.08);
    state.tension = undefined;
  }
  state.overdriveArmed = state.maxArmed = true;
  state.lastPower = 0;
}

/** Absolute 0..1.5 power, with the actual local cap supplied by the caller. */
export function updateAimPowerSounds(normalizedPower: number, maxPower = 1): void {
  const runtime = soundRuntime;
  const state = runtime?.powerThresholds;
  if (!runtime || !state || !Number.isFinite(normalizedPower) || !Number.isFinite(maxPower)) return;
  const limit = Math.min(1.5, Math.max(0, maxPower));
  if (limit !== state.limit) { resetAimPowerSounds(); state.limit = limit; }
  const power = Math.min(limit, Math.max(0, normalizedPower));
  const changed = Math.abs(power - state.lastPower) > 0.002;
  state.lastPower = power;
  if (!canPlaySound() || !runtime.unlocked || runtime.context.state !== "running" || runtime.sfxGain.gain.value === 0) {
    resetAimPowerSounds();
    return;
  }
  if (changed && power > 0.01 && runtime.context.createOscillator) {
    if (!state.tension && runtime.synthSources.size < 4) {
      const oscillator = runtime.context.createOscillator();
      const gain = runtime.context.createGain();
      oscillator.type = "triangle";
      runtime.synthSources.add(oscillator);
      oscillator.onended = () => { runtime.synthSources.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(runtime.sfxGain);
      oscillator.start();
      state.tension = { oscillator, gain, timer: null };
    }
    const voice = state.tension;
    if (voice) {
      if (voice.timer) clearTimeout(voice.timer);
      const time = runtime.context.currentTime;
      voice.oscillator.frequency.setTargetAtTime(135 + 115 * power / 1.5, time, 0.015);
      voice.gain.gain.setTargetAtTime(0.035, time, 0.012);
      voice.timer = setTimeout(() => {
        voice.gain.gain.setTargetAtTime(0, runtime.context.currentTime, 0.03);
        voice.oscillator.stop(runtime.context.currentTime + 0.12);
        if (state.tension === voice) state.tension = undefined;
        voice.timer = null;
      }, 75);
    }
  }
  if (power < 1 - 0.03) state.overdriveArmed = true;
  if (power < limit - 0.03) state.maxArmed = true;
  let cue: SoundEffectId | undefined;
  if (limit > 1 && power > 1 && state.overdriveArmed) {
    state.overdriveArmed = false;
    cue = "power50";
  }
  if (power >= limit && state.maxArmed && limit > 0) {
    state.maxArmed = false;
    cue = "power90";
  }
  if (cue) playSoundEffect(cue, 0.55);
}

/** Confirmed ring-out only; the caller determines whose piece left the board. */
export function playRingOutSound(isOwn: boolean): void {
  const runtime = soundRuntime;
  if (!runtime || !runtime.unlocked || !canPlaySound() || runtime.sfxGain.gain.value === 0 ||
      runtime.context.state !== "running" || !runtime.context.createOscillator || runtime.ringOutVoices >= 2) return;
  const oscillator = runtime.context.createOscillator();
  const gain = runtime.context.createGain();
  const now = runtime.context.currentTime;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(isOwn ? 330 : 420, now);
  oscillator.frequency.exponentialRampToValueAtTime(isOwn ? 245 : 525, now + 0.14);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.055, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
  oscillator.connect(gain);
  gain.connect(runtime.sfxGain);
  runtime.ringOutVoices += 1;
  runtime.synthSources.add(oscillator);
  oscillator.onended = () => { runtime.ringOutVoices -= 1; runtime.synthSources.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(now);
  oscillator.stop(now + 0.2);
}

export function resetPieceHitSoundTracking(): void {
  hitState.touchingPairs.clear();
  hitState.lastPlayedAtByPair.clear();
  hitState.preStep.clear();
  hitState.candidates.length = 0;
  hitState.primed = false;
}

function motionAt(body: PhysicsRuntime["boardBody"]): BodyMotion {
  return { position: body.worldCom(), linear: body.linvel(), angular: body.angvel() };
}

/** Called immediately before each live world.step(), independently of audio state. */
export function capturePreStepImpactState(physicsRuntime: PhysicsRuntime): void {
  hitState.preStep.clear();
  const add = (body: PhysicsRuntime["boardBody"]) => hitState.preStep.set(body.handle, motionAt(body));
  for (const piece of physicsRuntime.pieces.values()) add(piece.body);
  for (const wall of physicsRuntime.breakableWalls.values()) add(wall.body);
  for (const obstacle of physicsRuntime.pinballObstacles.values()) add(obstacle.body);
  for (const object of physicsRuntime.hotseatMap?.dynamicObjects.values() ?? []) add(object.body);
}

function pointVelocity(motion: BodyMotion, point: Vec3): Vec3 {
  const r = { x: point.x - motion.position.x, y: point.y - motion.position.y, z: point.z - motion.position.z };
  const w = motion.angular;
  return {
    x: motion.linear.x + w.y * r.z - w.z * r.y,
    y: motion.linear.y + w.z * r.x - w.x * r.z,
    z: motion.linear.z + w.x * r.y - w.y * r.x,
  };
}

/** Read only: gather real new solver contacts after one fixed step. */
export function scanLivePieceHitSounds(physicsRuntime: PhysicsRuntime, now: number): void {
  if (!Number.isFinite(now)) return;
  const current = new Set<string>();
  const pieces = [...physicsRuntime.pieces.values()];
  const walls = [...physicsRuntime.breakableWalls.values()];
  const obstacles = [...physicsRuntime.pinballObstacles.values()];
  const objects = [...physicsRuntime.hotseatMap?.dynamicObjects.values() ?? []];
  const inspect = (
    key: string, first: PhysicsRuntime["boardBody"], second: PhysicsRuntime["boardBody"],
    left: PhysicsRuntime["boardCollider"], right: PhysicsRuntime["boardCollider"],
    soundId: CollisionSoundEffectId,
  ) => {
    physicsRuntime.world.contactPair(left, right, (manifold, flipped) => {
      const count = manifold.numSolverContacts();
      if (!count) return;
      current.add(key);
      if (!hitState.primed || hitState.touchingPairs.has(key) ||
          now - (hitState.lastPlayedAtByPair.get(key) ?? -Infinity) < SOUND_HIT_PAIR_COOLDOWN_MS) return;
      const beforeFirst = hitState.preStep.get(first.handle);
      const beforeSecond = hitState.preStep.get(second.handle);
      if (!beforeFirst || !beforeSecond) return;
      let impulse = 0;
      for (let i = 0; i < manifold.numContacts(); i++) impulse += Math.max(0, manifold.contactImpulse(i));
      if (impulse <= 0) return;
      const point = manifold.solverContactPoint(0);
      const normal = manifold.normal();
      if (flipped) { normal.x *= -1; normal.y *= -1; normal.z *= -1; }
      const a = pointVelocity(beforeFirst, point);
      const b = pointVelocity(beforeSecond, point);
      const approaching = (a.x - b.x) * normal.x + (a.y - b.y) * normal.y + (a.z - b.z) * normal.z;
      if (approaching < SOUND_HIT_MIN_RELATIVE_SPEED) return;
      const firstMass = first.isFixed() ? Infinity : first.mass();
      const secondMass = second.isFixed() ? Infinity : second.mass();
      // Actual game pieces weigh about .027-.103; only guard near-zero custom bodies.
      const mass = Math.max(0.01, Math.min(firstMass, secondMass));
      const score = Math.min(1, Math.sqrt(Math.max(0, impulse / mass) * approaching) / 7);
      if (score < 0.07) return;
      const event: ImpactFeedbackEvent = {
        pairKey: key, point: { x: point.x, y: point.y, z: point.z },
        direction: { x: normal.x, y: normal.y, z: normal.z }, strength: score,
      };
      const existing = hitState.candidates.findIndex(candidate => candidate.event.pairKey === key);
      if (existing >= 0) {
        if (score > hitState.candidates[existing].score) hitState.candidates[existing] = {
          event, soundId, score, now, order: hitState.candidates[existing].order,
        };
      } else hitState.candidates.push({ event, soundId, score, now, order: hitState.candidates.length });
    });
  };
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i];
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j];
      inspect(`piece:${a.instance.id}|piece:${b.instance.id}`, a.body, b.body, a.collider, b.collider,
        (a.instance.type === "King" && a.body.isFixed()) || (b.instance.type === "King" && b.body.isFixed()) ? "rock" : "hit");
    }
    for (const wall of walls) inspect(`piece:${a.instance.id}|wall:${wall.definition.id}`, a.body, wall.body,
      a.collider, wall.collider, wall.definition.variant === "breakable" ? "wood" : "rock");
    for (const obstacle of obstacles) inspect(`piece:${a.instance.id}|obstacle:${obstacle.definition.id}`, a.body,
      obstacle.body, a.collider, obstacle.collider, "iron");
    for (const object of objects) for (const collider of [object.collider, ...object.additionalColliders ?? []])
      inspect(`piece:${a.instance.id}|map:${object.definition.id}`, a.body, object.body, a.collider, collider, "wood");
  }
  for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
    const a = objects[i], b = objects[j];
    for (const left of [a.collider, ...a.additionalColliders ?? []])
      for (const right of [b.collider, ...b.additionalColliders ?? []])
        inspect(`map:${a.definition.id}|map:${b.definition.id}`, a.body, b.body, left, right, "wood");
  }
  hitState.touchingPairs = current;
  hitState.primed = true;
}

/** One frame's at most two significant new impacts, returned in actual step order. */
export function flushLiveImpactSounds(now: number): ImpactFeedbackEvent[] {
  const candidates = hitState.candidates.splice(0);
  if (!Number.isFinite(now)) return [];
  const selected = candidates.sort((a, b) => b.score - a.score).slice(0, 2).sort((a, b) => a.order - b.order);
  const runtime = soundRuntime;
  for (const candidate of selected) {
    hitState.lastPlayedAtByPair.set(candidate.event.pairKey, now);
    if (runtime && runtime.sources.size < 8) {
      playSoundEffect(candidate.soundId, Math.min(0.9, 0.22 + candidate.score * 0.68), 0.94 + candidate.score * 0.1);
    }
    if (runtime?.unlocked && runtime.context.state === "running" && runtime.sfxGain.gain.value > 0 &&
        candidate.score >= 0.65 && canPlaySound() && runtime.duckUntil < performance.now()) {
      runtime.duckUntil = performance.now() + 150;
      applySoundSettings();
      setTimeout(() => { if (runtime.duckUntil <= performance.now()) applySoundSettings(); }, 155);
    }
  }
  return selected.map(candidate => candidate.event);
}
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
